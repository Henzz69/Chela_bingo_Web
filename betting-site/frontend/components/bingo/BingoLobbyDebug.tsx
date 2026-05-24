'use client';

/**
 * BingoLobbyDebug.tsx — Debug UI for Bingo room.
 *
 * Displays connection status, active players, Start/Draw buttons,
 * and the drawn numbers array synced via Realtime Postgres Changes.
 */

import { useState } from 'react';
import { useBingoRoom } from '@/hooks/useBingoRoom';
import type { TgUser } from '@/lib/database.types';
import type { BingoRoomPlayer } from '@/hooks/useBingoRoom';

interface BingoLobbyDebugProps {
  roomId: string;
  user: TgUser;
}

export default function BingoLobbyDebug({ roomId, user }: BingoLobbyDebugProps) {
  const { activePlayers, isConnected, drawnNumbers } = useBingoRoom(roomId, user);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Start Game handler ─────────────────────────────────────
  const handleStart = async () => {
    setActionLoading('start');
    setActionError(null);
    try {
      const res = await fetch('/api/bingo/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || `Start failed (${res.status})`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setActionLoading(null);
    }
  };

  // ── Draw Number handler ────────────────────────────────────
  const handleDraw = async () => {
    setActionLoading('draw');
    setActionError(null);
    try {
      const res = await fetch('/api/bingo/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || `Draw failed (${res.status})`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-200">
      {/* ── Header with connection status ──────────────────── */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`}
          title={isConnected ? 'Connected' : 'Disconnected'}
        />
        <span className="font-mono text-xs text-zinc-400">
          Room: <span className="text-zinc-200">{roomId}</span>
        </span>
        <span className="ml-auto font-mono text-xs text-zinc-500">
          {activePlayers.length} player{activePlayers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Player list ───────────────────────────────────── */}
      {activePlayers.length === 0 ? (
        <p className="text-center text-xs text-zinc-500">
          {isConnected ? 'Waiting for players…' : 'Connecting…'}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {activePlayers.map((player: BingoRoomPlayer) => (
            <li
              key={player.tg_id}
              className="flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-2"
            >
              {player.avatar_url ? (
                <img
                  src={player.avatar_url}
                  alt={player.display_name}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-zinc-400">
                  {player.display_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {player.display_name}
                </p>
                <p className="truncate font-mono text-[10px] text-zinc-500">
                  tg:{player.tg_id}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Action Buttons ────────────────────────────────── */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={handleStart}
          disabled={actionLoading === 'start'}
          className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {actionLoading === 'start' ? 'Starting…' : '▶ Start Game'}
        </button>
        <button
          onClick={handleDraw}
          disabled={actionLoading === 'draw'}
          className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
        >
          {actionLoading === 'draw' ? 'Drawing…' : '🎱 Draw Number'}
        </button>
      </div>

      {/* ── Action Error ──────────────────────────────────── */}
      {actionError && (
        <p className="mt-2 text-xs text-red-400">⚠ {actionError}</p>
      )}

      {/* ── Drawn Numbers Display ─────────────────────────── */}
      <div className="mt-4">
        <p className="mb-1 font-mono text-xs text-zinc-400">
          Drawn ({drawnNumbers.length}/75):
        </p>
        {drawnNumbers.length === 0 ? (
          <p className="text-xs text-zinc-600">No numbers drawn yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {drawnNumbers.map((num, idx) => (
              <span
                key={idx}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  idx === drawnNumbers.length - 1
                    ? 'bg-yellow-500 text-black ring-2 ring-yellow-300'
                    : 'bg-zinc-700 text-zinc-200'
                }`}
              >
                {num}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
