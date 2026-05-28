'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { useTelegram } from '@/lib/useTelegram';
import BingoGameBoard from './GameBoard';
import BingoCardSelection from './CardSelection';

interface WalletData {
  name: string;
  wallet: number; 
  transactions: Array<any>;
  gameHistory: Array<any>;
}

// 🚀 Your exact 100-Player Massive Multiplayer Config
const STAKE_OPTIONS = [
  { label: '10 ETB', amount: 10, players: 100, maxPrize: 800 },
  { label: '25 ETB', amount: 25, players: 100, maxPrize: 2000 },
  { label: '50 ETB', amount: 50, players: 100, maxPrize: 4000 },
  { label: '100 ETB', amount: 100, players: 100, maxPrize: 8000 },
];

export default function BingoPage() {
  const { tgId, isTelegram, haptic } = useTelegram();
  const { screen, fetchRooms, isRecovering, recoverSession, loadingRooms } = useBingoStore();

  const [tab, setTab] = useState<'home' | 'logs' | 'top' | 'profile'>('home');
  const [loadingStakeId, setLoadingStakeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);

  // Real History State for the Logs Tab
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

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

  // Fetch Supabase logs only when logs tab is active
  useEffect(() => {
    const fetchHistory = async () => {
      if (!tgId) return;
      setLoadingLogs(true);
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );

        const { data } = await supabase
          .from('bingo_cards')
          .select('room_id, created_at, bingo_rooms ( entry_fee )')
          .eq('tg_id', tgId)
          .order('created_at', { ascending: false })
          .limit(15);

        if (data) {
          const formattedLogs = data.map((entry: any) => ({
            id: entry.room_id.substring(0, 8).toUpperCase(),
            stake: entry.bingo_rooms?.entry_fee || 10,
            date: new Date(entry.created_at).toLocaleDateString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          }));
          setLogs(formattedLogs);
        }
      } catch (err) {
        console.error("Failed to sync history:", err);
      } finally {
        setLoadingLogs(false);
      }
    };

    if (tab === 'logs') fetchHistory();
  }, [tab, tgId]);

  // Your exact Join logic
  const handleJoinStake = async (opt: typeof STAKE_OPTIONS[0]) => {
    if (!tgId) {
      setError('Telegram ID not found.');
      return;
    }
    
    setLoadingStakeId(opt.amount.toString());
    setError(null);
    
    try {
      await useBingoStore.getState().joinStakeRoom(tgId, opt.amount, opt.players);
      if (isTelegram) haptic.impact('medium');
    } catch (e: any) {
      setError(e.message || 'Failed to join room. Check your balance.');
      if (isTelegram) haptic.notification('error');
    } finally {
      setLoadingStakeId(null);
    }
  };

  // Safe checks
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

  // ZUSTAND SPA ROUTING
  if (screen === 'game') return <BingoGameBoard tgId={tgId!} />;
  if (screen === 'card-select') return <BingoCardSelection tgId={tgId!} />;

  // Realistic Top Players Mockup
  const mockTopPlayers = [
    { id: "USER_9942", played: 800, won: "15,000 ETB" },
    { id: "USER_8123", played: 742, won: "13,200 ETB" },
    { id: "USER_7741", played: 690, won: "11,500 ETB" },
    { id: "USER_3392", played: 520, won: "9,000 ETB" },
    { id: "USER_1024", played: 480, won: "7,500 ETB" },
  ];

  return (
    <div className="w-full h-[100dvh] bg-[#02120b] text-white flex flex-col font-sans relative overflow-hidden">
      
      {/* Background Casino Glows */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-20%] w-96 h-96 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[20%] right-[-20%] w-96 h-96 bg-yellow-500/10 rounded-full blur-3xl"></div>
      </div>

      {/* TOP NAVIGATION BAR (New Refresh & Logo Layout) */}
      <div className="relative flex items-center justify-between px-4 pt-4 pb-2 z-10">
        
        {/* Quick In-App Refresh Button */}
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={() => {
            if (isTelegram) haptic.selection();
            fetchRooms(); 
            fetchWallet(tgId!); 
          }}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/15 transition-all shadow-sm z-10"
        >
          <motion.div
            animate={{ rotate: loadingRooms || walletLoading ? 360 : 0 }}
            transition={{ repeat: loadingRooms || walletLoading ? Infinity : 0, duration: 1, ease: "linear" }}
          >
            {/* Elegant minimal SVG refresh icon */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </motion.div>
        </motion.button>

        {/* Centered App Logo */}
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          <span className="text-xl">🎱</span>
          <span className="text-white font-extrabold text-base tracking-widest uppercase">CHELA</span>
        </div>

        {/* Invisible spacer to maintain perfect flex centering */}
        <div className="w-10 h-10 z-10" />
      </div>

      {/* HEADER: Balance Tracker */}
      <header className="shrink-0 px-4 pb-4 z-10">
        <div className="bg-[#062416] border border-green-500/30 rounded-2xl p-4 flex justify-between items-center shadow-[0_4px_20px_rgba(34,197,94,0.15)]">
          <span className="text-white/60 font-medium text-sm">Balance</span>
          <span className="text-green-400 font-black text-xl tracking-tight">
            {walletLoading ? '…' : (wallet?.wallet !== undefined && wallet?.wallet !== null) ? `${Number(wallet.wallet).toFixed(2)} ETB` : '0.00 ETB'}
          </span>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto px-4 pb-24 z-10 scrollbar-hide">
        <AnimatePresence mode="wait">
          
          {/* ================= ZUSTAND SCREEN: LOBBY (TABS) ================= */}
          {screen === 'lobby' && (
            <motion.div key="lobby" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="flex-1 flex flex-col">
              
              {/* === HOME TAB === */}
              {tab === 'home' && (
                <motion.div key="home-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full gap-6 mt-4">
                  
                  {/* Floating Emojis */}
                  <div className="absolute top-20 left-6 text-3xl animate-bounce" style={{ animationDelay: '0s' }}>💰</div>
                  <div className="absolute top-32 right-6 text-2xl animate-bounce" style={{ animationDelay: '0.5s' }}>💎</div>
                  <div className="absolute top-48 left-10 text-2xl animate-bounce" style={{ animationDelay: '1s' }}>🎲</div>

                  {/* FIESTA BALLS */}
                  <div className="relative w-36 h-36 flex items-center justify-center mb-6 mt-6">
                    <div className="absolute -top-2 left-0 w-16 h-16 bg-gradient-to-br from-red-400 to-red-700 rounded-full border-2 border-white/20 shadow-[0_0_15px_rgba(220,38,38,0.6)] flex items-center justify-center z-10">
                      <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-red-600 font-black text-xl">B</span></div>
                    </div>
                    <div className="absolute top-4 -right-2 w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-700 rounded-full border-2 border-white/20 shadow-[0_0_15px_rgba(37,99,235,0.6)] flex items-center justify-center z-20">
                       <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-blue-600 font-black text-sm">7</span></div>
                    </div>
                    <div className="absolute bottom-0 left-6 w-20 h-20 bg-gradient-to-br from-green-400 to-green-700 rounded-full border-2 border-white/20 shadow-[0_0_20px_rgba(22,163,74,0.8)] flex items-center justify-center z-30">
                       <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-green-600 font-black text-2xl">24</span></div>
                    </div>
                    <div className="absolute -bottom-2 right-1 w-16 h-16 bg-gradient-to-br from-yellow-300 to-yellow-600 rounded-full border-2 border-white/20 shadow-[0_0_15px_rgba(202,138,4,0.6)] flex items-center justify-center z-20">
                       <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-yellow-600 font-black text-lg">60</span></div>
                    </div>
                  </div>
                  
                  <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] text-center">CHELA Bingo</h1>
                  <p className="text-green-400/80 text-sm font-medium tracking-widest uppercase mt-1 mb-8 text-center">100-Player Massive Multiplayer</p>

                  {/* 🔥 THE MAGIC PLAY BUTTON 🔥 */}
                  <button 
                    onClick={() => useBingoStore.setState({ screen: 'select' })} 
                    className="w-full relative group transition-transform active:scale-95"
                  >
                    <div className="absolute -inset-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-2xl blur opacity-70 transition duration-300"></div>
                    <div className="relative w-full py-5 bg-gradient-to-b from-[#115e3b] to-[#0a4a2e] border border-green-400/50 rounded-2xl flex items-center justify-center gap-3 shadow-[inset_0_2px_10px_rgba(255,255,255,0.2)]">
                      <span className="text-2xl">🎮</span>
                      <span className="text-2xl font-black text-white tracking-wide shadow-black drop-shadow-md">Play Now</span>
                    </div>
                  </button>

                  <div className="mt-6 text-center">
                    <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-yellow-600 drop-shadow-sm uppercase tracking-wider">
                      WIN UP TO 8000 ETB!
                    </h2>
                    <p className="text-white/50 text-xs mt-2">Servers are live. Join a room to start winning!</p>
                  </div>
                </motion.div>
              )}

              {/* === LOGS TAB === */}
              {tab === 'logs' && (
                <motion.div key="logs-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3 pt-4">
                  <h2 className="text-xl font-black text-white mb-2">My Game History</h2>
                  {loadingLogs ? (
                    <div className="text-center py-10 text-green-400 animate-pulse">Syncing...</div>
                  ) : logs.length === 0 ? (
                    <div className="text-center py-10 text-white/40 bg-[#062416] rounded-xl border border-white/5">No games played yet.</div>
                  ) : (
                    logs.map((log, idx) => (
                      <div key={idx} className="bg-[#062416] border border-white/5 rounded-xl p-4 flex justify-between items-center">
                        <div>
                          <div className="text-sm font-bold text-white mb-1">Room: {log.id}</div>
                          <div className="text-xs text-white/40">{log.date}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-white/50 uppercase tracking-wider mb-1">Stake</div>
                          <div className="text-sm font-black text-green-400">{log.stake} ETB</div>
                        </div>
                      </div>
                    ))
                  )}
                </motion.div>
              )}

              {/* === TOP TAB === */}
              {tab === 'top' && (
                <motion.div key="top-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-2 pt-4">
                  <div className="flex justify-between items-end mb-4 px-1">
                    <h2 className="text-xl font-black text-white">Top High Rollers</h2>
                  </div>
                  {mockTopPlayers.map((player, idx) => (
                    <div key={idx} className="flex items-center p-3 rounded-xl border bg-[#062416] border-white/5">
                      <div className="w-8 flex justify-center text-sm font-bold text-white/30">{idx + 1}</div>
                      <div className="flex-1 font-bold text-sm text-white/90">{player.id}</div>
                      <div className="w-28 text-right text-sm font-black text-green-400">{player.won}</div>
                    </div>
                  ))}
                </motion.div>
              )}

              {/* === PROFILE TAB === */}
              {tab === 'profile' && (
                <motion.div key="profile-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center pt-8">
                  <div className="w-full bg-[#062416] border border-green-500/30 rounded-3xl p-6 shadow-[0_10px_30px_rgba(34,197,94,0.1)] text-center">
                    <div className="w-24 h-24 bg-[#0a4a2e] rounded-full mx-auto mb-4 flex items-center justify-center text-4xl">👤</div>
                    <h3 className="text-2xl font-black text-white mb-6">{wallet?.name || 'Player'}</h3>
                    <div className="bg-[#02120b] rounded-2xl p-4 mb-6">
                      <div className="text-xs text-white/50 uppercase tracking-widest mb-1">Balance</div>
                      <div className="text-3xl font-black text-green-400">{((wallet?.wallet !== undefined && wallet?.wallet !== null) ? Number(wallet.wallet).toFixed(2) : '0.00')} ETB</div>
                    </div>
                    <div className="text-xs text-white/40">Manage funds through the Telegram Bot.</div>
                  </div>
                </motion.div>
              )}

            </motion.div>
          )}

          {/* ================= ZUSTAND SCREEN: ROOM SELECTION ================= */}
          {screen === 'select' && (
            <motion.div key="select" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="flex-1 flex flex-col">
              <div className="flex items-center justify-between py-3 sticky top-safe z-10">
                <motion.button whileTap={{ scale: 0.95 }} onClick={() => useBingoStore.setState({ screen: 'lobby' })} className="flex items-center gap-1 text-white/60 text-sm font-bold">← Back</motion.button>
                <span className="text-white font-bold text-lg">Choose Room</span>
                <div className="w-8 h-8" />
              </div>

              {error && <div className="mb-3 bg-red-500/20 border border-red-500/40 rounded-xl px-3 py-2 text-red-300 text-sm">{error}</div>}

              <div className="space-y-4 pb-24 overflow-y-auto max-h-[80vh]">
                {STAKE_OPTIONS.map((opt, index) => {
                  const isThisLoading = loadingStakeId === opt.amount.toString();
                  return (
                    <motion.button
                      key={opt.amount}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1, duration: 0.3 }}
                      whileTap={{ scale: 0.96 }}
                      disabled={loadingStakeId !== null}
                      onClick={() => handleJoinStake(opt)}
                      className="w-full bg-gradient-to-br from-[#0a4a2e] to-[#042b1a] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] relative rounded-2xl p-5 text-left disabled:opacity-50 hover:border-green-500/30"
                    >
                      <div className="relative z-10 flex items-center justify-between">
                        <div>
                          <p className="text-white font-black text-lg">{opt.label} Room</p>
                          <div className="flex items-center gap-1.5 mt-1">
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
                      {isThisLoading && <div className="absolute inset-0 bg-[#0a4a2e]/90 flex items-center justify-center z-20"><div className="w-6 h-6 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div></div>}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* BOTTOM NAVIGATION BAR */}
      {screen === 'lobby' && (
        <nav className="shrink-0 absolute bottom-0 w-full bg-[#03150c] border-t border-white/10 pb-safe pt-2 px-6 z-50">
          <div className="flex justify-between items-center max-w-md mx-auto h-16">
            <button onClick={() => setTab('home')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'home' ? 'text-green-400' : 'text-white/40'}`}>
              <span className={`text-2xl ${tab === 'home' ? 'scale-110 drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]' : ''} transition-transform`}>🏠</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Home</span>
            </button>
            <button onClick={() => setTab('logs')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'logs' ? 'text-green-400' : 'text-white/40'}`}>
              <span className={`text-2xl ${tab === 'logs' ? 'scale-110' : ''} transition-transform`}>📋</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Logs</span>
            </button>
            <button onClick={() => setTab('top')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'top' ? 'text-green-400' : 'text-white/40'}`}>
              <span className={`text-2xl ${tab === 'top' ? 'scale-110 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : ''} transition-transform`}>🏆</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Top</span>
            </button>
            <button onClick={() => setTab('profile')} className={`flex flex-col items-center gap-1 transition-colors ${tab === 'profile' ? 'text-green-400' : 'text-white/40'}`}>
              <span className={`text-2xl ${tab === 'profile' ? 'scale-110' : ''} transition-transform`}>👤</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Profile</span>
            </button>
          </div>
        </nav>
      )}
      
    </div>
  );
}