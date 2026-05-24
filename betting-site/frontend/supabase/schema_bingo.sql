-- ================================================================
-- TurboPlay — BINGO EXPANSION
-- Run this in your EXISTING Supabase project (the same one
-- the Flask betting backend already uses).
--
-- Your existing tables (users, bets) are NOT touched.
-- This file only ADDS new bingo_* tables alongside them.
--
-- New tables added:
--   bingo_users            — phone auth, ETB wallet (UUID PK)
--   bingo_rooms            — game lobbies
--   bingo_sessions         — per-player card + daub state
--   bingo_wallet_tx        — immutable financial ledger
--   bingo_draw_log         — per-draw audit trail
--   bingo_powerup_shop
--   bingo_powerup_inventory
--   bingo_powerup_purchases
--   bingo_deposit_requests
--   bingo_withdrawal_requests
--
-- New views:
--   bingo_wallet_balances
--   bingo_leaderboard      (materialised)
--
-- New RPCs (all prefixed bingo_):
--   bingo_wallet_credit / bingo_wallet_debit
--   bingo_join_room
--   bingo_validate_win / bingo_claim_win
--   bingo_draw_number
--   bingo_process_deposit / bingo_process_withdrawal
--   bingo_buy_powerup
--   bingo_get_wallet_summary
-- ================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ================================================================
-- BINGO_USERS
-- Separate from the betting "users" table.
-- Uses UUID PK + phone auth (no Supabase Auth required).
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_users (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT          NOT NULL UNIQUE,
  password_hash TEXT          NOT NULL,
  display_name  TEXT          NOT NULL DEFAULT 'Player',
  avatar_url    TEXT,
  balance       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
  bonus_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (bonus_balance >= 0),
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  is_verified   BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION bingo_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_bingo_users_updated_at ON bingo_users;
CREATE TRIGGER trg_bingo_users_updated_at
  BEFORE UPDATE ON bingo_users
  FOR EACH ROW EXECUTE FUNCTION bingo_set_updated_at();

-- ================================================================
-- BINGO_ROOMS
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_rooms (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_fee        NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  max_players      INT           NOT NULL DEFAULT 2,
  status           TEXT          NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting','active','finished')),
  winning_patterns JSONB         NOT NULL DEFAULT '["row","column","diagonal","four_corners","full_house"]'::jsonb,
  drawn_numbers    JSONB         NOT NULL DEFAULT '[]'::jsonb,
  draw_sequence    JSONB         NOT NULL DEFAULT '[]'::jsonb,
  house_cut        NUMERIC(5,4)  NOT NULL DEFAULT 0.2000
                     CHECK (house_cut >= 0 AND house_cut < 1),
  prize_pot        NUMERIC(14,2),
  derash_amount    NUMERIC(14,2),
  game_code        TEXT          UNIQUE,
  card_assignments JSONB         NOT NULL DEFAULT '{}'::jsonb,
  countdown_secs   INT           NOT NULL DEFAULT 30,
  draw_interval_ms INT           NOT NULL DEFAULT 4000,
  room_type        TEXT          NOT NULL DEFAULT 'public'
                     CHECK (room_type IN ('public','private')),
  invite_code      TEXT          UNIQUE,
  stake_label      TEXT GENERATED ALWAYS AS (
    CASE
      WHEN entry_fee <= 10  THEN 'Starter'
      WHEN entry_fee <= 50  THEN 'Standard'
      WHEN entry_fee <= 100 THEN 'Premium'
      ELSE 'High Roller'
    END
  ) STORED,
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  winner_id        UUID REFERENCES bingo_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- BINGO_SESSIONS
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_sessions (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID          NOT NULL REFERENCES bingo_rooms(id)  ON DELETE CASCADE,
  user_id         UUID          NOT NULL REFERENCES bingo_users(id)  ON DELETE CASCADE,
  card            JSONB         NOT NULL,
  card_index      SMALLINT      CHECK (card_index BETWEEN 1 AND 100),
  daubed          JSONB         NOT NULL DEFAULT '[]'::jsonb,
  powerups_used   JSONB         NOT NULL DEFAULT '[]'::jsonb,
  final_rank      SMALLINT,
  win_claimed     BOOLEAN       NOT NULL DEFAULT FALSE,
  win_claimed_at  TIMESTAMPTZ,
  payout_amount   NUMERIC(14,2),
  calls_to_win    SMALLINT,
  winning_pattern TEXT CHECK (winning_pattern IN (
                    'row','column','diagonal','four_corners','full_house')),
  joined_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

-- ================================================================
-- BINGO_WALLET_TX  (immutable ledger)
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_wallet_tx (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES bingo_users(id) ON DELETE CASCADE,
  amount          NUMERIC(14,2) NOT NULL,
  tx_type         TEXT          NOT NULL CHECK (tx_type IN (
    'bingo_entry','bingo_win','bingo_refund',
    'deposit','withdrawal','withdrawal_fee',
    'bonus_credit','bonus_debit',
    'admin_credit','admin_debit'
  )),
  reference_id    UUID,
  idempotency_key TEXT          UNIQUE NOT NULL,
  balance_after   NUMERIC(14,2),
  is_bonus        BOOLEAN       NOT NULL DEFAULT FALSE,
  note            TEXT,
  ip_address      INET,
  status          TEXT          NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('pending','completed','failed','reversed')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ================================================================
-- BINGO_DRAW_LOG
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_draw_log (
  id            BIGSERIAL PRIMARY KEY,
  room_id       UUID      NOT NULL REFERENCES bingo_rooms(id) ON DELETE CASCADE,
  draw_position SMALLINT  NOT NULL CHECK (draw_position BETWEEN 1 AND 75),
  number_drawn  SMALLINT  NOT NULL CHECK (number_drawn  BETWEEN 1 AND 75),
  drawn_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, draw_position),
  UNIQUE (room_id, number_drawn)
);

-- ================================================================
-- BINGO_POWERUP_SHOP + INVENTORY + PURCHASES
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_powerup_shop (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  powerup_type      TEXT          NOT NULL UNIQUE
                      CHECK (powerup_type IN ('instant_daub','coin_multiplier','extra_card')),
  display_name      TEXT          NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_bonus_eligible BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order        SMALLINT      NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO bingo_powerup_shop
  (powerup_type, display_name, description, price, is_bonus_eligible, sort_order)
VALUES
  ('instant_daub',    'Instant Daub',    'Auto-daubs one called number on your card.',  5.00, TRUE,  1),
  ('coin_multiplier', 'Coin Multiplier', 'Doubles your payout if you win this game.',  15.00, FALSE, 2),
  ('extra_card',      'Extra Card',      'Play a second bingo card in the same room.', 10.00, TRUE,  3)
ON CONFLICT (powerup_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS bingo_powerup_inventory (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID     NOT NULL REFERENCES bingo_users(id) ON DELETE CASCADE,
  powerup_type TEXT     NOT NULL
                 CHECK (powerup_type IN ('instant_daub','coin_multiplier','extra_card')),
  quantity     INT      NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, powerup_type)
);

CREATE TABLE IF NOT EXISTS bingo_powerup_purchases (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES bingo_users(id) ON DELETE CASCADE,
  powerup_type    TEXT          NOT NULL REFERENCES bingo_powerup_shop(powerup_type),
  quantity        SMALLINT      NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price      NUMERIC(10,2) NOT NULL,
  total_price     NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  paid_with_bonus BOOLEAN       NOT NULL DEFAULT FALSE,
  wallet_tx_id    UUID          REFERENCES bingo_wallet_tx(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ================================================================
-- BINGO_DEPOSIT_REQUESTS
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_deposit_requests (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID          NOT NULL REFERENCES bingo_users(id) ON DELETE CASCADE,
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method    TEXT          NOT NULL DEFAULT 'mpesa'
                      CHECK (payment_method IN (
                        'mpesa','telebirr','cbe_birr','bank_transfer','card','admin')),
  provider_ref      TEXT,
  provider_response JSONB,
  status            TEXT          NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','confirmed','failed','expired')),
  wallet_tx_id      UUID          REFERENCES bingo_wallet_tx(id),
  expires_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  confirmed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ================================================================
-- BINGO_WITHDRAWAL_REQUESTS
-- ================================================================

CREATE TABLE IF NOT EXISTS bingo_withdrawal_requests (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID          NOT NULL REFERENCES bingo_users(id) ON DELETE CASCADE,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  fee            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0),
  net_amount     NUMERIC(14,2) GENERATED ALWAYS AS (amount - fee) STORED,
  payment_method TEXT          NOT NULL DEFAULT 'mpesa'
                   CHECK (payment_method IN (
                     'mpesa','telebirr','cbe_birr','bank_transfer','card')),
  destination    JSONB         NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT          NOT NULL DEFAULT 'pending'
                   CHECK (status IN (
                     'pending','approved','processing','completed','rejected','cancelled')),
  reviewed_by    UUID          REFERENCES bingo_users(id),
  review_note    TEXT,
  reviewed_at    TIMESTAMPTZ,
  wallet_tx_id   UUID          REFERENCES bingo_wallet_tx(id),
  provider_ref   TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- ================================================================
-- VIEWS
-- ================================================================

CREATE OR REPLACE VIEW bingo_wallet_balances AS
SELECT
  user_id,
  SUM(amount) FILTER (WHERE NOT is_bonus) AS real_balance,
  SUM(amount) FILTER (WHERE     is_bonus) AS bonus_balance,
  SUM(amount)                             AS total_balance,
  COUNT(*)                                AS tx_count,
  MAX(created_at)                         AS last_tx_at
FROM bingo_wallet_tx
WHERE status = 'completed'
GROUP BY user_id;

CREATE MATERIALIZED VIEW IF NOT EXISTS bingo_leaderboard AS
SELECT
  u.id                                                     AS user_id,
  u.display_name,
  COUNT(s.id)                                              AS games_played,
  COUNT(s.id) FILTER (WHERE s.win_claimed)                 AS games_won,
  COALESCE(SUM(s.payout_amount), 0)                        AS total_winnings,
  COALESCE(SUM(r.entry_fee), 0)                            AS total_staked,
  ROUND(
    COUNT(s.id) FILTER (WHERE s.win_claimed)::NUMERIC
    / NULLIF(COUNT(s.id), 0) * 100, 1
  )                                                        AS win_rate_pct,
  MIN(s.calls_to_win) FILTER (WHERE s.win_claimed)         AS best_calls_to_win,
  MAX(s.joined_at)                                         AS last_played_at
FROM bingo_users u
LEFT JOIN bingo_sessions s ON s.user_id = u.id
LEFT JOIN bingo_rooms    r ON r.id      = s.room_id
GROUP BY u.id, u.display_name
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bingo_leaderboard_user
  ON bingo_leaderboard (user_id);

-- ================================================================
-- RPCs
-- ================================================================

CREATE OR REPLACE FUNCTION bingo_wallet_credit(
  p_user_id UUID, p_amount NUMERIC, p_type TEXT,
  p_reference_id UUID DEFAULT NULL, p_idem_key TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL, p_is_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new NUMERIC; v_idem TEXT; v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error','Credit amount must be positive'); END IF;
  v_idem := COALESCE(p_idem_key, 'bc-' || p_user_id || '-' || gen_random_uuid()::TEXT);
  IF p_is_bonus THEN
    UPDATE bingo_users SET bonus_balance = bonus_balance + p_amount WHERE id = p_user_id RETURNING bonus_balance INTO v_new;
  ELSE
    UPDATE bingo_users SET balance = balance + p_amount WHERE id = p_user_id RETURNING balance INTO v_new;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','User not found'); END IF;
  INSERT INTO bingo_wallet_tx (user_id,amount,tx_type,reference_id,idempotency_key,balance_after,note,is_bonus,status)
  VALUES (p_user_id,p_amount,p_type,p_reference_id,v_idem,v_new,p_note,p_is_bonus,'completed')
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_tx_id;
  RETURN jsonb_build_object('success',TRUE,'new_balance',v_new,'tx_id',v_tx_id);
END; $$;

CREATE OR REPLACE FUNCTION bingo_wallet_debit(
  p_user_id UUID, p_amount NUMERIC, p_type TEXT,
  p_reference_id UUID DEFAULT NULL, p_idem_key TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL, p_is_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_cur NUMERIC; v_new NUMERIC; v_idem TEXT; v_tx_id UUID;
BEGIN
  IF p_amount <= 0 THEN RETURN jsonb_build_object('error','Debit amount must be positive'); END IF;
  v_idem := COALESCE(p_idem_key, 'bd-' || p_user_id || '-' || gen_random_uuid()::TEXT);
  IF p_is_bonus THEN
    SELECT bonus_balance INTO v_cur FROM bingo_users WHERE id = p_user_id FOR UPDATE;
  ELSE
    SELECT balance INTO v_cur FROM bingo_users WHERE id = p_user_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','User not found'); END IF;
  IF v_cur < p_amount THEN
    RETURN jsonb_build_object('error','Insufficient funds','available',v_cur,'required',p_amount);
  END IF;
  v_new := v_cur - p_amount;
  IF p_is_bonus THEN
    UPDATE bingo_users SET bonus_balance = v_new WHERE id = p_user_id;
  ELSE
    UPDATE bingo_users SET balance = v_new WHERE id = p_user_id;
  END IF;
  INSERT INTO bingo_wallet_tx (user_id,amount,tx_type,reference_id,idempotency_key,balance_after,note,is_bonus,status)
  VALUES (p_user_id,-p_amount,p_type,p_reference_id,v_idem,v_new,p_note,p_is_bonus,'completed')
  ON CONFLICT (idempotency_key) DO NOTHING RETURNING id INTO v_tx_id;
  RETURN jsonb_build_object('success',TRUE,'new_balance',v_new,'tx_id',v_tx_id);
END; $$;

CREATE OR REPLACE FUNCTION bingo_join_room(
  p_user_id UUID, p_room_id UUID, p_card JSONB, p_idem_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_room bingo_rooms%ROWTYPE; v_bal NUMERIC; v_new_bal NUMERIC; v_sess_id UUID;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Room not found'); END IF;
  IF v_room.status != 'waiting' THEN RETURN jsonb_build_object('error','Room not accepting players'); END IF;
  IF EXISTS (SELECT 1 FROM bingo_sessions WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('error','Already joined this room');
  END IF;
  IF (SELECT COUNT(*) FROM bingo_sessions WHERE room_id = p_room_id) >= v_room.max_players THEN
    RETURN jsonb_build_object('error','Room is full');
  END IF;
  SELECT balance INTO v_bal FROM bingo_users WHERE id = p_user_id FOR UPDATE;
  IF v_bal < v_room.entry_fee THEN RETURN jsonb_build_object('error','Insufficient funds'); END IF;
  v_new_bal := v_bal - v_room.entry_fee;
  UPDATE bingo_users SET balance = v_new_bal WHERE id = p_user_id;
  INSERT INTO bingo_wallet_tx (user_id,amount,tx_type,reference_id,idempotency_key,balance_after,note,status)
  VALUES (p_user_id,-v_room.entry_fee,'bingo_entry',p_room_id,p_idem_key,v_new_bal,'Bingo room entry fee','completed')
  ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO bingo_sessions (room_id,user_id,card) VALUES (p_room_id,p_user_id,p_card) RETURNING id INTO v_sess_id;
  IF (SELECT COUNT(*) FROM bingo_sessions WHERE room_id = p_room_id) >= v_room.max_players THEN
    UPDATE bingo_rooms SET status = 'active', started_at = NOW() WHERE id = p_room_id;
  END IF;
  RETURN jsonb_build_object('success',TRUE,'session_id',v_sess_id,'new_balance',v_new_bal);
END; $$;

CREATE OR REPLACE FUNCTION bingo_validate_win(p_session_id UUID, p_room_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sess bingo_sessions%ROWTYPE; v_room bingo_rooms%ROWTYPE;
  v_daubed INT[]; v_drawn INT[]; v_card INT[]; v_patterns TEXT[];
  v_is_win BOOLEAN := FALSE; v_pattern TEXT;
  v_rows   INT[][] := ARRAY[ARRAY[0,1,2,3,4],ARRAY[5,6,7,8,9],ARRAY[10,11,12,13,14],ARRAY[15,16,17,18,19],ARRAY[20,21,22,23,24]];
  v_cols   INT[][] := ARRAY[ARRAY[0,5,10,15,20],ARRAY[1,6,11,16,21],ARRAY[2,7,12,17,22],ARRAY[3,8,13,18,23],ARRAY[4,9,14,19,24]];
  v_diags  INT[][] := ARRAY[ARRAY[0,6,12,18,24],ARRAY[4,8,12,16,20]];
  v_corners INT[]  := ARRAY[0,4,20,24];
  v_line INT[]; v_ok BOOLEAN; i INT;
BEGIN
  SELECT * INTO v_sess FROM bingo_sessions WHERE id = p_session_id AND room_id = p_room_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('valid',FALSE,'error','Session not found'); END IF;
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id;
  IF v_room.status != 'active' THEN RETURN jsonb_build_object('valid',FALSE,'error','Game not active'); END IF;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_sess.daubed)::INT)        INTO v_daubed;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.drawn_numbers)::INT) INTO v_drawn;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_sess.card)::INT)          INTO v_card;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.winning_patterns))   INTO v_patterns;
  IF NOT (12 = ANY(v_daubed)) THEN v_daubed := v_daubed || ARRAY[12]; END IF;
  FOR i IN 1..array_length(v_daubed,1) LOOP
    IF v_card[v_daubed[i]+1] != 0 AND NOT (v_card[v_daubed[i]+1] = ANY(v_drawn)) THEN
      RETURN jsonb_build_object('valid',FALSE,'error','Invalid daub — number not drawn');
    END IF;
  END LOOP;
  FOREACH v_pattern IN ARRAY v_patterns LOOP
    IF v_pattern = 'row' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_rows LOOP
        v_ok := TRUE;
        FOREACH i IN ARRAY v_line LOOP IF NOT (i=ANY(v_daubed)) THEN v_ok:=FALSE; EXIT; END IF; END LOOP;
        IF v_ok THEN v_is_win:=TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'column' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_cols LOOP
        v_ok := TRUE;
        FOREACH i IN ARRAY v_line LOOP IF NOT (i=ANY(v_daubed)) THEN v_ok:=FALSE; EXIT; END IF; END LOOP;
        IF v_ok THEN v_is_win:=TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'diagonal' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_diags LOOP
        v_ok := TRUE;
        FOREACH i IN ARRAY v_line LOOP IF NOT (i=ANY(v_daubed)) THEN v_ok:=FALSE; EXIT; END IF; END LOOP;
        IF v_ok THEN v_is_win:=TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'four_corners' THEN
      v_ok := TRUE;
      FOREACH i IN ARRAY v_corners LOOP IF NOT (i=ANY(v_daubed)) THEN v_ok:=FALSE; EXIT; END IF; END LOOP;
      IF v_ok THEN v_is_win:=TRUE; END IF;
    ELSIF v_pattern = 'full_house' THEN
      v_ok := TRUE;
      FOR i IN 0..24 LOOP IF NOT (i=ANY(v_daubed)) THEN v_ok:=FALSE; EXIT; END IF; END LOOP;
      IF v_ok THEN v_is_win:=TRUE; END IF;
    END IF;
    EXIT WHEN v_is_win;
  END LOOP;
  RETURN jsonb_build_object('valid',v_is_win);
END; $$;

CREATE OR REPLACE FUNCTION bingo_claim_win(
  p_session_id UUID, p_room_id UUID, p_user_id UUID, p_idem_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_val JSONB; v_room bingo_rooms%ROWTYPE; v_count INT; v_pot NUMERIC; v_new_bal NUMERIC;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status != 'active' THEN RETURN jsonb_build_object('error','Game is not active'); END IF;
  v_val := bingo_validate_win(p_session_id, p_room_id);
  IF NOT (v_val->>'valid')::BOOLEAN THEN
    RETURN jsonb_build_object('error','Invalid bingo claim: ' || (v_val->>'error'));
  END IF;
  SELECT COUNT(*) INTO v_count FROM bingo_sessions WHERE room_id = p_room_id;
  v_pot := ROUND(v_room.entry_fee * v_count * (1 - v_room.house_cut), 2);
  UPDATE bingo_users SET balance = balance + v_pot WHERE id = p_user_id RETURNING balance INTO v_new_bal;
  INSERT INTO bingo_wallet_tx (user_id,amount,tx_type,reference_id,idempotency_key,balance_after,note,status)
  VALUES (p_user_id,v_pot,'bingo_win',p_room_id,p_idem_key,v_new_bal,'Bingo win payout','completed')
  ON CONFLICT (idempotency_key) DO NOTHING;
  UPDATE bingo_sessions
     SET win_claimed=TRUE, win_claimed_at=NOW(), payout_amount=v_pot, final_rank=1,
         calls_to_win=(SELECT array_length(ARRAY(SELECT jsonb_array_elements_text(drawn_numbers)::INT),1)
                       FROM bingo_rooms WHERE id = p_room_id)
   WHERE id = p_session_id;
  UPDATE bingo_rooms
     SET status='finished', finished_at=NOW(), winner_id=p_user_id,
         prize_pot=v_pot, derash_amount=v_room.entry_fee * v_count * v_room.house_cut
   WHERE id = p_room_id;
  RETURN jsonb_build_object('success',TRUE,'payout',v_pot,'new_balance',v_new_bal);
END; $$;

CREATE OR REPLACE FUNCTION bingo_draw_number(p_room_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_room bingo_rooms%ROWTYPE; v_seq INT[]; v_drawn INT[]; v_pos INT; v_num INT;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Room not found'); END IF;
  IF v_room.status != 'active' THEN RETURN jsonb_build_object('error','Room is not active'); END IF;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.draw_sequence)::INT) INTO v_seq;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.drawn_numbers)::INT) INTO v_drawn;
  v_pos := COALESCE(array_length(v_drawn,1), 0) + 1;
  IF v_pos > array_length(v_seq,1) THEN RETURN jsonb_build_object('error','All 75 numbers have been drawn'); END IF;
  v_num := v_seq[v_pos];
  UPDATE bingo_rooms SET drawn_numbers = drawn_numbers || to_jsonb(v_num) WHERE id = p_room_id;
  INSERT INTO bingo_draw_log (room_id,draw_position,number_drawn) VALUES (p_room_id,v_pos,v_num) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('success',TRUE,'number_drawn',v_num,'draw_position',v_pos,'total_drawn',v_pos);
END; $$;

CREATE OR REPLACE FUNCTION bingo_process_deposit(p_deposit_id UUID, p_provider_ref TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_req bingo_deposit_requests%ROWTYPE; v_result JSONB; v_tx_id UUID;
BEGIN
  SELECT * INTO v_req FROM bingo_deposit_requests WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Deposit request not found'); END IF;
  IF v_req.status != 'pending' THEN RETURN jsonb_build_object('error','Already processed','status',v_req.status); END IF;
  IF NOW() > v_req.expires_at THEN
    UPDATE bingo_deposit_requests SET status='expired' WHERE id=p_deposit_id;
    RETURN jsonb_build_object('error','Deposit request expired');
  END IF;
  v_result := bingo_wallet_credit(p_user_id=>v_req.user_id,p_amount=>v_req.amount,p_type=>'deposit',
    p_idem_key=>'dep-'||p_deposit_id::TEXT,p_note=>'Deposit via '||v_req.payment_method);
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
  v_tx_id := (v_result->>'tx_id')::UUID;
  UPDATE bingo_deposit_requests
     SET status='confirmed', confirmed_at=NOW(),
         provider_ref=COALESCE(p_provider_ref,provider_ref), wallet_tx_id=v_tx_id
   WHERE id=p_deposit_id;
  RETURN jsonb_build_object('success',TRUE,'amount',v_req.amount,
    'new_balance',(v_result->>'new_balance')::NUMERIC,'tx_id',v_tx_id);
END; $$;

CREATE OR REPLACE FUNCTION bingo_process_withdrawal(
  p_withdrawal_id UUID, p_reviewer_id UUID, p_approve BOOLEAN, p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_req bingo_withdrawal_requests%ROWTYPE; v_result JSONB; v_tx_id UUID;
BEGIN
  SELECT * INTO v_req FROM bingo_withdrawal_requests WHERE id=p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Withdrawal not found'); END IF;
  IF v_req.status != 'pending' THEN RETURN jsonb_build_object('error','Already processed','status',v_req.status); END IF;
  IF NOT p_approve THEN
    UPDATE bingo_withdrawal_requests SET status='rejected',reviewed_by=p_reviewer_id,
      review_note=p_review_note,reviewed_at=NOW() WHERE id=p_withdrawal_id;
    RETURN jsonb_build_object('success',TRUE,'action','rejected');
  END IF;
  v_result := bingo_wallet_debit(p_user_id=>v_req.user_id,p_amount=>v_req.amount,p_type=>'withdrawal',
    p_idem_key=>'wd-'||p_withdrawal_id::TEXT,p_note=>'Withdrawal via '||v_req.payment_method);
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
  v_tx_id := (v_result->>'tx_id')::UUID;
  IF v_req.fee > 0 THEN
    PERFORM bingo_wallet_debit(p_user_id=>v_req.user_id,p_amount=>v_req.fee,p_type=>'withdrawal_fee',
      p_idem_key=>'wd-fee-'||p_withdrawal_id::TEXT,p_note=>'Withdrawal processing fee');
  END IF;
  UPDATE bingo_withdrawal_requests SET status='processing',reviewed_by=p_reviewer_id,
    review_note=p_review_note,reviewed_at=NOW(),wallet_tx_id=v_tx_id WHERE id=p_withdrawal_id;
  RETURN jsonb_build_object('success',TRUE,'action','approved',
    'net_amount',v_req.net_amount,'new_balance',(v_result->>'new_balance')::NUMERIC,'tx_id',v_tx_id);
END; $$;

CREATE OR REPLACE FUNCTION bingo_buy_powerup(
  p_user_id UUID, p_powerup TEXT, p_quantity SMALLINT DEFAULT 1, p_use_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_shop bingo_powerup_shop%ROWTYPE; v_total NUMERIC; v_res JSONB; v_tx_id UUID; v_idem TEXT;
BEGIN
  SELECT * INTO v_shop FROM bingo_powerup_shop WHERE powerup_type=p_powerup AND is_active=TRUE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','Power-up not available'); END IF;
  IF p_use_bonus AND NOT v_shop.is_bonus_eligible THEN
    RETURN jsonb_build_object('error','Cannot buy this power-up with bonus balance');
  END IF;
  v_total := v_shop.price * p_quantity;
  v_idem  := 'pu-' || p_user_id || '-' || p_powerup || '-' || gen_random_uuid()::TEXT;
  v_res := bingo_wallet_debit(p_user_id=>p_user_id,p_amount=>v_total,p_type=>'admin_debit',
    p_idem_key=>v_idem,p_note=>'Purchased '||p_quantity||'× '||v_shop.display_name,p_is_bonus=>p_use_bonus);
  IF v_res->>'error' IS NOT NULL THEN RETURN v_res; END IF;
  v_tx_id := (v_res->>'tx_id')::UUID;
  INSERT INTO bingo_powerup_inventory (user_id,powerup_type,quantity) VALUES (p_user_id,p_powerup,p_quantity)
  ON CONFLICT (user_id,powerup_type) DO UPDATE SET quantity=bingo_powerup_inventory.quantity+EXCLUDED.quantity,updated_at=NOW();
  INSERT INTO bingo_powerup_purchases (user_id,powerup_type,quantity,unit_price,paid_with_bonus,wallet_tx_id)
  VALUES (p_user_id,p_powerup,p_quantity,v_shop.price,p_use_bonus,v_tx_id);
  RETURN jsonb_build_object('success',TRUE,'powerup',p_powerup,'quantity',p_quantity,
    'total_price',v_total,'new_balance',(v_res->>'new_balance')::NUMERIC);
END; $$;

CREATE OR REPLACE FUNCTION bingo_get_wallet_summary(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user bingo_users%ROWTYPE; v_tx_rows JSONB; v_game_rows JSONB;
BEGIN
  SELECT * INTO v_user FROM bingo_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','User not found'); END IF;
  SELECT jsonb_agg(t ORDER BY t.created_at DESC) INTO v_tx_rows FROM (
    SELECT id, amount, tx_type AS type, note, balance_after, is_bonus, status, created_at
      FROM bingo_wallet_tx WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 20
  ) t;
  SELECT jsonb_agg(g ORDER BY g."createdAt" DESC) INTO v_game_rows FROM (
    SELECT s.id,
           r.game_code                                         AS "gameId",
           r.entry_fee                                         AS stake,
           CASE WHEN s.win_claimed THEN 'win' ELSE 'loss' END AS result,
           COALESCE(s.payout_amount, 0)                        AS payout,
           s.joined_at                                         AS "createdAt"
      FROM bingo_sessions s
      JOIN bingo_rooms    r ON r.id = s.room_id
     WHERE s.user_id=p_user_id ORDER BY s.joined_at DESC LIMIT 20
  ) g;
  RETURN jsonb_build_object(
    'id',          v_user.id,
    'phone',       v_user.phone,
    'name',        v_user.display_name,
    'wallet',      v_user.balance,
    'bonus',       v_user.bonus_balance,
    'transactions',COALESCE(v_tx_rows,  '[]'::jsonb),
    'gameHistory', COALESCE(v_game_rows,'[]'::jsonb)
  );
END; $$;

-- ================================================================
-- INDEXES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_bingo_users_phone      ON bingo_users (phone);
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_status     ON bingo_rooms (status);
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_game_code  ON bingo_rooms (game_code);
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_invite     ON bingo_rooms (invite_code) WHERE invite_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bingo_sess_room        ON bingo_sessions (room_id);
CREATE INDEX IF NOT EXISTS idx_bingo_sess_user        ON bingo_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_bingo_sess_win         ON bingo_sessions (room_id) WHERE win_claimed = TRUE;
CREATE INDEX IF NOT EXISTS idx_bingo_draw_log_room    ON bingo_draw_log (room_id, draw_position);
CREATE INDEX IF NOT EXISTS idx_bingo_wallet_tx_user   ON bingo_wallet_tx (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bingo_wallet_tx_idem   ON bingo_wallet_tx (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_bingo_wallet_tx_status ON bingo_wallet_tx (status) WHERE status != 'completed';
CREATE INDEX IF NOT EXISTS idx_bingo_dep_req_user     ON bingo_deposit_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bingo_dep_req_status   ON bingo_deposit_requests (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bingo_wd_req_user      ON bingo_withdrawal_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bingo_wd_req_status    ON bingo_withdrawal_requests (status)
  WHERE status IN ('pending','approved','processing');
CREATE INDEX IF NOT EXISTS idx_bingo_inv_user         ON bingo_powerup_inventory (user_id);
CREATE INDEX IF NOT EXISTS idx_bingo_purchases_user   ON bingo_powerup_purchases (user_id, created_at DESC);

-- ================================================================
-- ROW-LEVEL SECURITY
-- ================================================================

ALTER TABLE bingo_users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_rooms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_sessions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_wallet_tx           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_draw_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_powerup_shop        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_powerup_inventory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_powerup_purchases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_deposit_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bu_select_own" ON bingo_users;
DROP POLICY IF EXISTS "bu_update_own" ON bingo_users;
CREATE POLICY "bu_select_own" ON bingo_users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "bu_update_own" ON bingo_users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "br_read" ON bingo_rooms;
CREATE POLICY "br_read" ON bingo_rooms FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "bs_own" ON bingo_sessions;
CREATE POLICY "bs_own" ON bingo_sessions FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "bwt_own" ON bingo_wallet_tx;
CREATE POLICY "bwt_own" ON bingo_wallet_tx FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "bdl_read" ON bingo_draw_log;
CREATE POLICY "bdl_read" ON bingo_draw_log FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "bps_read" ON bingo_powerup_shop;
CREATE POLICY "bps_read" ON bingo_powerup_shop FOR SELECT USING (is_active = TRUE);

DROP POLICY IF EXISTS "bpi_own" ON bingo_powerup_inventory;
CREATE POLICY "bpi_own" ON bingo_powerup_inventory FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "bpp_own" ON bingo_powerup_purchases;
CREATE POLICY "bpp_own" ON bingo_powerup_purchases FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "bdr_own"    ON bingo_deposit_requests;
DROP POLICY IF EXISTS "bdr_insert" ON bingo_deposit_requests;
CREATE POLICY "bdr_own"    ON bingo_deposit_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "bdr_insert" ON bingo_deposit_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "bwr_own"    ON bingo_withdrawal_requests;
DROP POLICY IF EXISTS "bwr_insert" ON bingo_withdrawal_requests;
CREATE POLICY "bwr_own"    ON bingo_withdrawal_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "bwr_insert" ON bingo_withdrawal_requests FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ================================================================
-- END OF BINGO EXPANSION
-- ================================================================
