-- ================================================================
-- Migration 006 — Fix Bingo Wallet RPCs after refactor_dual_architecture.sql
--
-- What changed in the refactor:
--   bingo_users      → tg_users          (PK: id UUID → tg_id BIGINT)
--   bingo_sessions   → bingo_cards       (user_id UUID → tg_id BIGINT, card → grid)
--   bingo_wallet_tx  → bingo_transactions (user_id UUID → tg_id BIGINT)
--
-- RPCs fixed in this file:
--   1. bingo_wallet_credit      — INSERT into bingo_transactions, use tg_id
--   2. bingo_wallet_debit       — INSERT into bingo_transactions, use tg_id
--   3. bingo_join_room          — INSERT into bingo_cards, use tg_id + grid
--   4. bingo_validate_win       — SELECT from bingo_cards, use tg_id
--   5. bingo_claim_win          — UPDATE tg_users, INSERT bingo_transactions,
--                                  UPDATE bingo_cards, use tg_id
--   6. bingo_get_wallet_summary — SELECT from tg_users by tg_id,
--                                  SELECT from bingo_transactions by tg_id,
--                                  SELECT from bingo_cards by tg_id
--   7. bingo_get_user_by_tg_id  — NEW helper used by wallet route after win
--
-- Run this in the Supabase SQL Editor AFTER refactor_dual_architecture.sql.
-- Safe to re-run (CREATE OR REPLACE).
-- ================================================================


