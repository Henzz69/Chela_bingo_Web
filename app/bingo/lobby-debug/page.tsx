'use client';

/**
 * /bingo/lobby-debug — Test page for BingoLobbyDebug component.
 *
 * Uses a hardcoded mock user and room ID to verify Supabase Realtime
 * Presence synchronization. Open this page in multiple tabs to see
 * players appear/disappear in real time.
 *
 * NOT for production — debug/verification only.
 */

import { useState } from 'react';
import BingoLobbyDebug from '@/components/bingo/BingoLobbyDebug';
import type { TgUser } from '@/lib/database.types';

// Mock user for testing — change tg_id to simulate different players
const MOCK_USER: TgUser = {
  tg_id: 100000000 + Math.floor(Math.random() * 999999),
  tg_username: 'test_player',
  display_name: `Player_${Math.floor(Math.random() * 9999)}`,
  phone: null,
  password_hash: null,
  auth_type: 'telegram',
  avatar_url: null,
  balance: 1000,
  bonus_balance: 0,
  is_active: true,
  is_verified: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const DEFAULT_ROOM_ID = 'test-room-001';

export default function LobbyDebugPage() {
  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [user] = useState<TgUser>(MOCK_USER);

  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      <div className="mx-auto max-w-lg space-y-4">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-black text-zinc-100">
            🧪 Bingo Lobby Debug
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Open this page in multiple tabs to test player sync
          </p>
        </div>

        {/* User info */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400 font-mono">
          <div>tg_id: <span className="text-zinc-200">{user.tg_id}</span></div>
          <div>name: <span className="text-zinc-200">{user.display_name}</span></div>
        </div>

        {/* Room ID input */}
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Room ID</label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            placeholder="Enter room ID..."
          />
        </div>

        {/* Debug component */}
        {roomId && <BingoLobbyDebug roomId={roomId} user={user} />}
      </div>
    </div>
  );
}
