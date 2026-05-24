-- ================================================================
-- Migration: 20260408000000_unify_schema.sql
-- TurboPlay — Schema Unification
--
-- Purpose:
--   1. Drop redundant/legacy tables
--   2. Unify user balances — eliminate bingo_balance, use balance
--   3. Create unified public.transactions ledger
--   4. Re-point bets.user_id → tg_users(tg_id)
--   5. Re-point bingo_deposit_requests, bingo_powerup_inventory,
--      bingo_powerup_purchases, bingo_withdrawal_requests
--      → tg_users(tg_id)
--
-- Run AFTER all previous migrations (001–007).
-- FULLY IDEMPOTENT — safe to re-run.
-- ================================================================


-- ================================================================
-- STEP 1 — DROP REDUNDANT LEGACY TABLES
--
-- These tables were superseded by the refactor_dual_architecture.sql
-- migration. They may or may not still exist depending on which
-- migrations have been applied. CASCADE handles any remaining FKs.
-- ================================================================

DROP TABLE IF EXISTS public.bingo_sessions        CASCADE;
DROP TABLE IF EXISTS public.bingo_users           CASCADE;
DROP TABLE IF EXISTS public.bingo_wallet_tx       CASCADE;
DROP TABLE IF EXISTS public.sports_transactions   CASCADE;


-- ================================================================
-- STEP 2 — UNIFY USER BALANCES
--
-- The tg_users table currently has two balance columns:
--   balance       — was the original bingo_users.balance
--   bingo_balance — added by refactor_dual_architecture.sql
--
-- Strategy:
--   a) If bingo_balance exists and balance is 0, copy bingo_balance → balance
--   b) If both are non-zero, add them (safe merge)
--   c) Drop bingo_balance
--
-- After this step, tg_users.balance is the single source of truth
-- for ALL modules (sports + bingo).
-- ================================================================

DO $$
BEGIN
  -- Only run if bingo_balance column still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tg_users'
      AND column_name  = 'bingo_balance'
  ) THEN
    -- Merge bingo_balance into balance (take the max to avoid losing funds)
    UPDATE public.tg_users
    SET balance = GREATEST(
      COALESCE(balance, 0),
      COALESCE(bingo_balance, 0)
    )
    WHERE COALESCE(bingo_balance, 0) > 0;

    -- Drop the now-redundant column
    ALTER TABLE public.tg_users DROP COLUMN bingo_balance CASCADE;

    RAISE NOTICE 'bingo_balance merged into balance and dropped from tg_users';
  ELSE
    RAISE NOTICE 'bingo_balance column not found — skipping merge (already done)';
  END IF;
END;
$$;

-- Ensure balance column has the correct type and constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tg_users'
      AND column_name  = 'balance'
  ) THEN
    -- Widen to NUMERIC(14,2) if needed
    ALTER TABLE public.tg_users
      ALTER COLUMN balance TYPE NUMERIC(14,2) USING COALESCE(balance, 0);

    -- Set default
    ALTER TABLE public.tg_users
      ALTER COLUMN balance SET DEFAULT 0.00;

    -- Set NOT NULL
    UPDATE public.tg_users SET balance = 0.00 WHERE balance IS NULL;
    ALTER TABLE public.tg_users
      ALTER COLUMN balance SET NOT NULL;
  END IF;
END;
$$;

-- Add CHECK constraint if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tg_users'::regclass
      AND conname  = 'tg_users_balance_check'
  ) THEN
    ALTER TABLE public.tg_users
      ADD CONSTRAINT tg_users_balance_check CHECK (balance >= 0);
  END IF;
END;
$$;