-- ================================================================
-- 1. bingo_wallet_credit
--    p_user_id UUID → p_tg_id BIGINT
--    INSERT target: bingo_wallet_tx → bingo_transactions
--    UPDATE target: bingo_users → tg_users, WHERE id → WHERE tg_id
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_wallet_credit(
  p_tg_id    BIGINT,
  p_amount   NUMERIC,
  p_type     TEXT,
  p_idem_key TEXT    DEFAULT NULL,
  p_note     TEXT    DEFAULT NULL,
  p_is_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user      tg_users%ROWTYPE;
  v_new_bal   NUMERIC;
  v_tx_id     UUID;
  v_idem      TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be positive');
  END IF;

  SELECT * INTO v_user FROM tg_users WHERE tg_id = p_tg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  v_idem := COALESCE(p_idem_key, 'credit-' || p_tg_id::TEXT || '-' || gen_random_uuid()::TEXT);

  IF p_is_bonus THEN
    UPDATE tg_users
       SET bingo_balance = bingo_balance + p_amount
     WHERE tg_id = p_tg_id
     RETURNING bingo_balance INTO v_new_bal;
  ELSE
    UPDATE tg_users
       SET bingo_balance = bingo_balance + p_amount
     WHERE tg_id = p_tg_id
     RETURNING bingo_balance INTO v_new_bal;
  END IF;

  INSERT INTO bingo_transactions
    (tg_id, amount, tx_type, idempotency_key, balance_after, is_bonus, note, status)
  VALUES
    (p_tg_id, p_amount, p_type, v_idem, v_new_bal, p_is_bonus,
     COALESCE(p_note, p_type), 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',      TRUE,
    'new_balance',  v_new_bal,
    'tx_id',        v_tx_id
  );
END;
$$;


-- ================================================================
-- 2. bingo_wallet_debit
--    p_user_id UUID → p_tg_id BIGINT
--    INSERT target: bingo_wallet_tx → bingo_transactions
--    UPDATE target: bingo_users → tg_users, WHERE id → WHERE tg_id
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_wallet_debit(
  p_tg_id    BIGINT,
  p_amount   NUMERIC,
  p_type     TEXT,
  p_idem_key TEXT    DEFAULT NULL,
  p_note     TEXT    DEFAULT NULL,
  p_is_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user      tg_users%ROWTYPE;
  v_new_bal   NUMERIC;
  v_tx_id     UUID;
  v_idem      TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be positive');
  END IF;

  SELECT * INTO v_user FROM tg_users WHERE tg_id = p_tg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  IF v_user.bingo_balance < p_amount THEN
    RETURN jsonb_build_object('error', 'Insufficient balance');
  END IF;

  v_idem := COALESCE(p_idem_key, 'debit-' || p_tg_id::TEXT || '-' || gen_random_uuid()::TEXT);

  UPDATE tg_users
     SET bingo_balance = bingo_balance - p_amount
   WHERE tg_id = p_tg_id
   RETURNING bingo_balance INTO v_new_bal;

  INSERT INTO bingo_transactions
    (tg_id, amount, tx_type, idempotency_key, balance_after, is_bonus, note, status)
  VALUES
    (p_tg_id, -p_amount, p_type, v_idem, v_new_bal, p_is_bonus,
     COALESCE(p_note, p_type), 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success',      TRUE,
    'new_balance',  v_new_bal,
    'tx_id',        v_tx_id
  );
END;
$$;


-- ================================================================
-- 3. bingo_join_room
--    p_user_id UUID → p_tg_id BIGINT
--    INSERT target: bingo_sessions → bingo_cards
--    card column → grid column
--    Debit uses updated bingo_wallet_debit (p_tg_id)
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_join_room(
  p_tg_id    BIGINT,
  p_room_id  UUID,
  p_card     JSONB,
  p_idem_key TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_room       bingo_rooms%ROWTYPE;
  v_count      INT;
  v_session_id UUID;
  v_debit_res  JSONB;
BEGIN
  -- Idempotency check
  SELECT id INTO v_session_id
    FROM bingo_cards
   WHERE tg_id = p_tg_id AND room_id = p_room_id;
  IF FOUND THEN
    RETURN jsonb_build_object('success', TRUE, 'session_id', v_session_id, 'idempotent', TRUE);
  END IF;

  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Room not found');
  END IF;
  IF v_room.status != 'waiting' THEN
    RETURN jsonb_build_object('error', 'Room is not accepting players');
  END IF;

  SELECT COUNT(*) INTO v_count FROM bingo_cards WHERE room_id = p_room_id;
  IF v_count >= v_room.max_players THEN
    RETURN jsonb_build_object('error', 'Room is full');
  END IF;

  -- Debit entry fee
  v_debit_res := bingo_wallet_debit(
    p_tg_id    => p_tg_id,
    p_amount   => v_room.entry_fee,
    p_type     => 'bingo_entry',
    p_idem_key => p_idem_key,
    p_note     => 'Entry fee for room ' || p_room_id::TEXT
  );
  IF v_debit_res->>'error' IS NOT NULL THEN
    RETURN v_debit_res;
  END IF;

  -- Insert into bingo_cards (was bingo_sessions), grid column (was card)
  INSERT INTO bingo_cards (tg_id, room_id, grid, daubed, win_claimed, joined_at)
  VALUES (p_tg_id, p_room_id, p_card, '[]'::jsonb, FALSE, NOW())
  RETURNING id INTO v_session_id;

  -- Start game if room is now full
  v_count := v_count + 1;
  IF v_count >= v_room.max_players THEN
    UPDATE bingo_rooms
       SET status     = 'active',
           started_at = NOW(),
           prize_pot  = ROUND(v_room.entry_fee * v_count * (1 - v_room.house_cut), 2)
     WHERE id = p_room_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'session_id', v_session_id);
END;
$$;


-- ================================================================
-- 4. bingo_validate_win
--    p_user_id UUID → p_tg_id BIGINT
--    SELECT from bingo_sessions → bingo_cards
--    card column → grid column
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_validate_win(
  p_session_id UUID,
  p_room_id    UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sess     bingo_cards%ROWTYPE;
  v_room     bingo_rooms%ROWTYPE;
  v_daubed   INT[];
  v_drawn    INT[];
  v_card     INT[];
  v_patterns TEXT[];
  v_pattern  TEXT;
  v_rows     INT[][] := ARRAY[
    ARRAY[0,1,2,3,4], ARRAY[5,6,7,8,9], ARRAY[10,11,12,13,14],
    ARRAY[15,16,17,18,19], ARRAY[20,21,22,23,24]
  ];
  v_cols     INT[][] := ARRAY[
    ARRAY[0,5,10,15,20], ARRAY[1,6,11,16,21], ARRAY[2,7,12,17,22],
    ARRAY[3,8,13,18,23], ARRAY[4,9,14,19,24]
  ];
  v_diags    INT[][] := ARRAY[
    ARRAY[0,6,12,18,24], ARRAY[4,8,12,16,20]
  ];
  v_corners  INT[]  := ARRAY[0,4,20,24];
  v_line     INT[];
  v_is_win   BOOLEAN := FALSE;
  v_ok       BOOLEAN;
  i          INT;
BEGIN
  SELECT * INTO v_sess FROM bingo_cards WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'Session not found');
  END IF;

  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id;
  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('valid', FALSE, 'error', 'Game not active');
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_sess.daubed)::INT)        INTO v_daubed;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.drawn_numbers)::INT) INTO v_drawn;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_sess.grid)::INT)          INTO v_card;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_room.winning_patterns))   INTO v_patterns;

  IF NOT (12 = ANY(v_daubed)) THEN v_daubed := v_daubed || ARRAY[12]; END IF;

  FOR i IN 1..array_length(v_daubed, 1) LOOP
    IF v_card[v_daubed[i]+1] != 0 AND NOT (v_card[v_daubed[i]+1] = ANY(v_drawn)) THEN
      RETURN jsonb_build_object('valid', FALSE, 'error', 'Invalid daub — number not drawn');
    END IF;
  END LOOP;

  FOREACH v_pattern IN ARRAY v_patterns LOOP
    IF v_pattern = 'row' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_rows LOOP
        v_ok := TRUE;
        FOREACH i IN ARRAY v_line LOOP IF NOT (i = ANY(v_daubed)) THEN v_ok := FALSE; EXIT; END IF; END LOOP;
        IF v_ok THEN v_is_win := TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'column' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_cols LOOP
        v_ok := TRUE;
        FOREACH i IN ARRAY v_line LOOP IF NOT (i = ANY(v_daubed)) THEN v_ok := FALSE; EXIT; END IF; END LOOP;
        IF v_ok THEN v_is_win := TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'diagonal' THEN
      FOREACH v_line SLICE 1 IN ARRAY v_diags LOOP
        v_ok := TRUE;
        FOREACH i IN ARRAY v_line LOOP IF NOT (i = ANY(v_daubed)) THEN v_ok := FALSE; EXIT; END IF; END LOOP;
        IF v_ok THEN v_is_win := TRUE; EXIT; END IF;
      END LOOP;
    ELSIF v_pattern = 'four_corners' THEN
      v_ok := TRUE;
      FOREACH i IN ARRAY v_corners LOOP IF NOT (i = ANY(v_daubed)) THEN v_ok := FALSE; EXIT; END IF; END LOOP;
      IF v_ok THEN v_is_win := TRUE; END IF;
    ELSIF v_pattern = 'full_house' THEN
      v_ok := TRUE;
      FOR i IN 0..24 LOOP IF NOT (i = ANY(v_daubed)) THEN v_ok := FALSE; EXIT; END IF; END LOOP;
      IF v_ok THEN v_is_win := TRUE; END IF;
    END IF;
    EXIT WHEN v_is_win;
  END LOOP;

  RETURN jsonb_build_object('valid', v_is_win);
