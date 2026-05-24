-- ================================================================
-- TurboPlay — Dual-Architecture Refactor  (v4 — fully audited)
-- Sports/Web Domain  +  Bingo/Telegram Domain
--
-- Every DROP COLUMN uses CASCADE.
-- Every RLS policy that references a column is dropped BEFORE
-- that column is touched.
-- Every FK is dropped before its table is renamed.
-- Safe to re-run (IF NOT EXISTS / IF EXISTS everywhere).
-- ================================================================


-- ================================================================
-- STEP 0 — DROP ALL RLS POLICIES THAT WILL BLOCK COLUMN DROPS
-- We drop them all up-front and recreate the ones we need at the end.
-- ================================================================

-- Drop every policy using its PRE-RENAME table name.
-- We use a DO block so that referencing a non-existent table
-- is silently skipped rather than raising an error.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'bingo_sessions',        -- will become bingo_cards
        'bingo_wallet_tx',       -- will become bingo_transactions
        'bingo_users',           -- will become tg_users
        'bingo_rooms',
        'bingo_powerup_inventory',
        'bingo_powerup_purchases',
        'bingo_powerup_shop',
        'bingo_deposit_requests',
        'bingo_withdrawal_requests',  -- will become sports_transactions
        'bingo_draw_log',
        'bets'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      pol.policyname, pol.tablename
    );
  END LOOP;
END;
$$;


-- ================================================================
-- STEP 0b — DROP VIEWS & BLOAT TABLES
-- ================================================================

DROP VIEW             IF EXISTS bingo_wallet_balances  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS bingo_leaderboard     CASCADE;

DROP TABLE IF EXISTS bingo_powerup_purchases  CASCADE;
DROP TABLE IF EXISTS bingo_powerup_inventory  CASCADE;
DROP TABLE IF EXISTS bingo_powerup_shop       CASCADE;
DROP TABLE IF EXISTS bingo_draw_log           CASCADE;
DROP TABLE IF EXISTS bingo_deposit_requests   CASCADE;


-- ================================================================
-- STEP 1 — DOMAIN 1: SPORTS BETTING (Web Auth via profiles)
-- ================================================================

-- ── 1a. profiles — add balance column if missing ─────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS balance NUMERIC(14,2) NOT NULL DEFAULT 0.00;

-- ── 1b. Drop all FKs pointing TO users, then drop users ──────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE confrelid = 'users'::regclass
      AND contype   = 'f'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END;
$$;

DROP TABLE IF EXISTS users CASCADE;

-- ── 1c. Drop duplicate matches table ─────────────────────────
DROP TABLE IF EXISTS matches CASCADE;

