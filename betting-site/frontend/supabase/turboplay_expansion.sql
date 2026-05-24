-- ================================================================
-- TurboPlay — Complete Database Schema (Single-File Migration)
-- Bingo System + Unified Wallet System
--
-- Self-contained: run this on a BLANK Supabase project.
-- It supersedes bingo_schema.sql — do NOT run both.
--
-- Paste the entire file into the Supabase SQL Editor and click
-- "Run".  Every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- Sections:
--   §1  Extensions
--   §2  users
--   §3  bingo_rooms
--   §4  game_sessions
--   §5  wallet_transactions
--   §6  powerup_inventory
--   §7  bingo_draw_log
--   §8  deposit_requests
--   §9  withdrawal_requests
--   §10 powerup_shop  +  powerup_purchases
--   §11 bets
--   §12 Views  (wallet_balances, bingo_leaderboard)
--   §13 RPCs
--        join_bingo_room      (Phase 1 — preserved)
--        validate_bingo_win   (Phase 1 — preserved)
--        claim_bingo_win      (Phase 1 — preserved)
--        wallet_credit
--        wallet_debit
--        process_deposit
--        process_withdrawal
--        buy_powerup
--        draw_bingo_number
--        get_wallet_summary
--   §14 Indexes
--   §15 Row-Level Security
-- ================================================================


-- ================================================================
-- §1  EXTENSIONS
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;


-- ================================================================
-- §2  USERS
--
-- Bridges two identity systems:
--   • BIGSERIAL id   — integer PK used by the Flask/sports backend
--   • UUID auth_id   — Supabase Auth uid() for the bingo frontend
--   • phone          — E.164 phone used by Chela Bingo local auth
-- ================================================================

-- Create users table if it does not exist at all (fresh database).
CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT NOT NULL DEFAULT 'Player',
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safely add every column that may be missing on an existing table.
-- Each ALTER is wrapped so it silently skips if the column already exists.
DO $$
BEGIN
  -- Identity / auth
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='auth_id')
    THEN ALTER TABLE users ADD COLUMN auth_id UUID UNIQUE; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='phone')
    THEN ALTER TABLE users ADD COLUMN phone TEXT UNIQUE; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash')
    THEN ALTER TABLE users ADD COLUMN password_hash TEXT; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='display_name')
    THEN ALTER TABLE users ADD COLUMN display_name TEXT; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='avatar_url')
    THEN ALTER TABLE users ADD COLUMN avatar_url TEXT; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email')
    THEN ALTER TABLE users ADD COLUMN email TEXT UNIQUE; END IF;

  -- Wallet
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='bonus_balance')
    THEN ALTER TABLE users ADD COLUMN bonus_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (bonus_balance >= 0); END IF;

  -- Responsible gambling
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='kyc_status')
    THEN ALTER TABLE users ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'none'
           CHECK (kyc_status IN ('none','pending','approved','rejected')); END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='daily_bet_limit')
    THEN ALTER TABLE users ADD COLUMN daily_bet_limit NUMERIC(14,2); END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='self_excluded')
    THEN ALTER TABLE users ADD COLUMN self_excluded BOOLEAN NOT NULL DEFAULT FALSE; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='self_excluded_until')
    THEN ALTER TABLE users ADD COLUMN self_excluded_until TIMESTAMPTZ; END IF;

  -- Lifecycle
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_active')
    THEN ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_verified')
    THEN ALTER TABLE users ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at')
    THEN ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(); END IF;

  -- Widen balance column precision if it was created as NUMERIC(10,2)
  ALTER TABLE users ALTER COLUMN balance TYPE NUMERIC(14,2);
  ALTER TABLE users ALTER COLUMN username SET DEFAULT 'Player';
END;
$$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ================================================================
-- §3  BINGO_ROOMS
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_rooms (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core game settings
  entry_fee         NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  max_players       INT          NOT NULL DEFAULT 2,
  status            TEXT         NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','active','finished')),

  -- Patterns & draw state
  winning_patterns  JSONB NOT NULL DEFAULT '["row","column","diagonal","four_corners","full_house"]'::jsonb,
  drawn_numbers     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Phase 2: server-side pre-generated draw order (hidden from clients)
  draw_sequence     JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Economics
  house_cut         NUMERIC(5,4) NOT NULL DEFAULT 0.2000
                      CHECK (house_cut >= 0 AND house_cut < 1),
  prize_pot         NUMERIC(14,2),
  derash_amount     NUMERIC(14,2),

  -- Lobby metadata
  game_code         TEXT UNIQUE,
  card_assignments  JSONB NOT NULL DEFAULT '{}'::jsonb,
  countdown_secs    INT  NOT NULL DEFAULT 30,
  draw_interval_ms  INT  NOT NULL DEFAULT 4000,

  -- Room visibility
  room_type         TEXT NOT NULL DEFAULT 'public'
                      CHECK (room_type IN ('public','private')),
  invite_code       TEXT UNIQUE,

  -- Computed tier label (stored, never needs updating)
  stake_label       TEXT GENERATED ALWAYS AS (
    CASE
      WHEN entry_fee <= 10  THEN 'Starter'
      WHEN entry_fee <= 50  THEN 'Standard'
      WHEN entry_fee <= 100 THEN 'Premium'
      ELSE 'High Roller'
    END
  ) STORED,

  -- Timestamps & winner
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  winner_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- §4  GAME_SESSIONS
-- ================================================================

CREATE TABLE IF NOT EXISTS game_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID   NOT NULL REFERENCES bingo_rooms(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id)       ON DELETE CASCADE,

  -- Card data
  card            JSONB  NOT NULL,
  card_index      SMALLINT CHECK (card_index BETWEEN 1 AND 100),
  daubed          JSONB  NOT NULL DEFAULT '[]'::jsonb,
  powerups_used   JSONB  NOT NULL DEFAULT '[]'::jsonb,

  -- Result
  final_rank      SMALLINT,
  win_claimed     BOOLEAN     NOT NULL DEFAULT FALSE,
  win_claimed_at  TIMESTAMPTZ,
  payout_amount   NUMERIC(14,2),
  calls_to_win    SMALLINT,
  winning_pattern TEXT CHECK (winning_pattern IN (
                    'row','column','diagonal','four_corners','full_house'
                  )),

  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (room_id, user_id)
);


