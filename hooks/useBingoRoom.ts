'use client';

/**
 * useBingoRoom.ts — Supabase Realtime Presence + Postgres Changes hook.
 *
 * Manages player synchronization via Presence AND listens for
 * drawn_numbers updates on bingo_rooms via Postgres Changes.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { TgUser } from '@/lib/database.types';

// ── Player shape broadcast via Presence ──────────────────────
export interface BingoRoomPlayer {
  tg_id: number;
  display_name: string;
  avatar_url: string | null;
  joined_at: string;
}

// ── Hook return type ─────────────────────────────────────────
export interface UseBingoRoomReturn {
  activePlayers: BingoRoomPlayer[];
  isConnected: boolean;
  drawnNumbers: number[];
  roomStatus: 'waiting' | 'countdown' | 'active' | 'finished' | null;
  countdownStartedAt: string | null;
}

// ── Helper: deduplicate players by tg_id ─────────────────────
function deduplicatePlayers(
  presenceState: Record<string, { tg_id: number; display_name: string; avatar_url: string | null; joined_at: string }[]>
): BingoRoomPlayer[] {
  const seen = new Map<number, BingoRoomPlayer>();

  for (const key of Object.keys(presenceState)) {
    const entries = presenceState[key];
    for (const entry of entries) {
      const existing = seen.get(entry.tg_id);
      if (!existing || entry.joined_at < existing.joined_at) {
        seen.set(entry.tg_id, {
          tg_id: entry.tg_id,
          display_name: entry.display_name,
          avatar_url: entry.avatar_url,
          joined_at: entry.joined_at,
        });
      }
    }
  }

  return Array.from(seen.values()).sort(
    (a, b) => a.joined_at.localeCompare(b.joined_at)
  );
}

// ── Hook ─────────────────────────────────────────────────────
export function useBingoRoom(
  roomId: string,
  user: TgUser | null
): UseBingoRoomReturn {
  const [activePlayers, setActivePlayers] = useState<BingoRoomPlayer[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [drawnNumbers, setDrawnNumbers] = useState<number[]>([]);
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'countdown' | 'active' | 'finished' | null>(null);
  const [countdownStartedAt, setCountdownStartedAt] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const syncPlayers = useCallback((channel: RealtimeChannel) => {
    const state = channel.presenceState<{
      tg_id: number;
      display_name: string;
      avatar_url: string | null;
      joined_at: string;
    }>();
    setActivePlayers(deduplicatePlayers(state));
  }, []);

  useEffect(() => {
    if (!roomId || !user?.tg_id) return;

    const channel = supabase.channel(`room:${roomId}`, {
      config: { presence: { key: String(user.tg_id) } },
    });

    channelRef.current = channel;

    // ── Presence sync listener ─────────────────────────────
    channel.on('presence', { event: 'sync' }, () => {
      syncPlayers(channel);
    });

    // ── Postgres Changes listener for drawn_numbers ────────
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'bingo_rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload) => {
        const newRow = payload.new as {
          drawn_numbers?: number[];
          status?: string;
          countdown_started_at?: string | null;
        };
        if (newRow.drawn_numbers && Array.isArray(newRow.drawn_numbers)) {
          setDrawnNumbers(newRow.drawn_numbers);
        }
        if (newRow.status) {
          setRoomStatus(newRow.status as 'waiting' | 'countdown' | 'active' | 'finished');
        }
        if (newRow.countdown_started_at !== undefined) {
          setCountdownStartedAt(newRow.countdown_started_at);
        }
      }
    );

    // ── Subscribe and track ────────────────────────────────
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);

        await channel.track({
          tg_id: user.tg_id,
          display_name: user.display_name,
          avatar_url: user.avatar_url ?? null,
          joined_at: new Date().toISOString(),
        });
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setIsConnected(false);
      }
    });

    // ── Cleanup on unmount or dependency change ────────────
    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [roomId, user?.tg_id, user?.display_name, user?.avatar_url, syncPlayers]);

  return { activePlayers, isConnected, drawnNumbers, roomStatus, countdownStartedAt };
}