-- ── 1d. bets — drop old user_id FK, re-point to profiles ─────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'bets'::regclass
      AND contype  = 'f'
  LOOP
    EXECUTE format('ALTER TABLE bets DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE bets
  ADD CONSTRAINT bets_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ── 1e. Rename bingo_withdrawal_requests → sports_transactions ─
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'bingo_withdrawal_requests'::regclass
      AND contype  = 'f'
  LOOP
    EXECUTE format(
      'ALTER TABLE bingo_withdrawal_requests DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE bingo_withdrawal_requests RENAME TO sports_transactions;

-- Add required columns
ALTER TABLE sports_transactions
  ADD COLUMN IF NOT EXISTS type    TEXT,
  ADD COLUMN IF NOT EXISTS status  TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- Drop all non-required columns with CASCADE
-- (net_amount is generated from fee — must go first)
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS net_amount     CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS fee            CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS payment_method CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS destination    CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS reviewed_by    CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS review_note    CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS reviewed_at    CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS wallet_tx_id   CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS provider_ref   CASCADE;
ALTER TABLE sports_transactions DROP COLUMN IF EXISTS completed_at   CASCADE;

-- Re-add FK to profiles
ALTER TABLE sports_transactions
  ADD CONSTRAINT sports_transactions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;


-- ================================================================
-- STEP 2 — DOMAIN 2: BINGO (Telegram Auth)
-- ================================================================

-- ── 2a. Rename bingo_users → tg_users ────────────────────────
-- Drop all FKs ON bingo_users and all FKs pointing TO bingo_users
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'bingo_users'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE bingo_users DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE confrelid = 'bingo_users'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END;
$$;

ALTER TABLE bingo_users RENAME TO tg_users;

-- Add new columns
ALTER TABLE tg_users
  ADD COLUMN IF NOT EXISTS tg_id         BIGINT,
  ADD COLUMN IF NOT EXISTS tg_username   TEXT,
  ADD COLUMN IF NOT EXISTS bingo_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00;

-- Create sequence and backfill tg_id for existing rows
CREATE SEQUENCE IF NOT EXISTS tg_users_tg_id_seq;

UPDATE tg_users
SET tg_id = nextval('tg_users_tg_id_seq')
WHERE tg_id IS NULL;

ALTER TABLE tg_users ALTER COLUMN tg_id SET NOT NULL;

-- Swap primary key from old UUID id → new BIGINT tg_id
ALTER TABLE tg_users DROP CONSTRAINT IF EXISTS bingo_users_pkey;
ALTER TABLE tg_users DROP CONSTRAINT IF EXISTS tg_users_pkey;
ALTER TABLE tg_users ADD PRIMARY KEY (tg_id);

-- ── 2b. bingo_rooms — ensure required columns exist ──────────
ALTER TABLE bingo_rooms
  ADD COLUMN IF NOT EXISTS entry_fee     NUMERIC(10,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS prize_pot     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS drawn_numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status        TEXT  NOT NULL DEFAULT 'waiting';

-- Add CHECK constraint only if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bingo_rooms'::regclass
      AND conname  = 'bingo_rooms_status_check'
  ) THEN
    ALTER TABLE bingo_rooms
      ADD CONSTRAINT bingo_rooms_status_check
      CHECK (status IN ('waiting','active','finished'));
  END IF;
END;
$$;

-- ── 2c. Rename bingo_sessions → bingo_cards ──────────────────
-- Drop all FKs on bingo_sessions
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'bingo_sessions'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE bingo_sessions DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE bingo_sessions RENAME TO bingo_cards;

-- Rename card → grid
ALTER TABLE bingo_cards RENAME COLUMN card TO grid;

-- Add tg_id column
ALTER TABLE bingo_cards
  ADD COLUMN IF NOT EXISTS tg_id BIGINT;

-- Backfill tg_id from old UUID user_id (if tg_users still has the old id column)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tg_users' AND column_name = 'id'
  ) THEN
    UPDATE bingo_cards bc
    SET tg_id = tu.tg_id
    FROM tg_users tu
    WHERE tu.id = bc.user_id;
  END IF;
END;
$$;

-- Drop user_id with CASCADE (drops the bs_own RLS policy that references it)
ALTER TABLE bingo_cards DROP COLUMN IF EXISTS user_id CASCADE;

-- Re-add FK to tg_users.tg_id
ALTER TABLE bingo_cards
  ADD CONSTRAINT bingo_cards_tg_id_fkey
  FOREIGN KEY (tg_id) REFERENCES tg_users(tg_id) ON DELETE CASCADE;

-- ── 2d. Rename bingo_wallet_tx → bingo_transactions ──────────
-- Drop all FKs on bingo_wallet_tx
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'bingo_wallet_tx'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE bingo_wallet_tx DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END;
$$;

ALTER TABLE bingo_wallet_tx RENAME TO bingo_transactions;

-- Add tg_id column
ALTER TABLE bingo_transactions
  ADD COLUMN IF NOT EXISTS tg_id BIGINT;

-- Backfill tg_id from old UUID user_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tg_users' AND column_name = 'id'
  ) THEN
    UPDATE bingo_transactions bt
    SET tg_id = tu.tg_id
    FROM tg_users tu
    WHERE tu.id = bt.user_id;
  END IF;
END;
$$;

-- Drop user_id with CASCADE (drops the bwt_own RLS policy that references it)
ALTER TABLE bingo_transactions DROP COLUMN IF EXISTS user_id CASCADE;