-- ================================================================
-- §5  WALLET_TRANSACTIONS  (immutable ledger)
-- ================================================================

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Positive = credit, negative = debit
  amount            NUMERIC(14,2) NOT NULL,

  transaction_type  TEXT NOT NULL CHECK (transaction_type IN (
    -- Bingo
    'bingo_entry',
    'bingo_win',
    'bingo_refund',
    -- Sports betting
    'bet_stake',
    'bet_win',
    'bet_refund',
    -- Wallet operations
    'deposit',
    'withdrawal',
    'withdrawal_fee',
    -- Bonuses
    'bonus_credit',
    'bonus_debit',
    -- Admin
    'admin_credit',
    'admin_debit'
  )),

  reference_id      UUID,
  idempotency_key   TEXT UNIQUE NOT NULL,

  -- Metadata
  balance_after     NUMERIC(14,2),
  is_bonus          BOOLEAN NOT NULL DEFAULT FALSE,
  note              TEXT,
  ip_address        INET,
  status            TEXT NOT NULL DEFAULT 'completed'
                      CHECK (status IN ('pending','completed','failed','reversed')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- §6  POWERUP_INVENTORY
-- ================================================================

CREATE TABLE IF NOT EXISTS powerup_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  powerup_type  TEXT   NOT NULL
                  CHECK (powerup_type IN ('instant_daub','coin_multiplier','extra_card')),
  quantity      INT    NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, powerup_type)
);


-- ================================================================
-- §7  BINGO_DRAW_LOG  (immutable per-draw audit trail)
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_draw_log (
  id            BIGSERIAL PRIMARY KEY,
  room_id       UUID     NOT NULL REFERENCES bingo_rooms(id) ON DELETE CASCADE,
  draw_position SMALLINT NOT NULL CHECK (draw_position BETWEEN 1 AND 75),
  number_drawn  SMALLINT NOT NULL CHECK (number_drawn  BETWEEN 1 AND 75),
  drawn_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (room_id, draw_position),
  UNIQUE (room_id, number_drawn)
);


-- ================================================================
-- §8  DEPOSIT_REQUESTS
-- ================================================================

CREATE TABLE IF NOT EXISTS deposit_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method    TEXT NOT NULL DEFAULT 'mpesa'
                      CHECK (payment_method IN (
                        'mpesa','telebirr','cbe_birr','bank_transfer','card','admin'
                      )),
  provider_ref      TEXT,
  provider_response JSONB,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','failed','expired')),
  wallet_tx_id      UUID REFERENCES wallet_transactions(id),
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- §9  WITHDRAWAL_REQUESTS
-- ================================================================

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  fee             NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0),
  net_amount      NUMERIC(14,2) GENERATED ALWAYS AS (amount - fee) STORED,
  payment_method  TEXT NOT NULL DEFAULT 'mpesa'
                    CHECK (payment_method IN (
                      'mpesa','telebirr','cbe_birr','bank_transfer','card'
                    )),
  -- e.g. {"phone": "+251912345678", "name": "Abebe Girma"}
  destination     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending','approved','processing','completed','rejected','cancelled'
                    )),
  reviewed_by     BIGINT REFERENCES users(id),
  review_note     TEXT,
  reviewed_at     TIMESTAMPTZ,
  wallet_tx_id    UUID REFERENCES wallet_transactions(id),
  provider_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);


-- ================================================================
-- §10  POWERUP_SHOP  +  POWERUP_PURCHASES
-- ================================================================

