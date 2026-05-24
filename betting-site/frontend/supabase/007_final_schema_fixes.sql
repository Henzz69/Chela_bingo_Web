-- ================================================================
-- Migration 007 — Final Schema Fixes (v2 — fully idempotent)
--
-- Fixes three fatal structural blockers:
--
--   A. bets table — ensure fixture_id BIGINT exists with FK to
--                   fixtures(id); drop match_id if it still exists;
--                   ensure user_id UUID FK to profiles; add missing
--                   columns odds/total_odds/slip_id/match_name
--
--   B. place_bet_batch RPC — rewritten to insert all required columns
--                            (fixture_id, match_name, odds, total_odds,
--                             slip_id, stake) with match_name auto-
--                            looked up from fixtures table
--
--   C. bingo_rooms.winner_id — change from UUID to BIGINT,
--                              re-add FK to tg_users(tg_id);
--                              patch bingo_claim_win to use winner_tg_id
--
-- Run AFTER:
--   001 schema_bingo.sql
--   002 schema_betting.sql
--   003 bingo_telegram_migration.sql
--   004 refactor_dual_architecture.sql
--   005 005_fixtures_table.sql
--   006 006_fix_wallet_rpcs.sql
--
-- FULLY IDEMPOTENT — safe to run multiple times.
-- ================================================================


-- ================================================================
-- A. FIX bets TABLE
-- ================================================================

DO $$
DECLARE
  r RECORD;
BEGIN

  -- A1. Drop old index on match_id if it still exists
  DROP INDEX IF EXISTS idx_bets_match;

  -- A2. If match_id still exists, drop it (fixture_id is already present)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets' AND column_name = 'match_id'
  ) THEN
    ALTER TABLE bets DROP COLUMN match_id;
  END IF;

  -- A3. Ensure fixture_id column exists as BIGINT
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets' AND column_name = 'fixture_id'
  ) THEN
    ALTER TABLE bets ADD COLUMN fixture_id BIGINT;
  END IF;

  -- A4. Ensure fixture_id is BIGINT (cast if it somehow ended up as another type)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets'
      AND column_name = 'fixture_id'
      AND data_type != 'bigint'
  ) THEN
    ALTER TABLE bets ALTER COLUMN fixture_id TYPE BIGINT USING fixture_id::BIGINT;
  END IF;

  -- A5. Add FK bets.fixture_id → fixtures(id) if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bets'::regclass
      AND conname  = 'bets_fixture_id_fkey'
  ) THEN
    ALTER TABLE bets
      ADD CONSTRAINT bets_fixture_id_fkey
      FOREIGN KEY (fixture_id) REFERENCES fixtures(id) ON DELETE SET NULL;
  END IF;

  -- A6. Ensure user_id is UUID (post-refactor_dual_architecture)
  --     Only cast if it is still BIGINT
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets'
      AND column_name = 'user_id'
      AND data_type   = 'bigint'
  ) THEN
    -- Drop all FKs on user_id first (uses outer DECLARE r RECORD)
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'bets'::regclass
        AND contype  = 'f'
        AND conname  LIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE bets DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
    ALTER TABLE bets ALTER COLUMN user_id TYPE UUID USING NULL;
  END IF;

  -- A7. Add FK bets.user_id → profiles(id) if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bets'::regclass
      AND conname  = 'bets_user_id_fkey'
  ) THEN
    ALTER TABLE bets
      ADD CONSTRAINT bets_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  -- A8. Add missing columns that place_bet_batch inserts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets' AND column_name = 'odds'
  ) THEN
    ALTER TABLE bets ADD COLUMN odds NUMERIC(8,4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets' AND column_name = 'total_odds'
  ) THEN
    ALTER TABLE bets ADD COLUMN total_odds NUMERIC(10,4) NOT NULL DEFAULT 1.0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets' AND column_name = 'slip_id'
  ) THEN
    ALTER TABLE bets ADD COLUMN slip_id UUID NOT NULL DEFAULT gen_random_uuid();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bets' AND column_name = 'match_name'
  ) THEN
    ALTER TABLE bets ADD COLUMN match_name TEXT;
  END IF;

END;
$$;

-- A9. Rebuild index on fixture_id (IF NOT EXISTS is safe)
CREATE INDEX IF NOT EXISTS idx_bets_fixture ON bets (fixture_id);


