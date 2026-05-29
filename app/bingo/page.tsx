'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { useTelegram } from '@/lib/useTelegram';
import BingoGameBoard from './GameBoard';
import BingoCardSelection from './CardSelection';

interface WalletData { name: string; wallet: number; transactions: Array<any>; gameHistory: Array<any>; }

const STAKE_OPTIONS = [
  { label: '10 ETB', amount: 10, players: 100, maxPrize: 800 },
  { label: '25 ETB', amount: 25, players: 100, maxPrize: 2000 },
  { label: '50 ETB', amount: 50, players: 100, maxPrize: 4000 },
  { label: '100 ETB', amount: 100, players: 100, maxPrize: 8000 },
];

export default function BingoPage() {
  const { tgId, isTelegram, haptic } = useTelegram();
  const { screen, fetchRooms, isRecovering, recoverSession, loadingRooms, theme, toggleTheme } = useBingoStore();

  const [tab, setTab] = useState<'home' | 'logs' | 'top' | 'profile'>('home');
  const [loadingStakeId, setLoadingStakeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // 🚀 THE THEME ENGINE
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  }, [theme]);

  const fetchWallet = useCallback(async (id: number) => {
    setWalletLoading(true);
    try {
      const res = await fetch(`/api/bingo/wallet?tgId=${id}&t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) setWallet(await res.json());
    } catch { /* silent */ } finally { setWalletLoading(false); }
  }, []);

  useEffect(() => {
    if (tgId) { recoverSession(tgId); fetchWallet(tgId); }
  }, [tgId, recoverSession, fetchWallet]);

  useEffect(() => {
    if (screen === 'lobby') fetchRooms();
  }, [screen, fetchRooms]);

  useEffect(() => {
    const fetchHistory = async () => {
      if (!tgId) return;
      setLoadingLogs(true);
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
        const { data } = await supabase.from('bingo_cards').select('room_id, created_at, bingo_rooms ( entry_fee )').eq('tg_id', tgId).order('created_at', { ascending: false }).limit(15);
        if (data) {
          setLogs(data.map((entry: any) => ({
            id: entry.room_id.substring(0, 8).toUpperCase(),
            stake: entry.bingo_rooms?.entry_fee || 10,
            date: new Date(entry.created_at).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          })));
        }
      } catch (err) { console.error(err); } finally { setLoadingLogs(false); }
    };
    if (tab === 'logs') fetchHistory();
  }, [tab, tgId]);

  const handleJoinStake = async (opt: typeof STAKE_OPTIONS[0]) => {
    if (!tgId) return setError('Telegram ID not found.');
    setLoadingStakeId(opt.amount.toString()); setError(null);
    try {
      await useBingoStore.getState().joinStakeRoom(tgId, opt.amount, opt.players);
      try { if (isTelegram && haptic && typeof haptic.impact === 'function') haptic.impact('medium'); } catch(e){}
    } catch (e: any) {
      setError(e.message || 'Failed to join room.');
      try { if (isTelegram && haptic && typeof haptic.notification === 'function') haptic.notification('error'); } catch(e){}
    } finally { setLoadingStakeId(null); }
  };

  if (!isTelegram && !tgId) {
    return (
      <div className={`min-h-screen bg-[#F0FDF4] dark:bg-[#042014] flex items-center justify-center p-6 safe-area ${theme === 'dark' ? 'dark' : ''}`}>
        <div className="text-center">
          <div className="text-5xl mb-4">🎱</div>
          <h2 className="text-[#022C22] dark:text-white text-xl font-bold mb-2">CHELA Bingo</h2>
          <p className="text-[#064E3B]/60 dark:text-white/60 text-sm">Open this app from the Telegram bot to play.</p>
        </div>
      </div>
    );
  }

  if (isRecovering && tgId) {
    return (
      <div className={`min-h-screen bg-[#F0FDF4] dark:bg-[#042014] flex flex-col items-center justify-center safe-area ${theme === 'dark' ? 'dark' : ''}`}>
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-emerald-500 mt-4 font-mono font-bold tracking-widest animate-pulse">RECOVERING SESSION...</p>
      </div>
    );
  }

  if (screen === 'game') return <BingoGameBoard tgId={tgId!} />;
  if (screen === 'card-select') return <BingoCardSelection tgId={tgId!} />;

  const mockTopPlayers = [
    { id: "USER_9942", played: 800, won: "15,000 ETB" }, { id: "USER_8123", played: 742, won: "13,200 ETB" },
    { id: "USER_7741", played: 690, won: "11,500 ETB" }, { id: "USER_3392", played: 520, won: "9,000 ETB" },
    { id: "USER_1024", played: 480, won: "7,500 ETB" },
  ];

  return (
    <div className={`w-full h-[100dvh] bg-[#F0FDF4] dark:bg-[#02120b] text-[#022C22] dark:text-white flex flex-col font-sans relative overflow-hidden transition-colors duration-500 ${theme === 'dark' ? 'dark' : ''}`}>
      
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-20%] w-96 h-96 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[20%] right-[-20%] w-96 h-96 bg-yellow-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative flex items-center justify-between px-4 pt-4 pb-2 z-10">
        <div className="flex items-center gap-2 z-10">
          <motion.button whileTap={{ scale: 0.85 }} onClick={() => { try { if (isTelegram && haptic && typeof haptic.selection === 'function') haptic.selection(); } catch(e){} fetchRooms(); fetchWallet(tgId!); }}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-[#DCFCE7] dark:bg-white/5 border border-[#22C55E]/30 dark:border-white/10 text-[#064E3B] dark:text-white/60 hover:bg-[#bbf7d0] dark:hover:bg-white/15 dark:hover:text-white transition-all shadow-sm">
            <motion.div animate={{ rotate: loadingRooms || walletLoading ? 360 : 0 }} transition={{ repeat: loadingRooms || walletLoading ? Infinity : 0, duration: 1, ease: "linear" }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </motion.div>
          </motion.button>
          
          <motion.button whileTap={{ scale: 0.85 }} onClick={() => { try { if (isTelegram && haptic && typeof haptic.selection === 'function') haptic.selection(); } catch(e){} toggleTheme(); }}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-[#DCFCE7] dark:bg-white/5 border border-[#22C55E]/30 dark:border-white/10 text-[#064E3B] dark:text-white/60 hover:bg-[#bbf7d0] dark:hover:bg-white/15 dark:hover:text-white transition-all shadow-sm">
            <AnimatePresence mode="wait">
              <motion.span key={theme} initial={{ opacity: 0, rotate: -90, scale: 0.5 }} animate={{ opacity: 1, rotate: 0, scale: 1 }} exit={{ opacity: 0, rotate: 90, scale: 0.5 }} transition={{ duration: 0.2 }} className="text-lg">
                {theme === 'dark' ? '☀️' : '🌙'}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          <span className="text-xl">🎱</span>
          <span className="font-extrabold text-base tracking-widest uppercase">CHELA</span>
        </div>
        <div className="w-[88px] h-10 z-10" />
      </div>

      <header className="shrink-0 px-4 pb-4 z-10">
        <div className="bg-white dark:bg-[#062416] border border-[#22C55E]/30 dark:border-green-500/30 rounded-2xl p-4 flex justify-between items-center shadow-sm dark:shadow-[0_4px_20px_rgba(34,197,94,0.15)] transition-colors">
          <span className="text-[#064E3B]/70 dark:text-white/60 font-medium text-sm">Balance</span>
          <span className="text-green-500 dark:text-green-400 font-black text-xl tracking-tight">
            {walletLoading ? '…' : (wallet?.wallet !== undefined && wallet?.wallet !== null) ? `${Number(wallet.wallet).toFixed(2)} ETB` : '0.00 ETB'}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-24 z-10 scrollbar-hide">
        <AnimatePresence mode="wait">
          {screen === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex-1 flex flex-col">
              
              {tab === 'home' && (
                <motion.div key="home-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full gap-6 mt-4">
                  <div className="absolute top-20 left-6 text-3xl animate-bounce" style={{ animationDelay: '0s' }}>💰</div>
                  <div className="absolute top-32 right-6 text-2xl animate-bounce" style={{ animationDelay: '0.5s' }}>💎</div>
                  <div className="absolute top-48 left-10 text-2xl animate-bounce" style={{ animationDelay: '1s' }}>🎲</div>

                  <div className="relative w-36 h-36 flex items-center justify-center mb-6 mt-6">
                    <div className="absolute -top-2 left-0 w-16 h-16 bg-gradient-to-br from-red-400 to-red-700 rounded-full border-2 border-white/40 dark:border-white/20 shadow-[0_5px_15px_rgba(220,38,38,0.3)] dark:shadow-[0_0_15px_rgba(220,38,38,0.6)] flex items-center justify-center z-10">
                      <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-red-600 font-black text-xl">B</span></div>
                    </div>
                    <div className="absolute top-4 -right-2 w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-700 rounded-full border-2 border-white/40 dark:border-white/20 shadow-[0_5px_15px_rgba(37,99,235,0.3)] dark:shadow-[0_0_15px_rgba(37,99,235,0.6)] flex items-center justify-center z-20">
                       <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-blue-600 font-black text-sm">7</span></div>
                    </div>
                    <div className="absolute bottom-0 left-6 w-20 h-20 bg-gradient-to-br from-green-400 to-green-700 rounded-full border-2 border-white/40 dark:border-white/20 shadow-[0_5px_20px_rgba(22,163,74,0.4)] dark:shadow-[0_0_20px_rgba(22,163,74,0.8)] flex items-center justify-center z-30">
                       <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-green-600 font-black text-2xl">24</span></div>
                    </div>
                    <div className="absolute -bottom-2 right-1 w-16 h-16 bg-gradient-to-br from-yellow-300 to-yellow-600 rounded-full border-2 border-white/40 dark:border-white/20 shadow-[0_5px_15px_rgba(202,138,4,0.3)] dark:shadow-[0_0_15px_rgba(202,138,4,0.6)] flex items-center justify-center z-20">
                       <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-yellow-600 font-black text-lg">60</span></div>
                    </div>
                  </div>
                  
                  <h1 className="text-4xl font-black tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.1)] dark:drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] text-center">CHELA Bingo</h1>
                  <p className="text-green-600 dark:text-green-400/80 text-sm font-bold tracking-widest uppercase mt-1 mb-8 text-center">100-Player Massive Multiplayer</p>

                  <button onClick={() => useBingoStore.setState({ screen: 'select' })} className="w-full relative group transition-transform active:scale-95">
                    <div className="absolute -inset-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-2xl blur opacity-40 dark:opacity-70 transition duration-300"></div>
                    <div className="relative w-full py-5 bg-gradient-to-b from-[#22c55e] to-[#16a34a] dark:from-[#115e3b] dark:to-[#0a4a2e] border border-green-300 dark:border-green-400/50 rounded-2xl flex items-center justify-center gap-3 shadow-[inset_0_2px_10px_rgba(255,255,255,0.4)] dark:shadow-[inset_0_2px_10px_rgba(255,255,255,0.2)]">
                      <span className="text-2xl">🎮</span>
                      <span className="text-2xl font-black text-white tracking-wide shadow-black drop-shadow-md">Play Now</span>
                    </div>
                  </button>

                  <div className="mt-6 text-center">
                    <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 to-orange-500 dark:from-yellow-300 dark:to-yellow-600 drop-shadow-sm uppercase tracking-wider">WIN UP TO 8000 ETB!</h2>
                    <p className="text-[#064E3B]/60 dark:text-white/50 text-xs mt-2 font-medium">Servers are live. Join a room to start winning!</p>
                  </div>
                </motion.div>
              )}

              {tab === 'logs' && (
                <motion.div key="logs-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3 pt-4">
                  <h2 className="text-xl font-black mb-2">My Game History</h2>
                  {loadingLogs ? (
                    <div className="text-center py-10 text-green-500 dark:text-green-400 animate-pulse">Syncing...</div>
                  ) : logs.length === 0 ? (
                    <div className="text-center py-10 text-[#064E3B]/60 dark:text-white/40 bg-white dark:bg-[#062416] rounded-xl border border-[#22C55E]/30 dark:border-white/5 shadow-sm dark:shadow-none">No games played yet.</div>
                  ) : (
                    logs.map((log, idx) => (
                      <div key={idx} className="bg-white dark:bg-[#062416] border border-[#22C55E]/30 dark:border-white/5 rounded-xl p-4 flex justify-between items-center shadow-sm dark:shadow-none transition-colors">
                        <div>
                          <div className="text-sm font-bold mb-1">{log.id}</div>
                          <div className="text-xs text-[#064E3B]/60 dark:text-white/40">{log.date}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-[#064E3B]/50 dark:text-white/50 uppercase tracking-wider mb-1">Stake</div>
                          <div className="text-sm font-black text-green-600 dark:text-green-400">{log.stake} ETB</div>
                        </div>
                      </div>
                    ))
                  )}
                </motion.div>
              )}

              {tab === 'top' && (
                <motion.div key="top-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2 pt-4">
                  <div className="flex justify-between items-end mb-4 px-1">
                    <h2 className="text-xl font-black">Top High Rollers</h2>
                  </div>
                  {mockTopPlayers.map((player, idx) => (
                    <div key={idx} className="flex items-center p-3 rounded-xl border bg-white dark:bg-[#062416] border-[#22C55E]/30 dark:border-white/5 shadow-sm dark:shadow-none transition-colors">
                      <div className="w-8 flex justify-center text-sm font-bold text-[#064E3B]/50 dark:text-white/30">{idx + 1}</div>
                      <div className="flex-1 font-bold text-sm">{player.id}</div>
                      <div className="w-28 text-right text-sm font-black text-green-600 dark:text-green-400">{player.won}</div>
                    </div>
                  ))}
                </motion.div>
              )}

              {tab === 'profile' && (
                <motion.div key="profile-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center pt-8">
                  <div className="w-full bg-white dark:bg-[#062416] border border-[#22C55E]/30 dark:border-green-500/30 rounded-3xl p-6 shadow-md dark:shadow-[0_10px_30px_rgba(34,197,94,0.1)] text-center transition-colors">
                    <div className="w-24 h-24 bg-[#F0FDF4] dark:bg-[#0a4a2e] border border-[#22C55E]/30 dark:border-none rounded-full mx-auto mb-4 flex items-center justify-center text-4xl">👤</div>
                    <h3 className="text-2xl font-black mb-6">{wallet?.name || 'Player'}</h3>
                    <div className="bg-[#F0FDF4] dark:bg-[#02120b] border border-[#22C55E]/30 dark:border-none rounded-2xl p-4 mb-6">
                      <div className="text-xs text-[#064E3B]/60 dark:text-white/50 uppercase tracking-widest mb-1 font-bold">Balance</div>
                      <div className="text-3xl font-black text-green-600 dark:text-green-400">{((wallet?.wallet !== undefined && wallet?.wallet !== null) ? Number(wallet.wallet).toFixed(2) : '0.00')} ETB</div>
                    </div>
                    <div className="text-xs text-[#064E3B]/60 dark:text-white/40 font-medium">Manage funds through the Telegram Bot.</div>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {screen === 'select' && (
            <motion.div key="select" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="flex-1 flex flex-col relative">
              
              {/* 🚀 THE FIX: Seamless Fade Sticky Header */}
              <div className="sticky top-0 z-20 pt-3 pb-8 -mb-5 bg-gradient-to-b from-[#F0FDF4] from-60% to-transparent dark:from-[#02120b] dark:from-60% dark:to-transparent transition-colors pointer-events-none">
                <div className="flex items-center justify-between pointer-events-auto px-1">
                  <motion.button whileTap={{ scale: 0.95 }} onClick={() => useBingoStore.setState({ screen: 'lobby' })} className="flex items-center gap-1 text-[#064E3B]/70 dark:text-white/60 hover:text-black dark:hover:text-white text-sm font-bold">← Back</motion.button>
                  <span className="font-bold text-lg drop-shadow-md">Choose Room</span>
                  <div className="w-8 h-8" />
                </div>
              </div>

              {error && <div className="mb-3 mt-5 bg-red-100 dark:bg-red-500/20 border border-red-300 dark:border-red-500/40 rounded-xl px-3 py-2 text-red-600 dark:text-red-300 text-sm font-bold relative z-10">{error}</div>}

              <div className="space-y-4 pb-24 pt-2 overflow-y-auto max-h-[80vh] relative z-10">
                {STAKE_OPTIONS.map((opt, index) => {
                  const isThisLoading = loadingStakeId === opt.amount.toString();
                  return (
                    <motion.button key={opt.amount} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1, duration: 0.3 }} whileTap={{ scale: 0.96 }} disabled={loadingStakeId !== null} onClick={() => handleJoinStake(opt)}
                      className="w-full bg-white dark:bg-gradient-to-br dark:from-[#0a4a2e] dark:to-[#042b1a] border border-[#22C55E]/30 dark:border-white/10 shadow-sm dark:shadow-[0_8px_32px_rgba(0,0,0,0.3)] relative rounded-2xl p-5 text-left disabled:opacity-50 hover:border-[#22C55E]/60 dark:hover:border-green-500/30 transition-colors"
                    >
                      <div className="relative z-10 flex items-center justify-between">
                        <div>
                          <p className="font-black text-lg">{opt.label} Room</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                            <p className="text-[#064E3B]/70 dark:text-white/60 text-xs font-bold">Max {opt.players} players</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-yellow-600 dark:text-yellow-400 font-black text-[10px] uppercase tracking-widest mb-0.5">{isThisLoading ? '⌛' : 'UP TO'}</p>
                          {!isThisLoading && <p className="text-green-600 dark:text-green-400 font-black text-lg">🏆 {opt.maxPrize} ETB</p>}
                        </div>
                      </div>
                      {isThisLoading && <div className="absolute inset-0 bg-[#F0FDF4]/90 dark:bg-[#0a4a2e]/90 flex items-center justify-center z-20 rounded-2xl"><div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div></div>}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {screen === 'lobby' && (
        <nav className="shrink-0 absolute bottom-0 w-full bg-white dark:bg-[#03150c] border-t border-[#22C55E]/20 dark:border-white/10 pb-safe pt-2 px-6 z-50 transition-colors duration-500 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] dark:shadow-none">
          <div className="flex justify-between items-center max-w-md mx-auto h-16">
            <button onClick={() => setTab('home')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'home' ? 'text-green-600 dark:text-green-400' : 'text-[#064E3B]/50 dark:text-white/40'}`}>
              <span className={`text-2xl ${tab === 'home' ? 'scale-110 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)] dark:drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]' : ''} transition-transform`}>🏠</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Home</span>
            </button>
            <button onClick={() => setTab('logs')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'logs' ? 'text-green-600 dark:text-green-400' : 'text-[#064E3B]/50 dark:text-white/40'}`}>
              <span className={`text-2xl ${tab === 'logs' ? 'scale-110' : ''} transition-transform`}>📋</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Logs</span>
            </button>
            <button onClick={() => setTab('top')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'top' ? 'text-green-600 dark:text-green-400' : 'text-[#064E3B]/50 dark:text-white/40'}`}>
              <span className={`text-2xl ${tab === 'top' ? 'scale-110 drop-shadow-[0_0_8px_rgba(250,204,21,0.4)] dark:drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : ''} transition-transform`}>🏆</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Top</span>
            </button>
            <button onClick={() => setTab('profile')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'profile' ? 'text-green-600 dark:text-green-400' : 'text-[#064E3B]/50 dark:text-white/40'}`}>
              <span className={`text-2xl ${tab === 'profile' ? 'scale-110' : ''} transition-transform`}>👤</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Profile</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}