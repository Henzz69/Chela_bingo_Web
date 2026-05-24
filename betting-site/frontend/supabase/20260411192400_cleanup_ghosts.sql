-- ============================================================
-- Migration: 20260411192400_cleanup_ghosts.sql
-- Purpose:   Final schema cleanup
--   1. Drop the legacy bingo_transactions table
--   2. Rename wallet_tx_id → transaction_id on three tables
--   3. Add FK constraints to public.transactions(id)
-- ============================================================

BEGIN;

-- ── 1. Drop legacy bingo_transactions table ──────────────────
DROP TABLE IF EXISTS public.bingo_transactions CASCADE;

-- ── 2a. bingo_deposit_requests ───────────────────────────────
-- Rename column
ALTER TABLE public.bingo_deposit_requests
  RENAME COLUMN wallet_tx_id TO transaction_id;

-- Orphan cleanup: NULL out any transaction_id values that don't
-- exist in public.transactions (safety for dummy/test data)
UPDATE public.bingo_deposit_requests
   SET transaction_id = NULL
 WHERE transaction_id IS NOT NULL
   AND transaction_id NOT IN (SELECT id FROM public.transactions);

-- Add FK constraint
ALTER TABLE public.bingo_deposit_requests
  ADD CONSTRAINT fk_deposit_requests_transaction
  FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);

-- ── 2b. bingo_withdrawal_requests ────────────────────────────
-- Rename column
ALTER TABLE public.bingo_withdrawal_requests
  RENAME COLUMN wallet_tx_id TO transaction_id;

-- Orphan cleanup
UPDATE public.bingo_withdrawal_requests
   SET transaction_id = NULL
 WHERE transaction_id IS NOT NULL
   AND transaction_id NOT IN (SELECT id FROM public.transactions);

-- Add FK constraint
ALTER TABLE public.bingo_withdrawal_requests
  ADD CONSTRAINT fk_withdrawal_requests_transaction
  FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);

-- ── 2c. bingo_powerup_purchases ──────────────────────────────
-- Rename column
ALTER TABLE public.bingo_powerup_purchases
  RENAME COLUMN wallet_tx_id TO transaction_id;

-- Orphan cleanup
UPDATE public.bingo_powerup_purchases
   SET transaction_id = NULL
 WHERE transaction_id IS NOT NULL
   AND transaction_id NOT IN (SELECT id FROM public.transactions);

-- Add FK constraint
ALTER TABLE public.bingo_powerup_purchases
  ADD CONSTRAINT fk_powerup_purchases_transaction
  FOREIGN KEY (transaction_id) REFERENCES public.transactions(id);

COMMIT;
