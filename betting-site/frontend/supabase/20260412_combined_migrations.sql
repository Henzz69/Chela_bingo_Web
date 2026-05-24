-- ============================================================
-- COMBINED MIGRATION: bingo_rooms + bingo_cards + bingo_draw_log
-- Safe to re-run. Copy-paste this into Supabase Dashboard SQL Editor.
-- ============================================================

-- ── 1. bingo_rooms ───────────────────────────────────────────
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

-- Enable Realtime (safe: skip if already added)
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

-- ── 2. bingo_cards ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bingo_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        NOT NULL,
  tg_id       BIGINT      NOT NULL REFERENCES public.tg_users(tg_id),
  card_index  INT         NOT NULL DEFAULT 1,
  grid        JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_bingo_cards_room_player_index UNIQUE (room_id, tg_id, card_index)
);

CREATE INDEX IF NOT EXISTS idx_bingo_cards_room_id ON public.bingo_cards(room_id);
CREATE INDEX IF NOT EXISTS idx_bingo_cards_tg_id ON public.bingo_cards(tg_id);
ALTER TABLE public.bingo_cards ENABLE ROW LEVEL SECURITY;

-- ── 3. bingo_draw_log ────────────────────────────────────────
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

-- ── Done ─────────────────────────────────────────────────────