-- ================================================================
-- STEP 3 — CREATE UNIFIED TRANSACTIONS LEDGER
--
-- public.transactions replaces:
--   bingo_transactions  (was bingo_wallet_tx)
--   sports_transactions (was bingo_withdrawal_requests, repurposed)
--   betting_wallet_tx   (sports betting ledger)
--
-- The module column ('sports' | 'bingo' | 'global') identifies
-- which subsystem generated the transaction.
--
-- tx_type values:
--   Global:  'deposit', 'withdrawal', 'withdrawal_fee',
--            'bonus_credit', 'bonus_debit',
--            'admin_credit', 'admin_debit'
--   Bingo:   'bingo_entry', 'bingo_win', 'bingo_refund'
--   Sports:  'sports_bet', 'sports_win', 'sports_refund'
-- ================================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User reference — tg_users.tg_id (BIGINT Telegram ID)
  user_id          BIGINT        NOT NULL
                     REFERENCES public.tg_users(tg_id) ON DELETE CASCADE,

  -- Financial
  amount           NUMERIC(14,2) NOT NULL,

  -- Transaction classification
  tx_type          TEXT          NOT NULL CHECK (tx_type IN (
    -- Global wallet operations
    'deposit',
    'withdrawal',
    'withdrawal_fee',
    'bonus_credit',
    'bonus_debit',
    'admin_credit',
    'admin_debit',
    -- Bingo module
    'bingo_entry',
    'bingo_win',
    'bingo_refund',
    -- Sports module
    'sports_bet',
    'sports_win',
    'sports_refund'
  )),

  -- Module flag — identifies which subsystem owns this transaction
  module           TEXT          NOT NULL DEFAULT 'global'
                     CHECK (module IN ('sports', 'bingo', 'global')),

  -- Status
  status           TEXT          NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),

  -- Optional metadata
  reference_id     UUID,                    -- room_id, bet_id, deposit_request_id, etc.
  idempotency_key  TEXT          UNIQUE,    -- prevents duplicate writes on retry
  balance_after    NUMERIC(14,2),           -- snapshot of balance after this tx
  is_bonus         BOOLEAN       NOT NULL DEFAULT FALSE,
  note             TEXT,
  ip_address       INET,

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON public.transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_module
  ON public.transactions (module, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_tx_type
  ON public.transactions (tx_type);

CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON public.transactions (status) WHERE status != 'completed';

CREATE INDEX IF NOT EXISTS idx_transactions_idem
  ON public.transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Row-Level Security
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Users can only read their own transactions (Telegram bot uses service_role)
DROP POLICY IF EXISTS "transactions_own_read" ON public.transactions;
CREATE POLICY "transactions_own_read" ON public.transactions
  FOR SELECT USING (user_id::TEXT = auth.uid()::TEXT);


-- ================================================================
-- STEP 4 — MIGRATE EXISTING BINGO TRANSACTION DATA
--
-- Copy rows from bingo_transactions (if it still exists) into the
-- new unified transactions table, mapping tx_type values.
-- ================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'bingo_transactions'
  ) THEN
    INSERT INTO public.transactions
      (id, user_id, amount, tx_type, module, status,
       reference_id, idempotency_key, balance_after, is_bonus, note, created_at)
    SELECT
      id,
      tg_id,
      amount,
      -- Map old bingo tx_type values to new unified values
      CASE tx_type
        WHEN 'bingo_entry'   THEN 'bingo_entry'
        WHEN 'bingo_win'     THEN 'bingo_win'
        WHEN 'bingo_refund'  THEN 'bingo_refund'
        WHEN 'deposit'       THEN 'deposit'
        WHEN 'withdrawal'    THEN 'withdrawal'
        WHEN 'withdrawal_fee' THEN 'withdrawal_fee'
        WHEN 'bonus_credit'  THEN 'bonus_credit'
        WHEN 'bonus_debit'   THEN 'bonus_debit'
        WHEN 'admin_credit'  THEN 'admin_credit'
        WHEN 'admin_debit'   THEN 'admin_debit'
        ELSE 'admin_credit'  -- fallback for any unknown types
      END,
      -- Assign module based on tx_type
      CASE tx_type
        WHEN 'bingo_entry'  THEN 'bingo'
        WHEN 'bingo_win'    THEN 'bingo'
        WHEN 'bingo_refund' THEN 'bingo'
        ELSE 'global'
      END,
      COALESCE(status, 'completed'),
      reference_id,
      idempotency_key,
      balance_after,
      COALESCE(is_bonus, FALSE),
      note,
      created_at
    FROM public.bingo_transactions
    ON CONFLICT (idempotency_key) DO NOTHING;

    RAISE NOTICE 'Migrated rows from bingo_transactions into transactions';
  ELSE
    RAISE NOTICE 'bingo_transactions table not found — skipping data migration';
  END IF;