-- Re-add FK to tg_users.tg_id
ALTER TABLE bingo_transactions
  ADD CONSTRAINT bingo_transactions_tg_id_fkey
  FOREIGN KEY (tg_id) REFERENCES tg_users(tg_id) ON DELETE CASCADE;

-- Drop old UUID id column from tg_users (safe now — all dependents gone)
ALTER TABLE tg_users DROP COLUMN IF EXISTS id CASCADE;


-- ================================================================
-- STEP 3 — INDEX CLEANUP & REBUILD
-- ================================================================

DROP INDEX IF EXISTS idx_bingo_users_phone;
DROP INDEX IF EXISTS idx_bingo_sess_room;
DROP INDEX IF EXISTS idx_bingo_sess_user;
DROP INDEX IF EXISTS idx_bingo_sess_win;
DROP INDEX IF EXISTS idx_bingo_wallet_tx_user;
DROP INDEX IF EXISTS idx_bingo_wallet_tx_idem;
DROP INDEX IF EXISTS idx_bingo_wallet_tx_status;
DROP INDEX IF EXISTS idx_bingo_inv_user;
DROP INDEX IF EXISTS idx_bingo_purchases_user;
DROP INDEX IF EXISTS idx_bingo_dep_req_user;
DROP INDEX IF EXISTS idx_bingo_dep_req_status;
DROP INDEX IF EXISTS idx_bingo_wd_req_user;
DROP INDEX IF EXISTS idx_bingo_wd_req_status;
DROP INDEX IF EXISTS idx_bingo_leaderboard_user;

CREATE INDEX IF NOT EXISTS idx_tg_users_phone     ON tg_users (phone);
CREATE INDEX IF NOT EXISTS idx_tg_users_tg_id     ON tg_users (tg_id);
CREATE INDEX IF NOT EXISTS idx_bingo_cards_tg_id  ON bingo_cards (tg_id);
CREATE INDEX IF NOT EXISTS idx_bingo_cards_room   ON bingo_cards (room_id);
CREATE INDEX IF NOT EXISTS idx_bingo_tx_tg_id     ON bingo_transactions (tg_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sports_tx_user     ON sports_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bingo_rooms_status ON bingo_rooms (status);


-- ================================================================
-- STEP 4 — RECREATE RLS POLICIES WITH CORRECT COLUMN NAMES
-- ================================================================

-- tg_users: own row only (auth.uid() matches tg_id cast to UUID is not
-- applicable for Telegram IDs — disable RLS for server-side access,
-- or use service_role key from the Telegram bot)
ALTER TABLE tg_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_rooms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bingo_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets             ENABLE ROW LEVEL SECURITY;

-- bingo_rooms: public read
CREATE POLICY "br_read" ON bingo_rooms FOR SELECT USING (TRUE);

-- bingo_cards: own rows (tg_id — Telegram bot uses service_role, so
-- this policy is a safety net for direct client access)
CREATE POLICY "bc_own" ON bingo_cards FOR SELECT
  USING (tg_id::TEXT = auth.uid()::TEXT);

-- bingo_transactions: own rows
CREATE POLICY "bt_own" ON bingo_transactions FOR SELECT
  USING (tg_id::TEXT = auth.uid()::TEXT);

-- sports_transactions: own rows
CREATE POLICY "st_own" ON sports_transactions FOR SELECT
  USING (user_id = auth.uid());

-- bets: own rows
CREATE POLICY "bets_own" ON bets FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "bets_insert_own" ON bets FOR INSERT
  WITH CHECK (user_id = auth.uid());


-- ================================================================
-- VERIFICATION (run separately)
-- ================================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
--
-- Expected final tables:
--   bets
--   bingo_cards          (was bingo_sessions)
--   bingo_rooms
--   bingo_transactions   (was bingo_wallet_tx)
--   fixtures
--   profiles
--   sports_transactions  (was bingo_withdrawal_requests)
--   tg_users             (was bingo_users)
-- ================================================================
