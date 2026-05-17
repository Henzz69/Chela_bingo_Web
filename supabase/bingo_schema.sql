-- ============================================================
-- TurboPlay — Wana Bingo: Phase 1 Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ── EXTENSION: pgcrypto for secure RNG ──────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLE: bingo_rooms
-- Represents a game lobby that players can join
-- ============================================================
CREATE TABLE IF NOT EXISTS bingo_rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_fee     NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
  max_players   INT NOT NULL DEFAULT 2,
  status        TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'active', 'finished')),
  -- JSON array of winning pattern names e.g. ["row","column","diagonal","four_corners","full_house"]
  winning_patterns JSONB NOT NULL DEFAULT '["row","column","diagonal","four_corners","full_house"]'::jsonb,
  -- Drawn numbers so far (ordered array), populated during active game
  drawn_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Timestamp when the game started
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  winner_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: game_sessions
-- Links a user to a bingo room and stores their card + daubed state
-- ============================================================
CREATE TABLE IF NOT EXISTS game_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES bingo_rooms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 5x5 bingo card stored as a flat 25-element JSON array
  -- Index 12 (center) is always 0 = FREE space
  card          JSONB NOT NULL,
  -- Set of daubed number positions (indices 0-24)
  daubed        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Power-up inventory for this session
  powerups_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, user_id)
);

-- ============================================================
-- TABLE: wallet_transactions
-- Immutable ledger for all financial operations
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount           NUMERIC(10, 2) NOT NULL,  -- positive = credit, negative = debit
  transaction_type TEXT NOT NULL
                     CHECK (transaction_type IN (
                       'bingo_entry',      -- debit: joining a bingo room
                       'bingo_win',        -- credit: winning a bingo game
                       'bet_stake',        -- debit: placing a sports bet
                       'bet_win',          -- credit: winning a sports bet
                       'deposit',          -- credit: adding funds
                       'withdrawal'        -- debit: withdrawing funds
                     )),
  reference_id     UUID,                     -- room_id or bet_id this relates to
  -- Idempotency key prevents duplicate transactions (e.g. network retry)
  idempotency_key  TEXT UNIQUE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: powerup_inventory
-- Tracks how many of each power-up a user owns
-- ============================================================
CREATE TABLE IF NOT EXISTS powerup_inventory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  powerup_type TEXT NOT NULL
                 CHECK (powerup_type IN ('instant_daub', 'coin_multiplier', 'extra_card')),
  quantity    INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, powerup_type)
);

