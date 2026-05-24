-- ============================================================
-- Migration: Add 'countdown' status to bingo_rooms
-- Required by the Automated Bingo Caller engine.
-- ============================================================

-- Drop the old CHECK constraint and add the new one with 'countdown'
ALTER TABLE public.bingo_rooms DROP CONSTRAINT IF EXISTS bingo_rooms_status_check;
ALTER TABLE public.bingo_rooms ADD CONSTRAINT bingo_rooms_status_check
  CHECK (status IN ('waiting', 'countdown', 'active', 'finished'));

-- Add countdown_started_at column for tracking the 30-second window
ALTER TABLE public.bingo_rooms
  ADD COLUMN IF NOT EXISTS countdown_started_at TIMESTAMPTZ;

-- Add min_players column (default 2) for the engine to know when to start
ALTER TABLE public.bingo_rooms
  ADD COLUMN IF NOT EXISTS min_players INT NOT NULL DEFAULT 2;
