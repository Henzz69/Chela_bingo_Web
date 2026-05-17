-- ================================================================
-- BINGO TELEGRAM MIGRATION
-- Run this in Supabase SQL Editor AFTER schema_bingo.sql
--
-- Adds:
--   1. tg_id column to bingo_users (BIGINT, unique, nullable)
--   2. tg_username column to bingo_users
--   3. auth_type column ('phone' | 'telegram')
--   4. INSERT policy so service-role can create users
--   5. bingo_upsert_telegram_user() RPC for bot integration
--   6. Updated bingo_get_wallet_summary() to include tg_id
-- ================================================================

-- ── 1. Add Telegram columns to bingo_users ────────────────────
ALTER TABLE bingo_users
  ADD COLUMN IF NOT EXISTS tg_id       BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS tg_username TEXT,
  ADD COLUMN IF NOT EXISTS auth_type   TEXT NOT NULL DEFAULT 'phone'
    CHECK (auth_type IN ('phone', 'telegram'));

-- Make phone nullable for Telegram-only users
ALTER TABLE bingo_users
  ALTER COLUMN phone DROP NOT NULL;

-- Make password_hash nullable for Telegram-only users
ALTER TABLE bingo_users
  ALTER COLUMN password_hash DROP NOT NULL;

-- Add unique index on tg_id (non-null only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bingo_users_tg_id
  ON bingo_users (tg_id) WHERE tg_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bingo_users_auth_type
  ON bingo_users (auth_type);

-- ── 2. Fix RLS — add INSERT policy for service-role ───────────
-- Service-role bypasses RLS, but add explicit policy for clarity
DROP POLICY IF EXISTS "bu_insert_service" ON bingo_users;
-- No client-side insert allowed — only via service-role API routes
-- (service_role bypasses RLS automatically)

-- ── 3. Telegram upsert RPC ────────────────────────────────────
-- Called by the Telegram bot webhook to register/login users.
-- Uses tg_id as the unique identifier.
-- Returns the full user object (same shape as bingo_get_wallet_summary).
CREATE OR REPLACE FUNCTION bingo_upsert_telegram_user(
  p_tg_id       BIGINT,
  p_tg_username TEXT    DEFAULT NULL,
  p_first_name  TEXT    DEFAULT NULL,
  p_last_name   TEXT    DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user    bingo_users%ROWTYPE;
  v_name    TEXT;
  v_user_id UUID;
BEGIN
  -- Build display name from Telegram data
  v_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  IF v_name = '' OR v_name IS NULL THEN
    v_name := COALESCE(p_tg_username, 'Player_' || p_tg_id::TEXT);
  END IF;
  v_name := LEFT(v_name, 50); -- enforce max length

  -- Upsert: insert if new, update username/name if returning
  INSERT INTO bingo_users (tg_id, tg_username, display_name, auth_type, avatar_url)
  VALUES (p_tg_id, p_tg_username, v_name, 'telegram', p_photo_url)
  ON CONFLICT (tg_id) DO UPDATE
    SET tg_username  = COALESCE(EXCLUDED.tg_username, bingo_users.tg_username),
        display_name = CASE
          WHEN bingo_users.display_name LIKE 'Player_%' THEN EXCLUDED.display_name
          ELSE bingo_users.display_name  -- keep custom name if user changed it
        END,
        avatar_url   = COALESCE(EXCLUDED.avatar_url, bingo_users.avatar_url)
  RETURNING id INTO v_user_id;

  -- Return full wallet summary
  RETURN bingo_get_wallet_summary(v_user_id);
END;
$$;

-- ── 4. Update bingo_get_wallet_summary to include tg_id ───────
CREATE OR REPLACE FUNCTION bingo_get_wallet_summary(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user      bingo_users%ROWTYPE;
  v_tx_rows   JSONB;
  v_game_rows JSONB;
BEGIN
  SELECT * INTO v_user FROM bingo_users WHERE id = p_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'User not found'); END IF;

  SELECT jsonb_agg(t ORDER BY t.created_at DESC) INTO v_tx_rows FROM (
    SELECT id, amount, tx_type AS type, note, balance_after, is_bonus, status, created_at
      FROM bingo_wallet_tx
     WHERE user_id = p_user_id
     ORDER BY created_at DESC
     LIMIT 20
  ) t;

  SELECT jsonb_agg(g ORDER BY g."createdAt" DESC) INTO v_game_rows FROM (
    SELECT s.id,
           r.game_code                                          AS "gameId",
           r.entry_fee                                          AS stake,
           CASE WHEN s.win_claimed THEN 'win' ELSE 'loss' END  AS result,
           COALESCE(s.payout_amount, 0)                         AS payout,
           s.joined_at                                          AS "createdAt"
      FROM bingo_sessions s
      JOIN bingo_rooms    r ON r.id = s.room_id
     WHERE s.user_id = p_user_id
     ORDER BY s.joined_at DESC
     LIMIT 20
  ) g;

  RETURN jsonb_build_object(
    'id',           v_user.id,
    'phone',        v_user.phone,
    'tg_id',        v_user.tg_id,
    'tg_username',  v_user.tg_username,
    'auth_type',    v_user.auth_type,
    'name',         v_user.display_name,
    'display_name', v_user.display_name,
    'wallet',       v_user.balance,
    'bonus',        v_user.bonus_balance,
    'transactions', COALESCE(v_tx_rows,   '[]'::jsonb),
    'gameHistory',  COALESCE(v_game_rows, '[]'::jsonb)
  );
END;
$$;

-- ── 5. Helper: lookup user by tg_id ──────────────────────────
CREATE OR REPLACE FUNCTION bingo_get_user_by_tg_id(p_tg_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM bingo_users WHERE tg_id = p_tg_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'User not found'); END IF;
  RETURN bingo_get_wallet_summary(v_user_id);
END;
$$;
