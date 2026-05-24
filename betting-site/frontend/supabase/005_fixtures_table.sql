-- ============================================================
-- Migration 005 — fixtures table
-- ============================================================
-- This table is the ONLY one not defined in any previous SQL
-- file, yet it is referenced by:
--   • backend/sync_worker.py          (upserts rows)
--   • frontend/app/api/fixtures/      (reads rows)
--   • frontend/app/api/bets/          (joins with bets)
--   • supabase/schema_betting.sql     (place_bet_batch RPC)
--
-- Run this in the Supabase SQL editor BEFORE running
-- sync_worker.py for the first time.
-- ============================================================

-- ── Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fixtures (
  id          BIGINT        PRIMARY KEY,          -- Sportmonks fixture id
  home_team   TEXT          NOT NULL,
  away_team   TEXT          NOT NULL,
  start_time  TIMESTAMPTZ,
  home_odds   NUMERIC(8, 4),
  draw_odds   NUMERIC(8, 4),
  away_odds   NUMERIC(8, 4),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── Auto-update updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fixtures_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fixtures_updated_at ON public.fixtures;
CREATE TRIGGER trg_fixtures_updated_at
  BEFORE UPDATE ON public.fixtures
  FOR EACH ROW EXECUTE FUNCTION public.fixtures_set_updated_at();

-- ── Index for time-range queries ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fixtures_start_time
  ON public.fixtures (start_time ASC);

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can read fixtures — needed by the betting UI
CREATE POLICY "fixtures_public_read"
  ON public.fixtures
  FOR SELECT
  USING (true);

-- Only service-role (sync_worker.py) can insert/update/delete
-- No INSERT/UPDATE/DELETE policy → only service-role key bypasses RLS