CREATE TABLE IF NOT EXISTS powerup_shop (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  powerup_type      TEXT NOT NULL UNIQUE
                      CHECK (powerup_type IN ('instant_daub','coin_multiplier','extra_card')),
  display_name      TEXT NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_bonus_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO powerup_shop (powerup_type, display_name, description, price, is_bonus_eligible, sort_order)
VALUES
  ('instant_daub',    'Instant Daub',    'Automatically daubs one called number on your card.',  5.00, TRUE,  1),
  ('coin_multiplier', 'Coin Multiplier', 'Doubles your payout if you win this game.',           15.00, FALSE, 2),
  ('extra_card',      'Extra Card',      'Play a second bingo card in the same room.',           10.00, TRUE,  3)
ON CONFLICT (powerup_type) DO NOTHING;

-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS powerup_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         BIGINT NOT NULL REFERENCES users(id)            ON DELETE CASCADE,
  powerup_type    TEXT   NOT NULL REFERENCES powerup_shop(powerup_type),
  quantity        SMALLINT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price      NUMERIC(10,2) NOT NULL,
  total_price     NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  paid_with_bonus BOOLEAN NOT NULL DEFAULT FALSE,
  wallet_tx_id    UUID REFERENCES wallet_transactions(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- §11  BETS
-- ================================================================

CREATE TABLE IF NOT EXISTS bets (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Fixture info (from Sportsmonks)
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
  stake_tx_id   UUID REFERENCES wallet_transactions(id),
  payout_tx_id  UUID REFERENCES wallet_transactions(id),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================================
-- §12  VIEWS
-- ================================================================

-- ── wallet_balances ──────────────────────────────────────────
-- Live balance derived from the ledger.
-- Use users.balance for transactional logic; this view is for display.

CREATE OR REPLACE VIEW wallet_balances AS
SELECT
  user_id,
  SUM(amount) FILTER (WHERE NOT is_bonus)  AS real_balance,
  SUM(amount) FILTER (WHERE     is_bonus)  AS bonus_balance,
  SUM(amount)                              AS total_balance,
  COUNT(*)                                 AS transaction_count,
  MAX(created_at)                          AS last_transaction_at
FROM wallet_transactions
WHERE status = 'completed'
GROUP BY user_id;


-- ── bingo_leaderboard ────────────────────────────────────────
-- Materialised view — refresh with:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY bingo_leaderboard;
-- (call this at the end of claim_bingo_win or via a pg_cron job)

CREATE MATERIALIZED VIEW IF NOT EXISTS bingo_leaderboard AS
SELECT
  u.id                                                          AS user_id,
  u.display_name,
  u.username,
  COUNT(gs.id)                                                  AS games_played,
  COUNT(gs.id) FILTER (WHERE gs.win_claimed)                    AS games_won,
  COALESCE(SUM(gs.payout_amount), 0)                            AS total_winnings,
  COALESCE(SUM(br.entry_fee), 0)                                AS total_staked,
  ROUND(
    COUNT(gs.id) FILTER (WHERE gs.win_claimed)::NUMERIC
    / NULLIF(COUNT(gs.id), 0) * 100, 1
  )                                                             AS win_rate_pct,
  MIN(gs.calls_to_win) FILTER (WHERE gs.win_claimed)            AS best_calls_to_win,
  MAX(gs.joined_at)                                             AS last_played_at
FROM users u
LEFT JOIN game_sessions gs ON gs.user_id = u.id
LEFT JOIN bingo_rooms   br ON br.id      = gs.room_id
GROUP BY u.id, u.display_name, u.username
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bingo_leaderboard_user
  ON bingo_leaderboard (user_id);


-- ================================================================
-- §13  RPCs  (all SECURITY DEFINER — bypass RLS for server ops)
-- ================================================================

-- ── join_bingo_room ──────────────────────────────────────────
-- Atomically deducts entry fee and creates a game session.
-- Preserved from Phase 1; updated to use BIGINT user_id.

CREATE OR REPLACE FUNCTION join_bingo_room(
  p_user_id   BIGINT,
  p_room_id   UUID,
  p_card      JSONB,
  p_idem_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room         bingo_rooms%ROWTYPE;
  v_user_balance NUMERIC;
  v_new_balance  NUMERIC;
  v_session_id   UUID;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Room not found');
  END IF;
  IF v_room.status != 'waiting' THEN
    RETURN jsonb_build_object('error', 'Room is not accepting players');
  END IF;
  IF EXISTS (SELECT 1 FROM game_sessions WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('error', 'Already joined this room');
  END IF;
  IF (SELECT COUNT(*) FROM game_sessions WHERE room_id = p_room_id) >= v_room.max_players THEN
    RETURN jsonb_build_object('error', 'Room is full');
  END IF;

  SELECT balance INTO v_user_balance FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user_balance < v_room.entry_fee THEN
    RETURN jsonb_build_object('error', 'Insufficient funds');
  END IF;

  v_new_balance := v_user_balance - v_room.entry_fee;
  UPDATE users SET balance = v_new_balance WHERE id = p_user_id;

  INSERT INTO wallet_transactions
    (user_id, amount, transaction_type, reference_id, idempotency_key, balance_after, note, status)
  VALUES
    (p_user_id, -v_room.entry_fee, 'bingo_entry', p_room_id, p_idem_key,
     v_new_balance, 'Bingo room entry fee', 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO game_sessions (room_id, user_id, card)
  VALUES (p_room_id, p_user_id, p_card)
  RETURNING id INTO v_session_id;

  IF (SELECT COUNT(*) FROM game_sessions WHERE room_id = p_room_id) >= v_room.max_players THEN
    UPDATE bingo_rooms SET status = 'active', started_at = NOW() WHERE id = p_room_id;
  END IF;

  RETURN jsonb_build_object(
    'success',     TRUE,
    'session_id',  v_session_id,
    'new_balance', v_new_balance
  );
END;
$$;


-- ── validate_bingo_win ───────────────────────────────────────
-- Server-side win validation — never trust the client.

CREATE OR REPLACE FUNCTION validate_bingo_win(
  p_session_id UUID,
  p_room_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session    game_sessions%ROWTYPE;
  v_room       bingo_rooms%ROWTYPE;
  v_daubed     INT[];
  v_drawn      INT[];
  v_card       INT[];
  v_patterns   TEXT[];
  v_is_win     BOOLEAN := FALSE;
  v_pattern    TEXT;
  v_rows       INT[][] := ARRAY[
    ARRAY[0,1,2,3,4], ARRAY[5,6,7,8,9], ARRAY[10,11,12,13,14],
    ARRAY[15,16,17,18,19], ARRAY[20,21,22,23,24]
  ];
  v_cols       INT[][] := ARRAY[
    ARRAY[0,5,10,15,20], ARRAY[1,6,11,16,21], ARRAY[2,7,12,17,22],
    ARRAY[3,8,13,18,23], ARRAY[4,9,14,19,24]
  ];
  v_diags      INT[][] := ARRAY[
    ARRAY[0,6,12,18,24], ARRAY[4,8,12,16,20]
  ];
  v_corners    INT[] := ARRAY[0,4,20,24];
  v_line       INT[];
  v_all_daubed BOOLEAN;
  i            INT;
BEGIN
  SELECT * INTO v_session FROM game_sessions WHERE id = p_session_id AND room_id = p_room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'Session not found');
  END IF;

  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id;
  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'Game not active');
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_session.daubed)::INT)     INTO v_daubed;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.drawn_numbers)::INT) INTO v_drawn;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_session.card)::INT)       INTO v_card;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.winning_patterns))   INTO v_patterns;

  IF NOT (12 = ANY(v_daubed)) THEN
    v_daubed := v_daubed || ARRAY[12];
  END IF;

  FOR i IN 1..array_length(v_daubed, 1) LOOP
    IF v_card[v_daubed[i] + 1] != 0 AND NOT (v_card[v_daubed[i] + 1] = ANY(v_drawn)) THEN
      RETURN jsonb_build_object('valid', FALSE, 'error', 'Invalid daub — number not drawn');
    END IF;
  END LOOP;

  FOREACH v_pattern IN ARRAY v_patterns LOOP
    IF v_pattern = 'row' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_rows LOOP
        v_all_daubed := TRUE;
        FOREACH i IN ARRAY v_line LOOP
          IF NOT (i = ANY(v_daubed)) THEN v_all_daubed := FALSE; EXIT; END IF;
        END LOOP;
        IF v_all_daubed THEN v_is_win := TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'column' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_cols LOOP
        v_all_daubed := TRUE;
        FOREACH i IN ARRAY v_line LOOP
          IF NOT (i = ANY(v_daubed)) THEN v_all_daubed := FALSE; EXIT; END IF;
        END LOOP;
        IF v_all_daubed THEN v_is_win := TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'diagonal' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_diags LOOP
        v_all_daubed := TRUE;
        FOREACH i IN ARRAY v_line LOOP
          IF NOT (i = ANY(v_daubed)) THEN v_all_daubed := FALSE; EXIT; END IF;
        END LOOP;
        IF v_all_daubed THEN v_is_win := TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'four_corners' THEN
      v_all_daubed := TRUE;
      FOREACH i IN ARRAY v_corners LOOP
        IF NOT (i = ANY(v_daubed)) THEN v_all_daubed := FALSE; EXIT; END IF;
      END LOOP;
      IF v_all_daubed THEN v_is_win := TRUE; END IF;
    ELSIF v_pattern = 'full_house' THEN
      v_all_daubed := TRUE;
      FOR i IN 0..24 LOOP
        IF NOT (i = ANY(v_daubed)) THEN v_all_daubed := FALSE; EXIT; END IF;
      END LOOP;
      IF v_all_daubed THEN v_is_win := TRUE; END IF;
    END IF;
    EXIT WHEN v_is_win;
  END LOOP;

  RETURN jsonb_build_object('valid', v_is_win);