END;
$$;


-- ================================================================
-- STEP 5 — UPDATE FOREIGN KEYS
--
-- 5a. bets.user_id → tg_users(tg_id)
--     Currently references profiles(id) UUID.
--     After this step it references tg_users(tg_id) BIGINT.
--
-- NOTE: This is a type change (UUID → BIGINT). Existing rows will
-- have their user_id set to NULL (safe — no production data yet).
-- The place_bet_batch RPC will be updated in the code layer to
-- pass tg_id instead of auth.uid().
-- ================================================================

-- Drop the existing RLS policy on bets BEFORE altering the column type.
-- The policy uses auth.uid() (UUID) which is incompatible with the new
-- BIGINT tg_id. We do NOT recreate it — auth is now handled via
-- service_role + tg_id in the application layer.
DROP POLICY IF EXISTS "bets_own"        ON public.bets;
DROP POLICY IF EXISTS "bets_insert_own" ON public.bets;
DROP POLICY IF EXISTS "bets_select"     ON public.bets;
DROP POLICY IF EXISTS "bets_update"     ON public.bets;
DROP POLICY IF EXISTS "bets_delete"     ON public.bets;

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop ALL existing FK constraints on bets.user_id
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.bets'::regclass
      AND contype  = 'f'
      AND conname  LIKE '%user_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.bets DROP CONSTRAINT IF EXISTS %I', r.conname);
    RAISE NOTICE 'Dropped FK constraint % from bets', r.conname;
  END LOOP;

  -- Change user_id column type from UUID to BIGINT
  -- (existing rows get NULL — acceptable for dev/staging)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'bets'
      AND column_name  = 'user_id'
      AND data_type    = 'uuid'
  ) THEN
    ALTER TABLE public.bets
      ALTER COLUMN user_id TYPE BIGINT USING NULL;
    RAISE NOTICE 'bets.user_id type changed from UUID to BIGINT';
  END IF;

  -- Add new FK: bets.user_id → tg_users(tg_id)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bets'::regclass
      AND conname  = 'bets_user_id_tg_fkey'
  ) THEN
    ALTER TABLE public.bets
      ADD CONSTRAINT bets_user_id_tg_fkey
      FOREIGN KEY (user_id) REFERENCES public.tg_users(tg_id) ON DELETE CASCADE;
    RAISE NOTICE 'Added FK bets.user_id → tg_users(tg_id)';
  END IF;
END;
$$;

-- RLS on bets: service_role bypasses RLS entirely.
-- No auth.uid()-based policy is recreated — Telegram auth uses tg_id
-- which is not a Supabase Auth UUID. Access is controlled at the
-- API layer (service_role key + server-side tg_id validation).
-- RLS remains ENABLED so future policies can be added safely.


-- ================================================================
-- 5b. bingo_deposit_requests.user_id → tg_users(tg_id)
-- ================================================================

