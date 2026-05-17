'use client';

import { use, useState, useEffect } from 'react';
import BingoLobbyDebug from '@/components/bingo/BingoLobbyDebug';
import type { TgUser } from '@/lib/database.types';

// Generate a stable random ID once per module load
const RANDOM_ID = Math.floor(Math.random() * 1000000);

const MOCK_USER: TgUser = {
  tg_id: RANDOM_ID,
  tg_username: `testplayer_${RANDOM_ID}`,
  display_name: `TestPlayer_${RANDOM_ID}`,
  phone: 'dummy',
  password_hash: null,
  auth_type: 'telegram',
  avatar_url: null,
  balance: 0,
  bonus_balance: 0,
  is_active: true,
  is_verified: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export default function TestLobbyPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = use(params);
  const [user] = useState<TgUser>(MOCK_USER);
  const [bingoCard, setBingoCard] = useState<Record<string, unknown> | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  // ── Fetch a Bingo card from /api/bingo/join on mount ─────
  useEffect(() => {
    if (!user.tg_id || !roomId) return;

    fetch('/api/bingo/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, tgId: user.tg_id }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          console.error('[test-lobby] /api/bingo/join error:', data);
          setCardError(data.error || `HTTP ${res.status}`);
          return;
        }
        setBingoCard(data);
      })
      .catch((err) => {
        console.error('[test-lobby] /api/bingo/join fetch failed:', err);
        setCardError(err.message || 'Network error');
      });
  }, [roomId, user.tg_id]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <BingoLobbyDebug roomId={roomId} user={user} />

      {/* ── Raw Bingo Card Data ─────────────────────────────── */}
      {cardError && (
        <pre className="text-xs bg-red-900/50 text-red-300 p-4 rounded mt-4 overflow-auto">
          Error: {cardError}
        </pre>
      )}
      {bingoCard && (
        <pre className="text-xs bg-black p-4 rounded mt-4 overflow-auto">
          {JSON.stringify(bingoCard, null, 2)}
        </pre>
      )}
      {!bingoCard && !cardError && (
        <p className="text-xs text-gray-500 mt-4">Fetching card...</p>
      )}
    </div>
  );
}
