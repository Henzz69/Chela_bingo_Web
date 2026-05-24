-- ================================================================
-- TurboPlay — SPORTS BETTING DATABASE SCHEMA
-- Flask/Python backend: integer user IDs, sports bets, wallet
--
-- Run this in your BETTING Supabase project's SQL Editor.
-- This is completely independent of the bingo schema.
--
-- Tables:
--   betting_users      — integer PK, username, balance
--   bets               — sports bet slips (single + accumulator)
--   betting_wallet_tx  — immutable financial ledger
--   betting_deposit_requests
--   betting_withdrawal_requests
--
-- Views:
--   betting_wallet_balances — live balance from ledger
--
-- RPCs:
--   betting_wallet_credit
--   betting_wallet_debit
--   betting_place_bet
--   betting_settle_bet
--   betting_process_deposit
--   betting_process_withdrawal
--   betting_get_user_summary
-- ================================================================


-- ================================================================
-- EXTENSIONS
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ================================================================
-- BETTING_USERS
-- Integer PK to match the Flask backend (users.id = 1, 2, …).
-- Completely separate from the bingo users table.
-- ================================================================

CREATE TABLE IF NOT EXISTS betting_users (
  id                  BIGSERIAL PRIMARY KEY,   -- Flask backend uses integer IDs
  username            TEXT NOT NULL DEFAULT 'Player',
  email               TEXT UNIQUE,

  -- Wallet
  balance             NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  bonus_balance       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (bonus_balance >= 0),

  -- Responsible gambling
  kyc_status          TEXT NOT NULL DEFAULT 'none'
                        CHECK (kyc_status IN ('none','pending','approved','rejected')),
  daily_bet_limit     NUMERIC(14,2),
  self_excluded       BOOLEAN NOT NULL DEFAULT FALSE,
  self_excluded_until TIMESTAMPTZ,

  -- Lifecycle
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION betting_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_betting_users_updated_at ON betting_users;
CREATE TRIGGER trg_betting_users_updated_at
  BEFORE UPDATE ON betting_users
  FOR EACH ROW EXECUTE FUNCTION betting_set_updated_at();

-- Seed the default user that the Flask backend expects (id = 1)
INSERT INTO betting_users (id, username, balance)
VALUES (1, 'Player1', 1000.00)
ON CONFLICT (id) DO NOTHING;


-- ================================================================
-- BETS
-- One row per selection.  Accumulator legs share the same slip_id.
-- ================================================================

CREATE TABLE IF NOT EXISTS bets (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES betting_users(id) ON DELETE CASCADE,

  -- Fixture info (from Sportsmonks API)
  match_id      BIGINT,
  match_name    TEXT NOT NULL,
  league        TEXT,

  -- Selection
  selection     TEXT NOT NULL,          -- '1', 'X', '2'
  odds          NUMERIC(8,4) NOT NULL CHECK (odds > 0),

  -- Accumulator: all legs on the same slip share slip_id
  slip_id       UUID NOT NULL DEFAULT gen_random_uuid(),
  total_odds    NUMERIC(10,4) NOT NULL DEFAULT 1.0 CHECK (total_odds > 0),
  stake         NUMERIC(14,2) NOT NULL CHECK (stake > 0),
  potential_win NUMERIC(14,2) GENERATED ALWAYS AS (ROUND(stake * total_odds, 2)) STORED,

  -- Settlement
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','won','lost','void','cancelled')),
  settled_at    TIMESTAMPTZ,
  payout        NUMERIC(14,2),

  -- Wallet linkage
  stake_tx_id   UUID,   -- set after wallet_tx is written
  payout_tx_id  UUID,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- BETTING_WALLET_TX  (immutable ledger)
-- ================================================================

CREATE TABLE IF NOT EXISTS betting_wallet_tx (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          BIGINT NOT NULL REFERENCES betting_users(id) ON DELETE CASCADE,

  -- Positive = credit, negative = debit
  amount           NUMERIC(14,2) NOT NULL,

  tx_type          TEXT NOT NULL CHECK (tx_type IN (
    'bet_stake',        -- debit:  placing a bet
    'bet_win',          -- credit: winning a bet
    'bet_refund',       -- credit: void / cancelled bet
    'deposit',          -- credit: funds added
    'withdrawal',       -- debit:  funds withdrawn
    'withdrawal_fee',   -- debit:  processing fee
    'bonus_credit',     -- credit: promotional bonus
    'bonus_debit',      -- debit:  bonus expiry / wagering
    'admin_credit',     -- credit: manual adjustment
    'admin_debit'       -- debit:  manual adjustment
  )),

  reference_id     BIGINT,          -- bet id this relates to
  idempotency_key  TEXT UNIQUE NOT NULL,

  -- Metadata
  balance_after    NUMERIC(14,2),
  is_bonus         BOOLEAN NOT NULL DEFAULT FALSE,
  note             TEXT,
  ip_address       INET,
  status           TEXT NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('pending','completed','failed','reversed')),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from bets back to wallet_tx now that both tables exist
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS stake_tx_id_fk  UUID REFERENCES betting_wallet_tx(id),
  ADD COLUMN IF NOT EXISTS payout_tx_id_fk UUID REFERENCES betting_wallet_tx(id);


-- ================================================================
-- BETTING_DEPOSIT_REQUESTS
-- ================================================================

CREATE TABLE IF NOT EXISTS betting_deposit_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           BIGINT NOT NULL REFERENCES betting_users(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method    TEXT NOT NULL DEFAULT 'mpesa'
                      CHECK (payment_method IN (
                        'mpesa','telebirr','cbe_birr','bank_transfer','card','admin'
                      )),
  provider_ref      TEXT,
  provider_response JSONB,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','failed','expired')),
  wallet_tx_id      UUID REFERENCES betting_wallet_tx(id),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- BETTING_WITHDRAWAL_REQUESTS
-- ================================================================

CREATE TABLE IF NOT EXISTS betting_withdrawal_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        BIGINT NOT NULL REFERENCES betting_users(id) ON DELETE CASCADE,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  fee            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0),
  net_amount     NUMERIC(14,2) GENERATED ALWAYS AS (amount - fee) STORED,
  payment_method TEXT NOT NULL DEFAULT 'mpesa'
                   CHECK (payment_method IN (
                     'mpesa','telebirr','cbe_birr','bank_transfer','card'
                   )),
  -- e.g. {"phone": "+251912345678", "name": "Abebe Girma"}
  destination    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                     'pending','approved','processing','completed','rejected','cancelled'
                   )),
  reviewed_by    BIGINT REFERENCES betting_users(id),
  review_note    TEXT,
  reviewed_at    TIMESTAMPTZ,
  wallet_tx_id   UUID REFERENCES betting_wallet_tx(id),
  provider_ref   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);