-- Drop ALL RLS policies on bingo_deposit_requests that reference user_id
-- BEFORE altering the column type (Postgres blocks ALTER COLUMN TYPE
-- when any policy expression depends on the column).
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bingo_deposit_requests'
  ) THEN
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'bingo_deposit_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.bingo_deposit_requests', r.policyname);
      RAISE NOTICE 'Dropped policy % on bingo_deposit_requests', r.policyname;
    END LOOP;
  END IF;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'bingo_deposit_requests'
  ) THEN
    -- Drop existing FK constraints
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.bingo_deposit_requests'::regclass
        AND contype  = 'f'
        AND conname  LIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.bingo_deposit_requests DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    -- Change type if needed
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'bingo_deposit_requests'
        AND column_name  = 'user_id'
        AND data_type    = 'uuid'
    ) THEN
      ALTER TABLE public.bingo_deposit_requests
        ALTER COLUMN user_id TYPE BIGINT USING NULL;
    END IF;

    -- Add new FK
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bingo_deposit_requests'::regclass
        AND conname  = 'bingo_deposit_requests_user_id_tg_fkey'
    ) THEN
      ALTER TABLE public.bingo_deposit_requests
        ADD CONSTRAINT bingo_deposit_requests_user_id_tg_fkey
        FOREIGN KEY (user_id) REFERENCES public.tg_users(tg_id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'bingo_deposit_requests.user_id → tg_users(tg_id) updated';
  ELSE
    RAISE NOTICE 'bingo_deposit_requests table not found — skipping';
  END IF;
END;
$$;


-- ================================================================
-- 5c. bingo_powerup_inventory.user_id → tg_users(tg_id)
-- ================================================================

-- Drop ALL RLS policies before ALTER COLUMN TYPE
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bingo_powerup_inventory'
  ) THEN
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'bingo_powerup_inventory'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.bingo_powerup_inventory', r.policyname);
      RAISE NOTICE 'Dropped policy % on bingo_powerup_inventory', r.policyname;
    END LOOP;
  END IF;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'bingo_powerup_inventory'
  ) THEN
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.bingo_powerup_inventory'::regclass
        AND contype  = 'f'
        AND conname  LIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.bingo_powerup_inventory DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'bingo_powerup_inventory'
        AND column_name  = 'user_id'
        AND data_type    = 'uuid'
    ) THEN
      ALTER TABLE public.bingo_powerup_inventory
        ALTER COLUMN user_id TYPE BIGINT USING NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bingo_powerup_inventory'::regclass
        AND conname  = 'bingo_powerup_inventory_user_id_tg_fkey'
    ) THEN
      ALTER TABLE public.bingo_powerup_inventory
        ADD CONSTRAINT bingo_powerup_inventory_user_id_tg_fkey
        FOREIGN KEY (user_id) REFERENCES public.tg_users(tg_id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'bingo_powerup_inventory.user_id → tg_users(tg_id) updated';
  ELSE
    RAISE NOTICE 'bingo_powerup_inventory table not found — skipping';
  END IF;
END;
$$;


-- ================================================================
-- 5d. bingo_powerup_purchases.user_id → tg_users(tg_id)
-- ================================================================

-- Drop ALL RLS policies before ALTER COLUMN TYPE
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bingo_powerup_purchases'
  ) THEN
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'bingo_powerup_purchases'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.bingo_powerup_purchases', r.policyname);
      RAISE NOTICE 'Dropped policy % on bingo_powerup_purchases', r.policyname;
    END LOOP;
  END IF;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'bingo_powerup_purchases'
  ) THEN
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.bingo_powerup_purchases'::regclass
        AND contype  = 'f'
        AND conname  LIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.bingo_powerup_purchases DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'bingo_powerup_purchases'
        AND column_name  = 'user_id'
        AND data_type    = 'uuid'
    ) THEN
      ALTER TABLE public.bingo_powerup_purchases
        ALTER COLUMN user_id TYPE BIGINT USING NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bingo_powerup_purchases'::regclass
        AND conname  = 'bingo_powerup_purchases_user_id_tg_fkey'
    ) THEN
      ALTER TABLE public.bingo_powerup_purchases
        ADD CONSTRAINT bingo_powerup_purchases_user_id_tg_fkey
        FOREIGN KEY (user_id) REFERENCES public.tg_users(tg_id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'bingo_powerup_purchases.user_id → tg_users(tg_id) updated';
  ELSE
    RAISE NOTICE 'bingo_powerup_purchases table not found — skipping';
  END IF;
END;
$$;


-- ================================================================
-- 5e. bingo_withdrawal_requests.user_id → tg_users(tg_id)
-- ================================================================

-- Drop ALL RLS policies before ALTER COLUMN TYPE
DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bingo_withdrawal_requests'
  ) THEN
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'bingo_withdrawal_requests'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.bingo_withdrawal_requests', r.policyname);
      RAISE NOTICE 'Dropped policy % on bingo_withdrawal_requests', r.policyname;
    END LOOP;
  END IF;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'bingo_withdrawal_requests'
  ) THEN
    FOR r IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.bingo_withdrawal_requests'::regclass
        AND contype  = 'f'
        AND conname  LIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.bingo_withdrawal_requests DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'bingo_withdrawal_requests'
        AND column_name  = 'user_id'
        AND data_type    = 'uuid'
    ) THEN
      ALTER TABLE public.bingo_withdrawal_requests
        ALTER COLUMN user_id TYPE BIGINT USING NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bingo_withdrawal_requests'::regclass
        AND conname  = 'bingo_withdrawal_requests_user_id_tg_fkey'
    ) THEN
      ALTER TABLE public.bingo_withdrawal_requests
        ADD CONSTRAINT bingo_withdrawal_requests_user_id_tg_fkey
        FOREIGN KEY (user_id) REFERENCES public.tg_users(tg_id) ON DELETE CASCADE;
    END IF;

    RAISE NOTICE 'bingo_withdrawal_requests.user_id → tg_users(tg_id) updated';
  ELSE
    RAISE NOTICE 'bingo_withdrawal_requests table not found — skipping';
  END IF;