-- ================================================================
-- B. FIX place_bet_batch RPC
--
-- Fully replaces the old version which:
--   • Inserted only (user_id, fixture_id, selection, stake, status)
--   • Was missing odds, total_odds, slip_id, match_name
--
-- This version:
--   • Computes total accumulator odds before touching the balance
--   • Looks up match_name from fixtures table automatically
--   • Inserts all required columns
--   • Returns slip_id and total_odds for the frontend
--   • TOCTOU-safe FOR UPDATE lock on profiles
-- ================================================================
CREATE OR REPLACE FUNCTION place_bet_batch(
  p_user_id     UUID,
  p_total_stake NUMERIC,
  p_bets        JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance    NUMERIC;
  v_new_bal    NUMERIC;
  v_bet        JSONB;
  v_slip_id    UUID    := gen_random_uuid();
  v_total_odds NUMERIC := 1.0;
  v_match_name TEXT;
BEGIN
  -- Basic validation
  IF p_total_stake <= 0 THEN
    RETURN jsonb_build_object('error', 'Stake must be greater than 0');
  END IF;
  IF jsonb_array_length(p_bets) = 0 THEN
    RETURN jsonb_build_object('error', 'No selections provided');
  END IF;

  -- Compute total accumulator odds
  FOR v_bet IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    v_total_odds := v_total_odds * COALESCE((v_bet->>'odds')::NUMERIC, 1.0);
  END LOOP;

  -- Lock the profile row to prevent concurrent balance reads (TOCTOU guard)
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
    -- Look up match_name from fixtures table
    BEGIN
      SELECT home_team || ' vs ' || away_team INTO v_match_name
        FROM fixtures
       WHERE id = (v_bet->>'fixture_id')::BIGINT;
    EXCEPTION WHEN OTHERS THEN
      v_match_name := NULL;
    END;

    INSERT INTO bets (
      user_id,
      fixture_id,
      match_name,
      selection,
      odds,
      total_odds,
      slip_id,
      stake,
      status
    ) VALUES (
      p_user_id,
      (v_bet->>'fixture_id')::BIGINT,
      COALESCE(v_match_name, v_bet->>'match_name', 'Unknown Match'),
      v_bet->>'selection',
      COALESCE((v_bet->>'odds')::NUMERIC, 1.0),
      v_total_odds,
      v_slip_id,
      p_total_stake,
      'pending'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success',     TRUE,
    'new_balance', v_new_bal,
    'slip_id',     v_slip_id,
    'total_odds',  v_total_odds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION place_bet_batch(UUID, NUMERIC, JSONB) TO service_role;


-- ================================================================
-- C. FIX bingo_rooms.winner_id
--
-- Currently: winner_id UUID (references old bingo_users.id — broken)
-- Fix: drop old UUID column, add winner_tg_id BIGINT FK to tg_users
-- Also patches bingo_claim_win to write winner_tg_id correctly.
-- ================================================================

DO $$
DECLARE r RECORD;
BEGIN
  -- C1. Drop all FK constraints on bingo_rooms that reference winner
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'bingo_rooms'::regclass
      AND contype  = 'f'
      AND conname  LIKE '%winner%'
  LOOP
    EXECUTE format('ALTER TABLE bingo_rooms DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  -- C2. Drop old UUID winner_id column if it still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bingo_rooms' AND column_name = 'winner_id'
  ) THEN
    ALTER TABLE bingo_rooms DROP COLUMN winner_id CASCADE;
  END IF;

  -- C3. Add winner_tg_id BIGINT column if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bingo_rooms' AND column_name = 'winner_tg_id'
  ) THEN
    ALTER TABLE bingo_rooms ADD COLUMN winner_tg_id BIGINT;
  END IF;

  -- C4. Add FK winner_tg_id → tg_users(tg_id) if it doesn't already exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bingo_rooms'::regclass
      AND conname  = 'bingo_rooms_winner_tg_id_fkey'
  ) THEN
    ALTER TABLE bingo_rooms
      ADD CONSTRAINT bingo_rooms_winner_tg_id_fkey
      FOREIGN KEY (winner_tg_id) REFERENCES tg_users(tg_id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- C5. Patch bingo_claim_win to write winner_tg_id (BIGINT, no cast needed)
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

  -- Record transaction
  INSERT INTO bingo_transactions
    (tg_id, amount, tx_type, reference_id, idempotency_key, balance_after, note, status)
  VALUES
    (p_tg_id, v_pot, 'bingo_win', p_room_id, p_idem_key, v_new_bal, 'Bingo win payout', 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Mark session as won
  UPDATE bingo_cards
     SET win_claimed    = TRUE,
         win_claimed_at = NOW(),
         payout_amount  = v_pot,
         final_rank     = 1,
         calls_to_win   = (
           SELECT array_length(
             ARRAY(SELECT jsonb_array_elements_text(drawn_numbers)::INT), 1
           )
           FROM bingo_rooms WHERE id = p_room_id
         )
   WHERE id = p_session_id;

  -- Close the room — winner_tg_id is BIGINT, no cast needed
  UPDATE bingo_rooms
     SET status        = 'finished',
         finished_at   = NOW(),
         winner_tg_id  = p_tg_id,
         prize_pot     = v_pot,
         derash_amount = v_room.entry_fee * v_count * v_room.house_cut
   WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'success',     TRUE,
    'payout',      v_pot,
    'new_balance', v_new_bal
  );
END;
$$;

GRANT EXECUTE ON FUNCTION bingo_claim_win(UUID, UUID, BIGINT, TEXT) TO service_role;