END;
$$;


-- ================================================================
-- 5. bingo_claim_win
--    p_user_id UUID → p_tg_id BIGINT
--    UPDATE target: bingo_users → tg_users, WHERE id → WHERE tg_id
--    INSERT target: bingo_wallet_tx → bingo_transactions, user_id → tg_id
--    UPDATE target: bingo_sessions → bingo_cards
--    winner_id: still UUID in bingo_rooms — store tg_id cast to TEXT
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_claim_win(
  p_session_id UUID,
  p_room_id    UUID,
  p_tg_id      BIGINT,
  p_idem_key   TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_val      JSONB;
  v_room     bingo_rooms%ROWTYPE;
  v_count    INT;
  v_pot      NUMERIC;
  v_new_bal  NUMERIC;
BEGIN
  SELECT * INTO v_room FROM bingo_rooms WHERE id = p_room_id FOR UPDATE;
  IF v_room.status != 'active' THEN
    RETURN jsonb_build_object('error', 'Game is not active');
  END IF;

  v_val := bingo_validate_win(p_session_id, p_room_id);
  IF NOT (v_val->>'valid')::BOOLEAN THEN
    RETURN jsonb_build_object('error', 'Invalid bingo claim: ' || COALESCE(v_val->>'error', 'unknown'));
  END IF;

  SELECT COUNT(*) INTO v_count FROM bingo_cards WHERE room_id = p_room_id;
  v_pot := ROUND(v_room.entry_fee * v_count * (1 - v_room.house_cut), 2);

  -- Credit winner's wallet
  UPDATE tg_users
     SET bingo_balance = bingo_balance + v_pot
   WHERE tg_id = p_tg_id
   RETURNING bingo_balance INTO v_new_bal;

  -- Record transaction in bingo_transactions (was bingo_wallet_tx)
  INSERT INTO bingo_transactions
    (tg_id, amount, tx_type, reference_id, idempotency_key, balance_after, note, status)
  VALUES
    (p_tg_id, v_pot, 'bingo_win', p_room_id, p_idem_key, v_new_bal, 'Bingo win payout', 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Mark session as won in bingo_cards (was bingo_sessions)
  UPDATE bingo_cards
     SET win_claimed     = TRUE,
         win_claimed_at  = NOW(),
         payout_amount   = v_pot,
         final_rank      = 1,
         calls_to_win    = (
           SELECT array_length(
             ARRAY(SELECT jsonb_array_elements_text(drawn_numbers)::INT), 1
           )
           FROM bingo_rooms WHERE id = p_room_id
         )
   WHERE id = p_session_id;

  -- Close the room
  UPDATE bingo_rooms
     SET status        = 'finished',
         finished_at   = NOW(),
         winner_id     = p_tg_id::TEXT::UUID,  -- cast for legacy UUID column; see MISSING 5 in CHECKPOINT
         prize_pot     = v_pot,
         derash_amount = v_room.entry_fee * v_count * v_room.house_cut
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success',      TRUE,
    'payout',       v_pot,
    'new_balance',  v_new_bal
  );
END;
$$;


-- ================================================================
-- 6. bingo_get_wallet_summary
--    p_user_id UUID → p_tg_id BIGINT
--    SELECT from bingo_users → tg_users, WHERE id → WHERE tg_id
--    SELECT from bingo_wallet_tx → bingo_transactions, user_id → tg_id
--    SELECT from bingo_sessions → bingo_cards, user_id → tg_id, card → grid
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_get_wallet_summary(p_tg_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user      tg_users%ROWTYPE;
  v_tx_rows   JSONB;
  v_game_rows JSONB;
BEGIN
  SELECT * INTO v_user FROM tg_users WHERE tg_id = p_tg_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Last 20 wallet transactions from bingo_transactions (was bingo_wallet_tx)
  SELECT jsonb_agg(t ORDER BY t.created_at DESC) INTO v_tx_rows FROM (
    SELECT id, amount, tx_type AS type, note, balance_after, is_bonus, status, created_at
      FROM bingo_transactions
     WHERE tg_id = p_tg_id
     ORDER BY created_at DESC
     LIMIT 20
  ) t;

  -- Last 20 game sessions from bingo_cards (was bingo_sessions)
  SELECT jsonb_agg(g ORDER BY g."createdAt" DESC) INTO v_game_rows FROM (
    SELECT s.id,
           r.game_code                                         AS "gameId",
           r.entry_fee                                         AS stake,
           CASE WHEN s.win_claimed THEN 'win' ELSE 'loss' END AS result,
           COALESCE(s.payout_amount, 0)                        AS payout,
           s.joined_at                                         AS "createdAt"
      FROM bingo_cards s
      JOIN bingo_rooms r ON r.id = s.room_id
     WHERE s.tg_id = p_tg_id
     ORDER BY s.joined_at DESC
     LIMIT 20
  ) g;

  RETURN jsonb_build_object(
    'tg_id',        v_user.tg_id,
    'phone',        v_user.phone,
    'name',         v_user.display_name,
    'wallet',       v_user.bingo_balance,
    'transactions', COALESCE(v_tx_rows,   '[]'::jsonb),
    'gameHistory',  COALESCE(v_game_rows, '[]'::jsonb)
  );
END;
$$;


-- ================================================================
-- 7. bingo_get_user_by_tg_id  (NEW — used by wallet route after win)
--    Returns the same shape as bingo_get_wallet_summary.
--    Alias kept separate so the old UUID-based GET endpoint can
--    still call bingo_get_wallet_summary(p_tg_id) without breaking.
-- ================================================================
CREATE OR REPLACE FUNCTION bingo_get_user_by_tg_id(p_tg_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN bingo_get_wallet_summary(p_tg_id);
END;
$$;


-- ================================================================
-- GRANT execute to service_role (Supabase default — safe to re-run)
-- ================================================================
GRANT EXECUTE ON FUNCTION bingo_wallet_credit(BIGINT, NUMERIC, TEXT, TEXT, TEXT, BOOLEAN)    TO service_role;
GRANT EXECUTE ON FUNCTION bingo_wallet_debit(BIGINT, NUMERIC, TEXT, TEXT, TEXT, BOOLEAN)     TO service_role;
GRANT EXECUTE ON FUNCTION bingo_join_room(BIGINT, UUID, JSONB, TEXT)                         TO service_role;
GRANT EXECUTE ON FUNCTION bingo_validate_win(UUID, UUID)                                     TO service_role;
GRANT EXECUTE ON FUNCTION bingo_claim_win(UUID, UUID, BIGINT, TEXT)                          TO service_role;
GRANT EXECUTE ON FUNCTION bingo_get_wallet_summary(BIGINT)                                   TO service_role;
GRANT EXECUTE ON FUNCTION bingo_get_user_by_tg_id(BIGINT)                                   TO service_role;
