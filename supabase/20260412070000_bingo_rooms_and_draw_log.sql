-- ============================================================
-- Migration: Create bingo_rooms + bingo_draw_log tables
-- Safe to re-run (all CREATE IF NOT EXISTS).
-- ============================================================

-- ── bingo_rooms ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bingo_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          TEXT        NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'active', 'finished')),
  stake           NUMERIC     NOT NULL DEFAULT 0,
  draw_sequence   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  drawn_numbers   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bingo_rooms ENABLE ROW LEVEL SECURITY;

-- Enable Realtime for bingo_rooms (safe: skip if already added)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'bingo_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bingo_rooms;
  END IF;
END $$;

-- ── bingo_draw_log ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bingo_draw_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID        NOT NULL REFERENCES public.bingo_rooms(id),
  draw_position   INT         NOT NULL,
  number_drawn    INT         NOT NULL,
  drawn_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bingo_draw_log_room
  ON public.bingo_draw_log(room_id, draw_position);

ALTER TABLE public.bingo_draw_log ENABLE ROW LEVEL SECURITY;