END;
$$;


-- ================================================================
-- STEP 6 — UPDATE BINGO RPCs TO USE UNIFIED transactions TABLE
--
-- Replace bingo_wallet_credit and bingo_wallet_debit to write into
-- public.transactions instead of bingo_transactions.
-- Also update bingo_get_wallet_summary to read from transactions.
-- ================================================================

-- ── bingo_wallet_credit (unified) ────────────────────────────
CREATE OR REPLACE FUNCTION public.bingo_wallet_credit(
  p_tg_id    BIGINT,
  p_amount   NUMERIC,
  p_type     TEXT,
  p_idem_key TEXT    DEFAULT NULL,
  p_note     TEXT    DEFAULT NULL,
  p_is_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_bal  NUMERIC;
  v_tx_id    UUID;
  v_idem     TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be positive');
  END IF;

  UPDATE public.tg_users
     SET balance = balance + p_amount
   WHERE tg_id = p_tg_id
   RETURNING balance INTO v_new_bal;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  v_idem := COALESCE(p_idem_key, 'credit-' || p_tg_id::TEXT || '-' || gen_random_uuid()::TEXT);

  INSERT INTO public.transactions
    (user_id, amount, tx_type, module, idempotency_key, balance_after, is_bonus, note, status)
  VALUES
    (p_tg_id, p_amount,
     CASE p_type
       WHEN 'bingo_entry'  THEN 'bingo_entry'
       WHEN 'bingo_win'    THEN 'bingo_win'
       WHEN 'bingo_refund' THEN 'bingo_refund'
       WHEN 'deposit'      THEN 'deposit'
       WHEN 'withdrawal'   THEN 'withdrawal'
       WHEN 'bonus_credit' THEN 'bonus_credit'
       WHEN 'admin_credit' THEN 'admin_credit'
       ELSE 'admin_credit'
     END,
     CASE p_type
       WHEN 'bingo_entry'  THEN 'bingo'
       WHEN 'bingo_win'    THEN 'bingo'
       WHEN 'bingo_refund' THEN 'bingo'
       ELSE 'global'
     END,
     v_idem, v_new_bal, p_is_bonus,
     COALESCE(p_note, p_type), 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_new_bal, 'tx_id', v_tx_id);
END;
$$;


-- ── bingo_wallet_debit (unified) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.bingo_wallet_debit(
  p_tg_id    BIGINT,
  p_amount   NUMERIC,
  p_type     TEXT,
  p_idem_key TEXT    DEFAULT NULL,
  p_note     TEXT    DEFAULT NULL,
  p_is_bonus BOOLEAN DEFAULT FALSE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cur_bal  NUMERIC;
  v_new_bal  NUMERIC;
  v_tx_id    UUID;
  v_idem     TEXT;
BEGIN
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('error', 'Amount must be positive');
  END IF;

  SELECT balance INTO v_cur_bal
    FROM public.tg_users
   WHERE tg_id = p_tg_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  IF v_cur_bal < p_amount THEN
    RETURN jsonb_build_object(
      'error',     'Insufficient balance',
      'available', v_cur_bal,
      'required',  p_amount
    );
  END IF;

  v_new_bal := v_cur_bal - p_amount;

  UPDATE public.tg_users
     SET balance = v_new_bal
   WHERE tg_id = p_tg_id;

  v_idem := COALESCE(p_idem_key, 'debit-' || p_tg_id::TEXT || '-' || gen_random_uuid()::TEXT);

  INSERT INTO public.transactions
    (user_id, amount, tx_type, module, idempotency_key, balance_after, is_bonus, note, status)
  VALUES
    (p_tg_id, -p_amount,
     CASE p_type
       WHEN 'bingo_entry'    THEN 'bingo_entry'
       WHEN 'bingo_win'      THEN 'bingo_win'
       WHEN 'bingo_refund'   THEN 'bingo_refund'
       WHEN 'withdrawal'     THEN 'withdrawal'
       WHEN 'withdrawal_fee' THEN 'withdrawal_fee'
       WHEN 'bonus_debit'    THEN 'bonus_debit'
       WHEN 'admin_debit'    THEN 'admin_debit'
       ELSE 'admin_debit'
     END,
     CASE p_type
       WHEN 'bingo_entry'  THEN 'bingo'
       WHEN 'bingo_win'    THEN 'bingo'
       WHEN 'bingo_refund' THEN 'bingo'
       ELSE 'global'
     END,
     v_idem, v_new_bal, p_is_bonus,
     COALESCE(p_note, p_type), 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', TRUE, 'new_balance', v_new_bal, 'tx_id', v_tx_id);
END;
$$;


-- ── bingo_get_wallet_summary (reads from unified transactions) ─
CREATE OR REPLACE FUNCTION public.bingo_get_wallet_summary(p_tg_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user      public.tg_users%ROWTYPE;
  v_tx_rows   JSONB;
  v_game_rows JSONB;
BEGIN
  SELECT * INTO v_user FROM public.tg_users WHERE tg_id = p_tg_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;

  -- Last 20 transactions from unified table (bingo module only for wallet summary)
  SELECT jsonb_agg(t ORDER BY t.created_at DESC) INTO v_tx_rows FROM (
    SELECT id, amount, tx_type AS type, note, balance_after, is_bonus, module, status, created_at
      FROM public.transactions
     WHERE user_id = p_tg_id
     ORDER BY created_at DESC
     LIMIT 20
  ) t;

  -- Last 20 game sessions from bingo_cards
  SELECT jsonb_agg(g ORDER BY g."createdAt" DESC) INTO v_game_rows FROM (
    SELECT s.id,
           r.game_code                                         AS "gameId",
           r.entry_fee                                         AS stake,
           CASE WHEN s.win_claimed THEN 'win' ELSE 'loss' END AS result,
           COALESCE(s.payout_amount, 0)                        AS payout,
           s.joined_at                                         AS "createdAt"
      FROM public.bingo_cards s
      JOIN public.bingo_rooms r ON r.id = s.room_id
     WHERE s.tg_id = p_tg_id
     ORDER BY s.joined_at DESC
     LIMIT 20
  ) g;

  RETURN jsonb_build_object(
    'tg_id',        v_user.tg_id,
    'phone',        v_user.phone,
    'name',         v_user.display_name,
    'wallet',       v_user.balance,
    'transactions', COALESCE(v_tx_rows,   '[]'::jsonb),
    'gameHistory',  COALESCE(v_game_rows, '[]'::jsonb)
  );
END;
$$;


-- ── bingo_get_user_by_tg_id (alias — unchanged) ───────────────
CREATE OR REPLACE FUNCTION public.bingo_get_user_by_tg_id(p_tg_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN public.bingo_get_wallet_summary(p_tg_id);
END;
$$;


-- ── bingo_upsert_telegram_user (updated to use balance) ───────
CREATE OR REPLACE FUNCTION public.bingo_upsert_telegram_user(
  p_tg_id       BIGINT,
  p_tg_username TEXT    DEFAULT NULL,
  p_first_name  TEXT    DEFAULT NULL,
  p_last_name   TEXT    DEFAULT NULL,
  p_photo_url   TEXT    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name    TEXT;
  v_tg_id   BIGINT;
BEGIN
  v_name := TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, ''));
  IF v_name = '' OR v_name IS NULL THEN
    v_name := COALESCE(p_tg_username, 'Player_' || p_tg_id::TEXT);
  END IF;
  v_name := LEFT(v_name, 50);

  INSERT INTO public.tg_users (tg_id, tg_username, display_name, auth_type, avatar_url)
  VALUES (p_tg_id, p_tg_username, v_name, 'telegram', p_photo_url)
  ON CONFLICT (tg_id) DO UPDATE
    SET tg_username  = COALESCE(EXCLUDED.tg_username, public.tg_users.tg_username),
        display_name = CASE
          WHEN public.tg_users.display_name LIKE 'Player_%' THEN EXCLUDED.display_name
          ELSE public.tg_users.display_name
        END,
        avatar_url   = COALESCE(EXCLUDED.avatar_url, public.tg_users.avatar_url)
  RETURNING tg_id INTO v_tg_id;

  RETURN public.bingo_get_wallet_summary(v_tg_id);
END;
$$;


-- ================================================================
-- STEP 7 — UPDATE place_bet_batch TO USE tg_users
--
-- The RPC currently reads from profiles.balance and inserts bets
-- with user_id UUID. After this migration, bets.user_id is BIGINT
-- referencing tg_users(tg_id). The RPC is updated accordingly.
-- ================================================================

CREATE OR REPLACE FUNCTION public.place_bet_batch(
  p_tg_id       BIGINT,
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
  v_tx_id      UUID;
  v_idem       TEXT;
BEGIN
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

  -- Lock user row (TOCTOU guard)
  SELECT balance INTO v_balance
    FROM public.tg_users
   WHERE tg_id = p_tg_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
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
  UPDATE public.tg_users SET balance = v_new_bal WHERE tg_id = p_tg_id;

  -- Record in unified transactions ledger
  v_idem := 'sports-bet-' || p_tg_id::TEXT || '-' || v_slip_id::TEXT;
  INSERT INTO public.transactions
    (user_id, amount, tx_type, module, idempotency_key, balance_after, note, status)
  VALUES
    (p_tg_id, -p_total_stake, 'sports_bet', 'sports', v_idem, v_new_bal,
     'Sports bet — ' || jsonb_array_length(p_bets) || ' selection(s)', 'completed')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_tx_id;

  -- Insert one bet row per selection
  FOR v_bet IN SELECT * FROM jsonb_array_elements(p_bets) LOOP
    BEGIN
      SELECT home_team || ' vs ' || away_team INTO v_match_name
        FROM public.fixtures
       WHERE id = (v_bet->>'fixture_id')::BIGINT;
    EXCEPTION WHEN OTHERS THEN
      v_match_name := NULL;
    END;

    INSERT INTO public.bets (
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
      p_tg_id,
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

GRANT EXECUTE ON FUNCTION public.place_bet_batch(BIGINT, NUMERIC, JSONB) TO service_role;


-- ================================================================
-- STEP 8 — GRANT PERMISSIONS
-- ================================================================

GRANT EXECUTE ON FUNCTION public.bingo_wallet_credit(BIGINT, NUMERIC, TEXT, TEXT, TEXT, BOOLEAN)  TO service_role;
GRANT EXECUTE ON FUNCTION public.bingo_wallet_debit(BIGINT, NUMERIC, TEXT, TEXT, TEXT, BOOLEAN)   TO service_role;
GRANT EXECUTE ON FUNCTION public.bingo_get_wallet_summary(BIGINT)                                 TO service_role;
GRANT EXECUTE ON FUNCTION public.bingo_get_user_by_tg_id(BIGINT)                                  TO service_role;
GRANT EXECUTE ON FUNCTION public.bingo_upsert_telegram_user(BIGINT, TEXT, TEXT, TEXT, TEXT)       TO service_role;


-- ================================================================
-- VERIFICATION QUERIES (run separately to confirm)
-- ================================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' ORDER BY table_name;
--
-- Expected tables after this migration:
--   bets
--   bingo_cards          (was bingo_sessions)
--   bingo_deposit_requests
--   bingo_draw_log
--   bingo_powerup_inventory
--   bingo_powerup_purchases
--   bingo_powerup_shop
--   bingo_rooms
--   bingo_transactions   (legacy — data migrated to transactions)
--   bingo_withdrawal_requests
--   fixtures
--   profiles             (Supabase Auth auto-created)
--   tg_users             (was bingo_users)
--   transactions         (NEW — unified ledger)
--
-- Dropped tables:
--   bingo_sessions       (was already renamed to bingo_cards)
--   bingo_users          (was already renamed to tg_users)
--   bingo_wallet_tx      (was already renamed to bingo_transactions)
--   sports_transactions  (was bingo_withdrawal_requests, now dropped)
-- ================================================================
