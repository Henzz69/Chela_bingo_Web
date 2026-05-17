-- ============================================================
-- Migration: Create public.bingo_cards table
-- Stores generated bingo cards assigned to players in rooms.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bingo_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        NOT NULL,
  tg_id       BIGINT      NOT NULL REFERENCES public.tg_users(tg_id),
  card_index  INT         NOT NULL DEFAULT 1,
  grid        JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A player can only have one card per index per room
  CONSTRAINT uq_bingo_cards_room_player_index UNIQUE (room_id, tg_id, card_index)
);

-- Index for fast lookups by room
CREATE INDEX IF NOT EXISTS idx_bingo_cards_room_id ON public.bingo_cards(room_id);

-- Index for fast lookups by player
CREATE INDEX IF NOT EXISTS idx_bingo_cards_tg_id ON public.bingo_cards(tg_id);

-- RLS: enable but allow service-role to bypass
ALTER TABLE public.bingo_cards ENABLE ROW LEVEL SECURITY;
