'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBingoStore, BingoRoom } from '@/store/bingoStore';
import { useTelegram } from '@/lib/useTelegram';
import BingoGameBoard from './GameBoard';
import BingoCardSelection from './CardSelection';

interface WalletData {
  name: string;
  wallet: number; 
  transactions: Array<any>;
  gameHistory: Array<any>;
}

// 🚀 UPGRADED: 100-Player Massive Multiplayer Config
// Prize calculates a full 100-player lobby minus a 20% house edge.
const STAKE_OPTIONS = [
  { label: '10 ETB', amount: 10, players: 100, maxPrize: 800 },
  { label: '25 ETB', amount: 25, players: 100, maxPrize: 2000 },
  { label: '50 ETB', amount: 50, players: 100, maxPrize: 4000 },
  { label: '100 ETB', amount: 100, players: 100, maxPrize: 8000 },
];

const NAV_TABS = [
  { key: 'home',   icon: '🏠', label: 'Home'    },
  { key: 'logs',   icon: '📋', label: 'Logs'    },
  { key: 'top',    icon: '🏆', label: 'Top'     },
  { key: 'me',     icon: '👤', label: 'Profile' },
] as const;

type TabKey = typeof NAV_TABS[number]['key'];

export default function BingoPage() {
  const { tgId, isTelegram, haptic } = useTelegram();
  const { screen, fetchRooms, isRecovering, recoverSession } = useBingoStore();

  const [tab, setTab] = useState<TabKey>('home');
  const [loadingStakeId, setLoadingStakeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  const fetchWallet = useCallback(async (id: number) => {
    setWalletLoading(true);
    try {
      const res = await fetch(`/api/bingo/wallet?tgId=${id}&t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setWallet(data);
      }
    } catch {
      // silent fail
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tgId) {
      recoverSession(tgId);
      fetchWallet(tgId);
    }
  }, [tgId, recoverSession, fetchWallet]);

  useEffect(() => {
    if (screen === 'lobby') {
      fetchRooms();
    }
  }, [screen, fetchRooms]);

  const handleJoinStake = async (opt: typeof STAKE_OPTIONS[0]) => {
    if (!tgId) {
      setError('Telegram ID not found.');
      return;
    }
    
    setLoadingStakeId(opt.amount.toString());
    setError(null);
    
    try {
      // 🚀 Passing the updated opt.players (100) to the backend
      await useBingoStore.getState().joinStakeRoom(tgId, opt.amount, opt.players);
      if (isTelegram) haptic.impact('medium');
    } catch (e: any) {
      setError(e.message || 'Failed to join room. Check your balance.');
      if (isTelegram) haptic.notification('error');
    } finally {
      setLoadingStakeId(null);
    }
  };

  if (!isTelegram && !tgId) {
    return (
      <div className="min-h-screen bg-[#042014] flex items-center justify-center p-6 safe-area">
        <div className="text-center">
          <div className="text-5xl mb-4">🎱</div>
          <h2 className="text-white text-xl font-bold mb-2">CHELA Bingo</h2>
          <p className="text-white/60 text-sm">Open this app from the Telegram bot to play.</p>
        </div>
      </div>
    );
  }

  if (isRecovering && tgId) {
    return (
      <div className="min-h-screen bg-[#042014] flex flex-col items-center justify-center safe-area">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-emerald-500 mt-4 font-mono font-bold tracking-widest animate-pulse">RECOVERING SESSION...</p>
      </div>
    );
  }

  if (screen === 'game') return <BingoGameBoard tgId={tgId!} />;
  if (screen === 'card-select') return <BingoCardSelection tgId={tgId!} />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#042014] via-[#052e18] to-[#021a0c] flex flex-col pt-safe">
      
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🎱</span>
          <span className="text-white font-extrabold text-lg tracking-wide">CHELA Bingo</span>
        </div>
        <div className="w-8 h-8" />
      </div>

      {/* Persistent Balance Indicator */}
      <div className="mx-4 mt-3 mb-1">
        <div className="bg-[#0a4a2e]/80 border border-white/10 rounded-2xl px-4 py-2 flex items-center justify-between">
          <span className="text-white/60 text-xs">Balance</span>
          <span className="text-green-400 font-bold text-base">
            {walletLoading ? '…' : (wallet?.wallet !== undefined && wallet?.wallet !== null) ? `${Number(wallet.wallet).toFixed(2)} ETB` : '0.00 ETB'}
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {screen === 'lobby' && (
          <motion.div key="lobby" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.25 }} className="flex-1 flex flex-col">
            
            <div className="px-4 py-6 text-center">
              <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2.5 }} className="text-6xl mb-3">🎱</motion.div>
              <h1 className="text-white text-2xl font-extrabold mb-1">CHELA Bingo</h1>
              <p className="text-white/50 text-sm">100-Player Massive Multiplayer</p>
            </div>

            {tab === 'home' && (
              <motion.div key="home-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col px-4 z-10 safe-area-bottom">
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => useBingoStore.setState({ screen: 'select' })} className="w-full py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-xl shadow-[0_8px_32px_rgba(74,222,128,0.35)] active:shadow-none transition-all">
                  🎮 Play Now
                </motion.button>
                <div className="mt-6 bg-[#0a4a2e]/40 border border-white/5 rounded-2xl p-5 text-center">
                   <p className="text-white/80 text-sm font-medium">Servers are live. Join a room to start winning!</p>
                </div>
              </motion.div>
            )}

            {tab === 'logs' && (
              <motion.div key="logs-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-4 bg-[#0a4a2e]/60 border border-white/10 rounded-2xl p-6 mb-24 text-center">
                <div className="text-4xl mb-3 opacity-50">📋</div>
                <h3 className="text-white font-bold mb-2 text-sm uppercase tracking-wider">Game Logs</h3>
                <p className="text-white/50 text-xs">Your recent match history will appear here.</p>
              </motion.div>
            )}

            {tab === 'top' && (
              <motion.div key="top-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-4 bg-[#0a4a2e]/60 border border-white/10 rounded-2xl p-6 mb-24 text-center">
                <div className="text-4xl mb-3 opacity-50">🏆</div>
                <h3 className="text-white font-bold mb-2 text-sm uppercase tracking-wider">Leaderboard</h3>
                <p className="text-white/50 text-xs">Top winners of the week will be displayed here.</p>
              </motion.div>
            )}

            {tab === 'me' && (
              <motion.div key="me-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-4 bg-[#0a4a2e]/60 border border-white/10 rounded-2xl p-4 mb-24">
                <h3 className="text-white font-bold mb-3 text-sm uppercase tracking-wider">My Profile</h3>
                <div className="space-y-2">
                  <div className="flex justify-between bg-[#063320] rounded-xl px-3 py-2"><span className="text-white/60 text-sm">Name</span><span className="text-white text-sm font-bold">{wallet?.name || 'Player'}</span></div>
                  <div className="flex justify-between bg-[#063320] rounded-xl px-3 py-2"><span className="text-white/60 text-sm">Telegram ID</span><span className="text-white text-sm font-mono">{tgId}</span></div>
                  <div className="flex justify-between bg-[#063320] rounded-xl px-3 py-2"><span className="text-white/60 text-sm">Balance</span><span className="text-green-400 text-sm font-bold">{((wallet?.wallet !== undefined && wallet?.wallet !== null) ? Number(wallet.wallet).toFixed(2) : '0.00')} ETB</span></div>
                </div>
                
                <div className="mt-4 bg-[#063320] border border-white/10 rounded-xl p-3 text-center">
                   <p className="text-white/60 text-xs">To Deposit or Withdraw funds, please close this app and use the main Telegram Bot menu.</p>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* 🚀 UPGRADED ROOM SELECTION SCREEN */}
        {screen === 'select' && (
          <motion.div key="select" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.25 }} className="flex-1 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 sticky top-safe z-10 bg-[#042014]">
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => useBingoStore.setState({ screen: 'lobby' })} className="flex items-center gap-1 text-white/60 text-sm">← Back</motion.button>
              <span className="text-white font-bold text-sm">Choose Room</span>
              <div className="w-8 h-8" />
            </div>

            {error && <div className="mx-4 mb-3 bg-red-500/20 border border-red-500/40 rounded-xl px-3 py-2 text-red-300 text-sm">{error}</div>}

            <div className="px-4 space-y-4 pb-24 overflow-y-auto max-h-[80vh]">
              {STAKE_OPTIONS.map((opt, index) => {
                const isThisLoading = loadingStakeId === opt.amount.toString();

                return (
                  <motion.button
                    key={opt.amount}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1, duration: 0.3 }}
                    whileTap={{ scale: 0.96, boxShadow: "0px 0px 20px rgba(74,222,128,0.3)" }}
                    disabled={loadingStakeId !== null}
                    onClick={() => handleJoinStake(opt)}
                    className="w-full bg-gradient-to-br from-[#0a4a2e] to-[#042b1a] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-md overflow-hidden relative rounded-2xl p-5 text-left disabled:opacity-50 transition-all duration-200 hover:border-green-500/30"
                  >
                    <div className="relative z-10 flex items-center justify-between">
                      <div>
                        <p className="text-white font-black text-lg">{opt.label} Room</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          {/* Live Pulsing Dot */}
                          <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                          <p className="text-white/60 text-xs font-medium">Max {opt.players} players</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-yellow-400 font-black text-[10px] uppercase tracking-widest mb-0.5">
                          {isThisLoading ? '⌛' : 'UP TO'}
                        </p>
                        {!isThisLoading && (
                          <p className="text-green-400 font-black text-lg">
                            🏆 {opt.maxPrize} ETB
                          </p>
                        )}
                      </div>
                    </div>
                    {isThisLoading && <div className="absolute inset-0 bg-[#0a4a2e]/90 flex items-center justify-center backdrop-blur-sm z-20"><div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div></div>}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-[#042014]/90 backdrop-blur-lg border-t border-white/10 flex items-center justify-around px-2 py-2 safe-area-bottom">
        {NAV_TABS.map(item => {
          const active = tab === item.key;
          return (
            <motion.button key={item.key} whileTap={{ scale: 0.9 }} onClick={() => { setTab(item.key); if (screen !== 'lobby') useBingoStore.setState({ screen: 'lobby' }); if (isTelegram) haptic.selection(); }} className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all ${active ? 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.8)] scale-110' : 'text-white/40 hover:text-white/60' }`}>
              <span className="text-xl">{item.icon}</span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </motion.button>
          );
        })}
      </nav>
    </div>
  );
}