-- ============================================================
-- RPC: join_bingo_room
-- Atomically deducts entry fee and creates a game session
-- Prevents race conditions with FOR UPDATE lock
-- ============================================================
CREATE OR REPLACE FUNCTION join_bingo_room(
  p_user_id   UUID,
  p_room_id   UUID,
  p_card      JSONB,
  p_idem_key  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room        bingo_rooms%ROWTYPE;
  v_user_balance NUMERIC;
  v_new_balance  NUMERIC;
  v_session_id   UUID;
BEGIN
  -- Lock the room row to prevent concurrent joins
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Room not found');
  END IF;

  IF v_room.status != 'waiting' THEN
    RETURN jsonb_build_object('error', 'Room is not accepting players');
  END IF;

  -- Check if user already joined
  IF EXISTS (SELECT 1 FROM game_sessions WHERE room_id = p_room_id AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('error', 'Already joined this room');
  END IF;

  -- Check player count
  IF (SELECT COUNT(*) FROM game_sessions WHERE room_id = p_room_id) >= v_room.max_players THEN
    RETURN jsonb_build_object('error', 'Room is full');
  END IF;

  -- Get user balance (lock row)
  SELECT balance INTO v_user_balance FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_user_balance < v_room.entry_fee THEN
    RETURN jsonb_build_object('error', 'Insufficient funds');
  END IF;

  -- Deduct entry fee
  v_new_balance := v_user_balance - v_room.entry_fee;
  UPDATE users SET balance = v_new_balance WHERE id = p_user_id;

  -- Record transaction (idempotency_key prevents double-charge on retry)
  INSERT INTO wallet_transactions (user_id, amount, transaction_type, reference_id, idempotency_key)
  VALUES (p_user_id, -v_room.entry_fee, 'bingo_entry', p_room_id, p_idem_key)
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Create game session with the generated card
  INSERT INTO game_sessions (room_id, user_id, card)
  VALUES (p_room_id, p_user_id, p_card)
  RETURNING id INTO v_session_id;

  -- If room is now full, mark it active
  IF (SELECT COUNT(*) FROM game_sessions WHERE room_id = p_room_id) >= v_room.max_players THEN
    UPDATE bingo_rooms SET status = 'active', started_at = NOW() WHERE id = p_room_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'new_balance', v_new_balance
  );
END;
$$;

-- ============================================================
-- RPC: validate_bingo_win
-- Server-side win validation — never trust the client
-- Checks all winning patterns against the daubed positions
-- ============================================================
CREATE OR REPLACE FUNCTION validate_bingo_win(
  p_session_id UUID,
  p_room_id    UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session     game_sessions%ROWTYPE;
  v_room        bingo_rooms%ROWTYPE;
  v_daubed      INT[];
  v_drawn       INT[];
  v_card        INT[];
  v_patterns    TEXT[];
  v_is_win      BOOLEAN := FALSE;
  v_pattern     TEXT;
  -- Winning line indices (0-based, 5x5 grid)
  v_rows        INT[][] := ARRAY[
    ARRAY[0,1,2,3,4], ARRAY[5,6,7,8,9], ARRAY[10,11,12,13,14],
    ARRAY[15,16,17,18,19], ARRAY[20,21,22,23,24]
  ];
  v_cols        INT[][] := ARRAY[
    ARRAY[0,5,10,15,20], ARRAY[1,6,11,16,21], ARRAY[2,7,12,17,22],
    ARRAY[3,8,13,18,23], ARRAY[4,9,14,19,24]
  ];
  v_diags       INT[][] := ARRAY[
    ARRAY[0,6,12,18,24], ARRAY[4,8,12,16,20]
  ];
  v_corners     INT[] := ARRAY[0,4,20,24];
  v_line        INT[];
  v_all_daubed  BOOLEAN;
  i             INT;
BEGIN
  SELECT * INTO v_session FROM game_sessions WHERE id = p_session_id AND room_id = p_room_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Session not found');
  END IF;

  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id;
  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Game not active');
  END IF;

  -- Convert JSONB arrays to INT arrays
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_session.daubed)::INT) INTO v_daubed;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.drawn_numbers)::INT) INTO v_drawn;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_session.card)::INT) INTO v_card;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.winning_patterns)) INTO v_patterns;

  -- Index 12 (FREE space) is always daubed
  IF NOT (12 = ANY(v_daubed)) THEN
    v_daubed := v_daubed || ARRAY[12];
  END IF;

  -- Validate: each daubed position must correspond to a drawn number
  FOR i IN 1..array_length(v_daubed, 1) LOOP
    IF v_card[v_daubed[i] + 1] != 0 AND NOT (v_card[v_daubed[i] + 1] = ANY(v_drawn)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Invalid daub — number not drawn');
    END IF;
  END LOOP;

  -- Check each winning pattern
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

-- ============================================================
-- RPC: claim_bingo_win
-- Validates win, pays out, and closes the room atomically
-- ============================================================
CREATE OR REPLACE FUNCTION claim_bingo_win(
  p_session_id UUID,
  p_room_id    UUID,
  p_user_id    UUID,
  p_idem_key   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_validation  JSONB;
  v_room        bingo_rooms%ROWTYPE;
  v_player_count INT;
  v_pot         NUMERIC;
  v_new_balance NUMERIC;
BEGIN
  -- Lock room
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;

  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('error', 'Game is not active');
  END IF;

  -- Validate the win server-side
  v_validation := validate_bingo_win(p_session_id, p_room_id);
  IF NOT (v_validation->>'valid')::BOOLEAN THEN
    RETURN jsonb_build_object('error', 'Invalid bingo claim: ' || (v_validation->>'error'));
  END IF;

  -- Calculate pot (entry_fee × number of players)
  SELECT COUNT(*) INTO v_player_count FROM game_sessions WHERE room_id = p_room_id;
  v_pot := v_room.entry_fee * v_player_count;

  -- Credit winner
  UPDATE users SET balance = balance + v_pot WHERE id = p_user_id
  RETURNING balance INTO v_new_balance;

  -- Record payout transaction
  INSERT INTO wallet_transactions (user_id, amount, transaction_type, reference_id, idempotency_key)
  VALUES (p_user_id, v_pot, 'bingo_win', p_room_id, p_idem_key)
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Close the room
  UPDATE bingo_rooms
  SET status = 'finished', finished_at = NOW(), winner_id = p_user_id
  WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success', true,
    'payout', v_pot,
    'new_balance', v_new_balance
  );
END;
$$;

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_status ON bingo_rooms(status);
CREATE INDEX IF NOT EXISTS idx_game_sessions_room ON game_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_idem ON wallet_transactions(idempotency_key);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE bingo_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE powerup_inventory ENABLE ROW LEVEL SECURITY;

-- Anyone can read open rooms
CREATE POLICY "rooms_read" ON bingo_rooms FOR SELECT USING (true);
-- Users can only read their own sessions
CREATE POLICY "sessions_own" ON game_sessions FOR SELECT USING (auth.uid() = user_id);
-- Users can only read their own transactions
CREATE POLICY "tx_own" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);
-- Users can only read their own inventory
CREATE POLICY "inv_own" ON powerup_inventory FOR SELECT USING (auth.uid() = user_id);