-- ================================================================
-- VIEWS
-- ================================================================

-- Live balance derived from the ledger (for display only)
CREATE OR REPLACE VIEW betting_wallet_balances AS
SELECT
  user_id,
  SUM(amount) FILTER (WHERE NOT is_bonus) AS real_balance,
  SUM(amount) FILTER (WHERE     is_bonus) AS bonus_balance,
  SUM(amount)                             AS total_balance,
  COUNT(*)                                AS tx_count,
  MAX(created_at)                         AS last_tx_at
FROM betting_wallet_tx
WHERE status = 'completed'
GROUP BY user_id;


-- ================================================================
-- RPCs
-- ================================================================

-- ── betting_wallet_credit ────────────────────────────────────

CREATE OR REPLACE FUNCTION betting_wallet_credit(
  p_user_id      BIGINT,
  p_amount       NUMERIC,
  p_type         TEXT,
  p_reference_id BIGINT  DEFAULT NULL,
  p_idem_key     TEXT    DEFAULT NULL,
  p_note         TEXT    DEFAULT NULL,
  p_is_bonus     BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new  NUMERIC;
  v_idem TEXT;
  v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error','Credit amount must be positive');
  END IF;
  v_idem := COALESCE(p_idem_key, 'btc-' || p_user_id || '-' || gen_random_uuid()::TEXT);

  IF p_is_bonus THEN
    UPDATE betting_users SET bonus_balance = bonus_balance + p_amount
    WHERE id = p_user_id RETURNING bonus_balance INTO v_new;
  ELSE
    UPDATE betting_users SET balance = balance + p_amount
    WHERE id = p_user_id RETURNING balance INTO v_new;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('error','User not found'); END IF;

  INSERT INTO betting_wallet_tx
    (user_id, amount, tx_type, reference_id, idempotency_key,
     balance_after, note, is_bonus, status)
  VALUES
    (p_user_id, p_amount, p_type, p_reference_id, v_idem,
     v_new, p_note, p_is_bonus, 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success',TRUE,'new_balance',v_new,'tx_id',v_tx_id);
END;
$$;


-- ── betting_wallet_debit ─────────────────────────────────────

CREATE OR REPLACE FUNCTION betting_wallet_debit(
  p_user_id      BIGINT,
  p_amount       NUMERIC,
  p_type         TEXT,
  p_reference_id BIGINT  DEFAULT NULL,
  p_idem_key     TEXT    DEFAULT NULL,
  p_note         TEXT    DEFAULT NULL,
  p_is_bonus     BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cur  NUMERIC;
  v_new  NUMERIC;
  v_idem TEXT;
  v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error','Debit amount must be positive');
  END IF;
  v_idem := COALESCE(p_idem_key, 'btd-' || p_user_id || '-' || gen_random_uuid()::TEXT);

  IF p_is_bonus THEN
    SELECT bonus_balance INTO v_cur FROM betting_users WHERE id = p_user_id FOR UPDATE;
  ELSE
    SELECT balance       INTO v_cur FROM betting_users WHERE id = p_user_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('error','User not found'); END IF;
  IF v_cur < p_amount THEN
    RETURN jsonb_build_object('error','Insufficient funds','available',v_cur,'required',p_amount);
  END IF;

  v_new := v_cur - p_amount;

  IF p_is_bonus THEN
    UPDATE betting_users SET bonus_balance = v_new WHERE id = p_user_id;
  ELSE
    UPDATE betting_users SET balance       = v_new WHERE id = p_user_id;
  END IF;

  INSERT INTO betting_wallet_tx
    (user_id, amount, tx_type, reference_id, idempotency_key,
     balance_after, note, is_bonus, status)
  VALUES
    (p_user_id, -p_amount, p_type, p_reference_id, v_idem,
     v_new, p_note, p_is_bonus, 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success',TRUE,'new_balance',v_new,'tx_id',v_tx_id);
END;
$$;


-- ── betting_place_bet ────────────────────────────────────────
-- Deducts stake, inserts all bet legs, links wallet transaction.
-- Mirrors the Flask POST /api/place-bet logic in pure SQL.

CREATE OR REPLACE FUNCTION betting_place_bet(
  p_user_id    BIGINT,
  p_selections JSONB,    -- array of {match_id, match_name, league, selection, odds}
  p_total_odds NUMERIC,
  p_stake      NUMERIC,
  p_idem_key   TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result   JSONB;
  v_tx_id    UUID;
  v_slip_id  UUID := gen_random_uuid();
  v_sel      JSONB;
  v_bet_id   BIGINT;
BEGIN
  IF p_stake <= 0 THEN
    RETURN jsonb_build_object('error','Stake must be greater than 0');
  END IF;
  IF jsonb_array_length(p_selections) = 0 THEN
    RETURN jsonb_build_object('error','No selections provided');
  END IF;

  -- Debit stake
  v_result := betting_wallet_debit(
    p_user_id      => p_user_id,
    p_amount       => p_stake,
    p_type         => 'bet_stake',
    p_idem_key     => p_idem_key,
    p_note         => 'Bet stake — ' || jsonb_array_length(p_selections) || ' selection(s)'
  );

  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
  v_tx_id := (v_result->>'tx_id')::UUID;

  -- Insert one row per selection
  FOR v_sel IN SELECT * FROM jsonb_array_elements(p_selections) LOOP
    INSERT INTO bets
      (user_id, match_id, match_name, league, selection, odds,
       slip_id, total_odds, stake, status, stake_tx_id_fk)
    VALUES (
      p_user_id,
      (v_sel->>'match_id')::BIGINT,
      v_sel->>'match_name',
      v_sel->>'league',
      v_sel->>'selection',
      (v_sel->>'odds')::NUMERIC,
      v_slip_id,
      p_total_odds,
      p_stake,
      'pending',
      v_tx_id
    )
    RETURNING id INTO v_bet_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success',      TRUE,
    'slip_id',      v_slip_id,
    'new_balance',  (v_result->>'new_balance')::NUMERIC,
    'stake_tx_id',  v_tx_id
  );
END;
$$;


-- ── betting_settle_bet ───────────────────────────────────────
-- Settles a single bet leg.  If won, credits payout.

CREATE OR REPLACE FUNCTION betting_settle_bet(
  p_bet_id   BIGINT,
  p_outcome  TEXT,    -- 'won' | 'lost' | 'void' | 'cancelled'
  p_idem_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bet    bets%ROWTYPE;
  v_payout NUMERIC;
  v_result JSONB;
  v_tx_id  UUID;
BEGIN
  SELECT * INTO v_bet FROM bets WHERE id = p_bet_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Bet not found'); END IF;
  IF v_bet.status != 'pending' THEN
    RETURN jsonb_build_object('error','Bet already settled','status',v_bet.status);
  END IF;

  IF p_outcome = 'won' THEN
    v_payout := ROUND(v_bet.stake * v_bet.total_odds, 2);

    v_result := betting_wallet_credit(
      p_user_id      => v_bet.user_id,
      p_amount       => v_payout,
      p_type         => 'bet_win',
      p_reference_id => p_bet_id,
      p_idem_key     => p_idem_key,
      p_note         => 'Bet win: ' || v_bet.match_name || ' (' || v_bet.selection || ')'
    );
    IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
    v_tx_id := (v_result->>'tx_id')::UUID;

    UPDATE bets
       SET status = 'won', settled_at = NOW(),
           payout = v_payout, payout_tx_id_fk = v_tx_id
     WHERE id = p_bet_id;

  ELSIF p_outcome IN ('void','cancelled') THEN
    -- Refund the stake
    v_result := betting_wallet_credit(
      p_user_id      => v_bet.user_id,
      p_amount       => v_bet.stake,
      p_type         => 'bet_refund',
      p_reference_id => p_bet_id,
      p_idem_key     => p_idem_key,
      p_note         => 'Bet refund: ' || v_bet.match_name
    );
    IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
    v_tx_id := (v_result->>'tx_id')::UUID;

    UPDATE bets
       SET status = p_outcome, settled_at = NOW(),
           payout = v_bet.stake, payout_tx_id_fk = v_tx_id
     WHERE id = p_bet_id;

  ELSE
    -- lost
    UPDATE bets SET status = 'lost', settled_at = NOW() WHERE id = p_bet_id;
  END IF;

  RETURN jsonb_build_object(
    'success',  TRUE,
    'outcome',  p_outcome,
    'payout',   COALESCE(v_payout, 0)
  );
END;
$$;


-- ── betting_process_deposit ──────────────────────────────────

CREATE OR REPLACE FUNCTION betting_process_deposit(
  p_deposit_id   UUID,
  p_provider_ref TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req    betting_deposit_requests%ROWTYPE;
  v_result JSONB;
  v_tx_id  UUID;
BEGIN
  SELECT * INTO v_req FROM betting_deposit_requests WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Deposit request not found'); END IF;
  IF v_req.status != 'pending' THEN RETURN jsonb_build_object('error','Already processed','status',v_req.status); END IF;
  IF NOW() > v_req.expires_at THEN
    UPDATE betting_deposit_requests SET status='expired' WHERE id=p_deposit_id;
    RETURN jsonb_build_object('error','Deposit request expired');
  END IF;

  v_result := betting_wallet_credit(
    p_user_id  => v_req.user_id,
    p_amount   => v_req.amount,
    p_type     => 'deposit',
    p_idem_key => 'bdep-' || p_deposit_id::TEXT,
    p_note     => 'Deposit via ' || v_req.payment_method
  );
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;

  v_tx_id := (v_result->>'tx_id')::UUID;
  UPDATE betting_deposit_requests
     SET status='confirmed', confirmed_at=NOW(),
         provider_ref=COALESCE(p_provider_ref,provider_ref), wallet_tx_id=v_tx_id
   WHERE id=p_deposit_id;

  RETURN jsonb_build_object('success',TRUE,'amount',v_req.amount,
    'new_balance',(v_result->>'new_balance')::NUMERIC,'tx_id',v_tx_id);
END;
$$;


-- ── betting_process_withdrawal ───────────────────────────────

CREATE OR REPLACE FUNCTION betting_process_withdrawal(
  p_withdrawal_id UUID,
  p_reviewer_id   BIGINT,
  p_approve       BOOLEAN,
  p_review_note   TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_req    betting_withdrawal_requests%ROWTYPE;
  v_result JSONB;
  v_tx_id  UUID;
BEGIN
  SELECT * INTO v_req FROM betting_withdrawal_requests WHERE id=p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Withdrawal not found'); END IF;
  IF v_req.status != 'pending' THEN RETURN jsonb_build_object('error','Already processed','status',v_req.status); END IF;

  IF NOT p_approve THEN
    UPDATE betting_withdrawal_requests
       SET status='rejected', reviewed_by=p_reviewer_id,
           review_note=p_review_note, reviewed_at=NOW()
     WHERE id=p_withdrawal_id;
    RETURN jsonb_build_object('success',TRUE,'action','rejected');
  END IF;

  v_result := betting_wallet_debit(
    p_user_id  => v_req.user_id,
    p_amount   => v_req.amount,
    p_type     => 'withdrawal',
    p_idem_key => 'bwd-' || p_withdrawal_id::TEXT,
    p_note     => 'Withdrawal via ' || v_req.payment_method
  );
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;

  v_tx_id := (v_result->>'tx_id')::UUID;

  IF v_req.fee > 0 THEN
    PERFORM betting_wallet_debit(
      p_user_id  => v_req.user_id,
      p_amount   => v_req.fee,
      p_type     => 'withdrawal_fee',
      p_idem_key => 'bwd-fee-' || p_withdrawal_id::TEXT,
      p_note     => 'Withdrawal processing fee'
    );
  END IF;

  UPDATE betting_withdrawal_requests
     SET status='processing', reviewed_by=p_reviewer_id,
         review_note=p_review_note, reviewed_at=NOW(), wallet_tx_id=v_tx_id
   WHERE id=p_withdrawal_id;

  RETURN jsonb_build_object('success',TRUE,'action','approved',
    'net_amount',v_req.net_amount,'new_balance',(v_result->>'new_balance')::NUMERIC,'tx_id',v_tx_id);
END;
$$;


-- ── betting_get_user_summary ─────────────────────────────────
-- Mirrors the Flask GET /api/user + GET /api/bets response shape.

CREATE OR REPLACE FUNCTION betting_get_user_summary(p_user_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user    betting_users%ROWTYPE;
  v_tx_rows JSONB;
  v_bets    JSONB;
BEGIN
  SELECT * INTO v_user FROM betting_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','User not found'); END IF;

  SELECT jsonb_agg(t ORDER BY t.created_at DESC) INTO v_tx_rows FROM (
    SELECT id, amount, tx_type, note, balance_after, status, created_at
      FROM betting_wallet_tx WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 20
  ) t;

  SELECT jsonb_agg(b ORDER BY b.created_at DESC) INTO v_bets FROM (
    SELECT id, match_name, league, selection, odds, total_odds,
           stake, potential_win, status, payout, created_at
      FROM bets WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 10
  ) b;

  RETURN jsonb_build_object(
    'id',           v_user.id,
    'username',     v_user.username,
    'balance',      v_user.balance,
    'bonus_balance',v_user.bonus_balance,
    'transactions', COALESCE(v_tx_rows,'[]'::jsonb),
    'recent_bets',  COALESCE(v_bets,   '[]'::jsonb)
  );
END;
$$;


-- ================================================================
-- place_bet_batch
-- Called by frontend/app/api/place-bet/route.ts
-- Atomically deducts stake from profiles.balance and inserts
-- one bets row per selection. Uses FOR UPDATE to prevent race
-- conditions (TOCTOU). Returns { success, new_balance } or
-- { error } on insufficient funds / user not found.
-- ================================================================

CREATE OR REPLACE FUNCTION place_bet_batch(
  p_user_id     UUID,
  p_total_stake NUMERIC,
  p_bets        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance NUMERIC;
  v_new_bal NUMERIC;
  v_bet     JSONB;
BEGIN
  IF p_total_stake <= 0 THEN
    RETURN jsonb_build_object('error', 'Stake must be greater than 0');
  END IF;
  IF jsonb_array_length(p_bets) = 0 THEN
    RETURN jsonb_build_object('error', 'No selections provided');
  END IF;

  -- Lock the profile row to prevent concurrent balance reads
  SELECT balance INTO v_balance FROM profiles WHERE id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User profile not found');
  END IF;

  IF v_balance < p_total_stake THEN
    RETURN jsonb_build_object(
      'error',     'Insufficient funds',
      'available', v_balance,
      'required',  p_total_stake
    );
  END IF;

  -- Deduct stake atomically
  v_new_bal := v_balance - p_total_stake;
  UPDATE profiles SET balance = v_new_bal WHERE id = p_user_id;

  -- Insert one bet row per selection
  FOR v_bet IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    INSERT INTO bets (user_id, fixture_id, selection, stake, status)
    VALUES (
      p_user_id,
      (v_bet->>'fixture_id')::BIGINT,
      v_bet->>'selection',
      p_total_stake,
      'pending'
    );
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_new_bal);
END;
$$;


-- ================================================================
-- INDEXES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_bet_users_email      ON betting_users (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bets_user            ON bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_slip            ON bets (slip_id);
CREATE INDEX IF NOT EXISTS idx_bets_status          ON bets (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bets_match           ON bets (match_id);
CREATE INDEX IF NOT EXISTS idx_bet_wallet_tx_user   ON betting_wallet_tx (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bet_wallet_tx_idem   ON betting_wallet_tx (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bet_wallet_tx_status ON betting_wallet_tx (status) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_bet_dep_req_user     ON betting_deposit_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bet_dep_req_status   ON betting_deposit_requests (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bet_wd_req_user      ON betting_withdrawal_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bet_wd_req_status    ON betting_withdrawal_requests (status)
  WHERE status IN ('pending','approved','processing');


-- ================================================================
-- ROW-LEVEL SECURITY
-- ================================================================

ALTER TABLE betting_users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE betting_wallet_tx          ENABLE ROW LEVEL SECURITY;
ALTER TABLE betting_deposit_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE betting_withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- betting_users: own row only
DROP POLICY IF EXISTS "btu_select_own" ON betting_users;
DROP POLICY IF EXISTS "btu_update_own" ON betting_users;
CREATE POLICY "btu_select_own" ON betting_users FOR SELECT
  USING (id::TEXT = auth.uid()::TEXT);
CREATE POLICY "btu_update_own" ON betting_users FOR UPDATE
  USING (id::TEXT = auth.uid()::TEXT)
  WITH CHECK (id::TEXT = auth.uid()::TEXT);

-- bets: own rows only
DROP POLICY IF EXISTS "bets_own"        ON bets;
DROP POLICY IF EXISTS "bets_insert_own" ON bets;
CREATE POLICY "bets_own"        ON bets FOR SELECT USING (user_id::TEXT = auth.uid()::TEXT);
CREATE POLICY "bets_insert_own" ON bets FOR INSERT WITH CHECK (user_id::TEXT = auth.uid()::TEXT);

-- betting_wallet_tx: own rows only
DROP POLICY IF EXISTS "bwt_own" ON betting_wallet_tx;
CREATE POLICY "bwt_own" ON betting_wallet_tx FOR SELECT
  USING (user_id::TEXT = auth.uid()::TEXT);

-- deposit_requests: own rows only
DROP POLICY IF EXISTS "bdr_own"    ON betting_deposit_requests;
DROP POLICY IF EXISTS "bdr_insert" ON betting_deposit_requests;
CREATE POLICY "bdr_own"    ON betting_deposit_requests FOR SELECT
  USING (user_id::TEXT = auth.uid()::TEXT);
CREATE POLICY "bdr_insert" ON betting_deposit_requests FOR INSERT
  WITH CHECK (user_id::TEXT = auth.uid()::TEXT);

-- withdrawal_requests: own rows only
DROP POLICY IF EXISTS "bwr_own"    ON betting_withdrawal_requests;
DROP POLICY IF EXISTS "bwr_insert" ON betting_withdrawal_requests;
CREATE POLICY "bwr_own"    ON betting_withdrawal_requests FOR SELECT
  USING (user_id::TEXT = auth.uid()::TEXT);
CREATE POLICY "bwr_insert" ON betting_withdrawal_requests FOR INSERT
  WITH CHECK (user_id::TEXT = auth.uid()::TEXT);


-- ================================================================
-- END OF BETTING SCHEMA
-- ================================================================