END;
$$;


-- ── claim_bingo_win ──────────────────────────────────────────
-- Validates win, pays out, and closes the room atomically.

CREATE OR REPLACE FUNCTION claim_bingo_win(
  p_session_id UUID,
  p_room_id    UUID,
  p_user_id    BIGINT,
  p_idem_key   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_validation   JSONB;
  v_room         bingo_rooms%ROWTYPE;
  v_player_count INT;
  v_pot          NUMERIC;
  v_new_balance  NUMERIC;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('error', 'Game is not active');
  END IF;

  v_validation := validate_bingo_win(p_session_id, p_room_id);
  IF NOT (v_validation->>'valid')::BOOLEAN THEN
    RETURN jsonb_build_object('error', 'Invalid bingo claim: ' || (v_validation->>'error'));
  END IF;

  SELECT COUNT(*) INTO v_player_count FROM game_sessions WHERE room_id = p_room_id;
  v_pot := v_room.entry_fee * v_player_count * (1 - v_room.house_cut);
  v_pot := ROUND(v_pot, 2);

  UPDATE users SET balance = balance + v_pot WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  INSERT INTO wallet_transactions
    (user_id, amount, transaction_type, reference_id, idempotency_key, balance_after, note, status)
  VALUES
    (p_user_id, v_pot, 'bingo_win', p_room_id, p_idem_key,
     v_new_balance, 'Bingo win payout', 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING;

  UPDATE game_sessions
     SET win_claimed     = TRUE,
         win_claimed_at  = NOW(),
         payout_amount   = v_pot,
         final_rank      = 1,
         calls_to_win    = (SELECT array_length(
                              ARRAY(SELECT jsonb_array_elements_text(drawn_numbers)::INT), 1
                            ) FROM bingo_rooms WHERE id = p_room_id)
   WHERE id = p_session_id;

  UPDATE bingo_rooms
     SET status        = 'finished',
         finished_at   = NOW(),
         winner_id     = p_user_id,
         prize_pot     = v_pot,
         derash_amount = v_room.entry_fee * v_player_count * v_room.house_cut
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success',     TRUE,
    'payout',      v_pot,
    'new_balance', v_new_balance
  );
END;
$$;


-- ── wallet_credit ────────────────────────────────────────────
-- Atomic credit + ledger write.  All credits must go through here.

CREATE OR REPLACE FUNCTION wallet_credit(
  p_user_id      BIGINT,
  p_amount       NUMERIC,
  p_type         TEXT,
  p_reference_id UUID    DEFAULT NULL,
  p_idem_key     TEXT    DEFAULT NULL,
  p_note         TEXT    DEFAULT NULL,
  p_is_bonus     BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance NUMERIC;
  v_idem        TEXT;
  v_tx_id       UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Credit amount must be positive');
  END IF;

  v_idem := COALESCE(p_idem_key, 'credit-' || p_user_id || '-' || gen_random_uuid()::TEXT);

  IF p_is_bonus THEN
    UPDATE users SET bonus_balance = bonus_balance + p_amount
    WHERE id = p_user_id RETURNING bonus_balance INTO v_new_balance;
  ELSE
    UPDATE users SET balance = balance + p_amount
    WHERE id = p_user_id RETURNING balance INTO v_new_balance;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  INSERT INTO wallet_transactions
    (user_id, amount, transaction_type, reference_id,
     idempotency_key, balance_after, note, is_bonus, status)
  VALUES
    (p_user_id, p_amount, p_type, p_reference_id,
     v_idem, v_new_balance, p_note, p_is_bonus, 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_new_balance, 'tx_id', v_tx_id);
END;
$$;


-- ── wallet_debit ─────────────────────────────────────────────
-- Atomic debit with insufficient-funds guard.  All debits must go through here.

CREATE OR REPLACE FUNCTION wallet_debit(
  p_user_id      BIGINT,
  p_amount       NUMERIC,
  p_type         TEXT,
  p_reference_id UUID    DEFAULT NULL,
  p_idem_key     TEXT    DEFAULT NULL,
  p_note         TEXT    DEFAULT NULL,
  p_is_bonus     BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current NUMERIC;
  v_new     NUMERIC;
  v_idem    TEXT;
  v_tx_id   UUID;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Debit amount must be positive');
  END IF;

  v_idem := COALESCE(p_idem_key, 'debit-' || p_user_id || '-' || gen_random_uuid()::TEXT);

  IF p_is_bonus THEN
    SELECT bonus_balance INTO v_current FROM users WHERE id = p_user_id FOR UPDATE;
  ELSE
    SELECT balance       INTO v_current FROM users WHERE id = p_user_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  IF v_current < p_amount THEN
    RETURN jsonb_build_object('error', 'Insufficient funds',
                              'available', v_current, 'required', p_amount);
  END IF;

  v_new := v_current - p_amount;

  IF p_is_bonus THEN
    UPDATE users SET bonus_balance = v_new WHERE id = p_user_id;
  ELSE
    UPDATE users SET balance       = v_new WHERE id = p_user_id;
  END IF;

  INSERT INTO wallet_transactions
    (user_id, amount, transaction_type, reference_id,
     idempotency_key, balance_after, note, is_bonus, status)
  VALUES
    (p_user_id, -p_amount, p_type, p_reference_id,
     v_idem, v_new, p_note, p_is_bonus, 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_new, 'tx_id', v_tx_id);
END;
$$;


-- ── process_deposit ──────────────────────────────────────────
-- Confirms a pending deposit_request and credits the wallet.

CREATE OR REPLACE FUNCTION process_deposit(
  p_deposit_id   UUID,
  p_provider_ref TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req    deposit_requests%ROWTYPE;
  v_result JSONB;
  v_tx_id  UUID;
BEGIN
  SELECT * INTO v_req FROM deposit_requests WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Deposit request not found');
  END IF;
  IF v_req.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Deposit already processed', 'status', v_req.status);
  END IF;
  IF NOW() > v_req.expires_at THEN
    UPDATE deposit_requests SET status = 'expired' WHERE id = p_deposit_id;
    RETURN jsonb_build_object('error', 'Deposit request expired');
  END IF;

  v_result := wallet_credit(
    p_user_id  => v_req.user_id,
    p_amount   => v_req.amount,
    p_type     => 'deposit',
    p_idem_key => 'deposit-' || p_deposit_id::TEXT,
    p_note     => 'Deposit via ' || v_req.payment_method
  );

  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;

  v_tx_id := (v_result->>'tx_id')::UUID;

  UPDATE deposit_requests
     SET status       = 'confirmed',
         confirmed_at = NOW(),
         provider_ref = COALESCE(p_provider_ref, provider_ref),
         wallet_tx_id = v_tx_id
   WHERE id = p_deposit_id;

  RETURN jsonb_build_object(
    'success',     TRUE,
    'amount',      v_req.amount,
    'new_balance', (v_result->>'new_balance')::NUMERIC,
    'tx_id',       v_tx_id
  );
END;
$$;


-- ── process_withdrawal ───────────────────────────────────────
-- Approves or rejects a withdrawal_request.

CREATE OR REPLACE FUNCTION process_withdrawal(
  p_withdrawal_id UUID,
  p_reviewer_id   BIGINT,
  p_approve       BOOLEAN,
  p_review_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req    withdrawal_requests%ROWTYPE;
  v_result JSONB;
  v_tx_id  UUID;
BEGIN
  SELECT * INTO v_req FROM withdrawal_requests WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Withdrawal request not found');
  END IF;
  IF v_req.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Withdrawal already processed', 'status', v_req.status);
  END IF;

  IF NOT p_approve THEN
    UPDATE withdrawal_requests
       SET status = 'rejected', reviewed_by = p_reviewer_id,
           review_note = p_review_note, reviewed_at = NOW()
     WHERE id = p_withdrawal_id;
    RETURN jsonb_build_object('success', TRUE, 'action', 'rejected');
  END IF;

  v_result := wallet_debit(
    p_user_id  => v_req.user_id,
    p_amount   => v_req.amount,
    p_type     => 'withdrawal',
    p_idem_key => 'withdrawal-' || p_withdrawal_id::TEXT,
    p_note     => 'Withdrawal via ' || v_req.payment_method
  );

  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;

  v_tx_id := (v_result->>'tx_id')::UUID;

  IF v_req.fee > 0 THEN
    PERFORM wallet_debit(
      p_user_id  => v_req.user_id,
      p_amount   => v_req.fee,
      p_type     => 'withdrawal_fee',
      p_idem_key => 'withdrawal-fee-' || p_withdrawal_id::TEXT,
      p_note     => 'Withdrawal processing fee'
    );
  END IF;

  UPDATE withdrawal_requests
     SET status = 'processing', reviewed_by = p_reviewer_id,
         review_note = p_review_note, reviewed_at = NOW(),
         wallet_tx_id = v_tx_id
   WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object(
    'success',     TRUE,
    'action',      'approved',
    'net_amount',  v_req.net_amount,
    'new_balance', (v_result->>'new_balance')::NUMERIC,
    'tx_id',       v_tx_id
  );
END;
$$;


-- ── buy_powerup ──────────────────────────────────────────────
-- Purchases a power-up, debits wallet, upserts inventory.

CREATE OR REPLACE FUNCTION buy_powerup(
  p_user_id   BIGINT,
  p_powerup   TEXT,
  p_quantity  SMALLINT DEFAULT 1,
  p_use_bonus BOOLEAN  DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_shop        powerup_shop%ROWTYPE;
  v_total_price NUMERIC;
  v_result      JSONB;
  v_tx_id       UUID;
  v_idem        TEXT;
BEGIN
  SELECT * INTO v_shop FROM powerup_shop WHERE powerup_type = p_powerup AND is_active = TRUE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Power-up not available');
  END IF;
  IF p_use_bonus AND NOT v_shop.is_bonus_eligible THEN
    RETURN jsonb_build_object('error', 'This power-up cannot be purchased with bonus balance');
  END IF;

  v_total_price := v_shop.price * p_quantity;
  v_idem        := 'powerup-' || p_user_id || '-' || p_powerup || '-' || gen_random_uuid()::TEXT;

  v_result := wallet_debit(
    p_user_id  => p_user_id,
    p_amount   => v_total_price,
    p_type     => 'admin_debit',
    p_idem_key => v_idem,
    p_note     => 'Purchased ' || p_quantity || '× ' || v_shop.display_name,
    p_is_bonus => p_use_bonus
  );

  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;

  v_tx_id := (v_result->>'tx_id')::UUID;

  INSERT INTO powerup_inventory (user_id, powerup_type, quantity)
  VALUES (p_user_id, p_powerup, p_quantity)
  ON CONFLICT (user_id, powerup_type)
  DO UPDATE SET quantity   = powerup_inventory.quantity + EXCLUDED.quantity,
                updated_at = NOW();

  INSERT INTO powerup_purchases
    (user_id, powerup_type, quantity, unit_price, paid_with_bonus, wallet_tx_id)
  VALUES
    (p_user_id, p_powerup, p_quantity, v_shop.price, p_use_bonus, v_tx_id);

  RETURN jsonb_build_object(
    'success',     TRUE,
    'powerup',     p_powerup,
    'quantity',    p_quantity,
    'total_price', v_total_price,
    'new_balance', (v_result->>'new_balance')::NUMERIC
  );
END;
$$;


-- ── draw_bingo_number ────────────────────────────────────────
-- Advances the draw sequence by one, appends to drawn_numbers,
-- and writes an audit row to bingo_draw_log.
-- Call this from a server-side cron / Edge Function.

CREATE OR REPLACE FUNCTION draw_bingo_number(
  p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room     bingo_rooms%ROWTYPE;
  v_seq      INT[];
  v_drawn    INT[];
  v_next_pos INT;
  v_next_num INT;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Room not found');
  END IF;
  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('error', 'Room is not active');
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.draw_sequence)::INT) INTO v_seq;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.drawn_numbers)::INT) INTO v_drawn;

  v_next_pos := COALESCE(array_length(v_drawn, 1), 0) + 1;

  IF v_next_pos > array_length(v_seq, 1) THEN
    RETURN jsonb_build_object('error', 'All 75 numbers have been drawn');
  END IF;

  v_next_num := v_seq[v_next_pos];

  UPDATE bingo_rooms
     SET drawn_numbers = drawn_numbers || to_jsonb(v_next_num)
   WHERE id = p_room_id;

  INSERT INTO bingo_draw_log (room_id, draw_position, number_drawn)
  VALUES (p_room_id, v_next_pos, v_next_num)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'success',       TRUE,
    'number_drawn',  v_next_num,
    'draw_position', v_next_pos,
    'total_drawn',   v_next_pos
  );
END;
$$;


-- ── get_wallet_summary ───────────────────────────────────────
-- Returns a user's full wallet + last 20 transactions + last 20
-- game records in one round-trip.
-- Mirrors the GET /api/bingo/wallet response shape exactly.

CREATE OR REPLACE FUNCTION get_wallet_summary(
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user      users%ROWTYPE;
  v_tx_rows   JSONB;
  v_game_rows JSONB;
BEGIN
  SELECT * INTO v_user FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  SELECT jsonb_agg(t ORDER BY t.created_at DESC)
    INTO v_tx_rows
    FROM (
      SELECT id, amount, transaction_type AS type, note,
             balance_after, is_bonus, status, created_at
        FROM wallet_transactions
       WHERE user_id = p_user_id
       ORDER BY created_at DESC
       LIMIT 20
    ) t;

  SELECT jsonb_agg(g ORDER BY g."createdAt" DESC)
    INTO v_game_rows
    FROM (
      SELECT gs.id,
             br.game_code                                          AS "gameId",
             br.entry_fee                                          AS stake,
             CASE WHEN gs.win_claimed THEN 'win' ELSE 'loss' END  AS result,
             COALESCE(gs.payout_amount, 0)                        AS payout,
             gs.joined_at                                          AS "createdAt"
        FROM game_sessions gs
        JOIN bingo_rooms   br ON br.id = gs.room_id
       WHERE gs.user_id = p_user_id
       ORDER BY gs.joined_at DESC
       LIMIT 20
    ) g;

  RETURN jsonb_build_object(
    'id',           v_user.id,
    'phone',        v_user.phone,
    'name',         COALESCE(v_user.display_name, v_user.username),
    'wallet',       v_user.balance,
    'bonus',        v_user.bonus_balance,
    'transactions', COALESCE(v_tx_rows,  '[]'::jsonb),
    'gameHistory',  COALESCE(v_game_rows,'[]'::jsonb)
  );
END;
$$;


-- ================================================================
-- §14  INDEXES
-- ================================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_auth_id
  ON users (auth_id) WHERE auth_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone
  ON users (phone)   WHERE phone   IS NOT NULL;

-- bingo_rooms
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_status
  ON bingo_rooms (status);
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_game_code
  ON bingo_rooms (game_code);
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_invite_code
  ON bingo_rooms (invite_code) WHERE invite_code IS NOT NULL;

-- game_sessions
CREATE INDEX IF NOT EXISTS idx_game_sessions_room
  ON game_sessions (room_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user
  ON game_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_win_claimed
  ON game_sessions (room_id) WHERE win_claimed = TRUE;

-- bingo_draw_log
CREATE INDEX IF NOT EXISTS idx_draw_log_room
  ON bingo_draw_log (room_id, draw_position);

-- wallet_transactions
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user
  ON wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_idem
  ON wallet_transactions (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type
  ON wallet_transactions (transaction_type);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_status
  ON wallet_transactions (status) WHERE status != 'completed';

-- deposit_requests
CREATE INDEX IF NOT EXISTS idx_deposit_req_user
  ON deposit_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposit_req_status
  ON deposit_requests (status) WHERE status = 'pending';

-- withdrawal_requests
CREATE INDEX IF NOT EXISTS idx_withdrawal_req_user
  ON withdrawal_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_req_status
  ON withdrawal_requests (status)
  WHERE status IN ('pending','approved','processing');

-- powerup_inventory
CREATE INDEX IF NOT EXISTS idx_powerup_inv_user
  ON powerup_inventory (user_id);

-- powerup_purchases
CREATE INDEX IF NOT EXISTS idx_powerup_purchases_user
  ON powerup_purchases (user_id, created_at DESC);

-- bets
CREATE INDEX IF NOT EXISTS idx_bets_user
  ON bets (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_slip
  ON bets (slip_id);
CREATE INDEX IF NOT EXISTS idx_bets_status
  ON bets (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bets_match
  ON bets (match_id);


-- ================================================================
-- §15  ROW-LEVEL SECURITY
-- ================================================================

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_rooms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE powerup_inventory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_draw_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE powerup_shop        ENABLE ROW LEVEL SECURITY;
ALTER TABLE powerup_purchases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets                ENABLE ROW LEVEL SECURITY;

-- users: own row only
DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_select_own" ON users FOR SELECT
  USING (auth_id = auth.uid() OR id::TEXT = auth.uid()::TEXT);
CREATE POLICY "users_update_own" ON users FOR UPDATE
  USING (auth_id = auth.uid() OR id::TEXT = auth.uid()::TEXT)
  WITH CHECK (auth_id = auth.uid() OR id::TEXT = auth.uid()::TEXT);

-- bingo_rooms: public read
DROP POLICY IF EXISTS "rooms_read" ON bingo_rooms;
CREATE POLICY "rooms_read" ON bingo_rooms FOR SELECT USING (TRUE);

-- game_sessions: own sessions only
DROP POLICY IF EXISTS "sessions_own" ON game_sessions;
CREATE POLICY "sessions_own" ON game_sessions FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);

-- wallet_transactions: own rows only
DROP POLICY IF EXISTS "tx_own" ON wallet_transactions;
CREATE POLICY "tx_own" ON wallet_transactions FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);

-- powerup_inventory: own rows only
DROP POLICY IF EXISTS "inv_own" ON powerup_inventory;
CREATE POLICY "inv_own" ON powerup_inventory FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);

-- bingo_draw_log: public read (game transparency)
DROP POLICY IF EXISTS "draw_log_read" ON bingo_draw_log;
CREATE POLICY "draw_log_read" ON bingo_draw_log FOR SELECT USING (TRUE);

-- powerup_shop: public read (active items only)
DROP POLICY IF EXISTS "shop_read" ON powerup_shop;
CREATE POLICY "shop_read" ON powerup_shop FOR SELECT USING (is_active = TRUE);

-- powerup_purchases: own rows only
DROP POLICY IF EXISTS "purchases_own" ON powerup_purchases;
CREATE POLICY "purchases_own" ON powerup_purchases FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);

-- deposit_requests: own rows only
DROP POLICY IF EXISTS "deposits_own"        ON deposit_requests;
DROP POLICY IF EXISTS "deposits_insert_own" ON deposit_requests;
CREATE POLICY "deposits_own" ON deposit_requests FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);
CREATE POLICY "deposits_insert_own" ON deposit_requests FOR INSERT
  WITH CHECK (auth.uid()::TEXT = user_id::TEXT);

-- withdrawal_requests: own rows only
DROP POLICY IF EXISTS "withdrawals_own"        ON withdrawal_requests;
DROP POLICY IF EXISTS "withdrawals_insert_own" ON withdrawal_requests;
CREATE POLICY "withdrawals_own" ON withdrawal_requests FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);
CREATE POLICY "withdrawals_insert_own" ON withdrawal_requests FOR INSERT
  WITH CHECK (auth.uid()::TEXT = user_id::TEXT);

-- bets: own rows only
DROP POLICY IF EXISTS "bets_own"        ON bets;
DROP POLICY IF EXISTS "bets_insert_own" ON bets;
CREATE POLICY "bets_own" ON bets FOR SELECT
  USING (auth.uid()::TEXT = user_id::TEXT);
CREATE POLICY "bets_insert_own" ON bets FOR INSERT
  WITH CHECK (auth.uid()::TEXT = user_id::TEXT);


-- ================================================================
-- END OF MIGRATION
-- ================================================================
