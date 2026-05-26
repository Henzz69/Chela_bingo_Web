'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function BingoLobby() {
  const [activeTab, setActiveTab] = useState<'home' | 'logs' | 'top' | 'profile'>('home');
  const [tgId, setTgId] = useState<number | null>(null);
  
  // Real History State
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Placeholder balance (should sync with your store/bot)
  const balance = 324.00;

  useEffect(() => {
    // 1. Grab User ID from Telegram
    let currentTgId = 5681654051; // Fallback to Admin ID for testing
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id) {
      currentTgId = (window as any).Telegram.WebApp.initDataUnsafe.user.id;
    }
    setTgId(currentTgId);

    // 2. Fetch REAL History from Supabase when Logs tab is opened
    const fetchHistory = async () => {
      setLoadingLogs(true);
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );

        // Fetch user's cards and the associated room's entry fee
        const { data, error } = await supabase
          .from('bingo_cards')
          .select(`
            room_id,
            created_at,
            bingo_rooms ( entry_fee )
          `)
          .eq('tg_id', currentTgId)
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

    if (activeTab === 'logs') {
      fetchHistory();
    }
  }, [activeTab]);

  // Realistic Top Players Mockup
  const mockTopPlayers = [
    { id: "USER_9942", played: 800, won: "15,000 ETB" },
    { id: "USER_8123", played: 742, won: "13,200 ETB" },
    { id: "USER_7741", played: 690, won: "11,500 ETB" },
    { id: "USER_3392", played: 520, won: "9,000 ETB" },
    { id: "USER_1024", played: 480, won: "7,500 ETB" },
    { id: "USER_5581", played: 410, won: "6,800 ETB" },
    { id: "USER_9921", played: 380, won: "5,400 ETB" },
    { id: "USER_4412", played: 310, won: "4,100 ETB" },
    { id: "USER_8829", played: 290, won: "3,500 ETB" },
    { id: "USER_1102", played: 210, won: "2,000 ETB" },
  ];

  return (
    <div className="w-full h-[100dvh] bg-[#02120b] text-white flex flex-col font-sans relative overflow-hidden">
      
      {/* Background Casino Glows */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-20%] w-96 h-96 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[20%] right-[-20%] w-96 h-96 bg-yellow-500/10 rounded-full blur-3xl"></div>
      </div>

      {/* HEADER: Balance Tracker */}
      <header className="shrink-0 p-4 z-10">
        <div className="bg-[#062416] border border-green-500/30 rounded-2xl p-4 flex justify-between items-center shadow-[0_4px_20px_rgba(34,197,94,0.15)]">
          <span className="text-white/60 font-medium text-sm">Balance</span>
          <span className="text-green-400 font-black text-xl tracking-tight">{balance.toFixed(2)} ETB</span>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto px-4 pb-24 z-10 scrollbar-hide">
        <AnimatePresence mode="wait">
          
          {/* ================= HOME TAB ================= */}
          {activeTab === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col items-center justify-center h-full gap-6">
              
              <div className="relative w-full max-w-sm flex flex-col items-center mt-4">
                
                {/* Floating Emojis (Universally supported) */}
                <div className="absolute -top-4 -left-2 text-3xl animate-bounce" style={{ animationDelay: '0s' }}>💰</div>
                <div className="absolute top-10 -right-2 text-2xl animate-bounce" style={{ animationDelay: '0.5s' }}>💎</div>
                <div className="absolute -bottom-4 left-2 text-2xl animate-bounce" style={{ animationDelay: '1s' }}>🎲</div>

                {/* THE FIESTA BALLS CLUSTER */}
                <div className="relative w-36 h-36 flex items-center justify-center mb-6">
                  {/* Red Ball */}
                  <div className="absolute -top-2 left-0 w-16 h-16 bg-gradient-to-br from-red-400 to-red-700 rounded-full border-2 border-white/20 shadow-[0_0_15px_rgba(220,38,38,0.6)] flex items-center justify-center z-10">
                    <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-red-600 font-black text-xl">B</span></div>
                  </div>
                  {/* Blue Ball */}
                  <div className="absolute top-4 -right-2 w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-700 rounded-full border-2 border-white/20 shadow-[0_0_15px_rgba(37,99,235,0.6)] flex items-center justify-center z-20">
                     <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-blue-600 font-black text-sm">7</span></div>
                  </div>
                  {/* Green Ball (Center) */}
                  <div className="absolute bottom-0 left-6 w-20 h-20 bg-gradient-to-br from-green-400 to-green-700 rounded-full border-2 border-white/20 shadow-[0_0_20px_rgba(22,163,74,0.8)] flex items-center justify-center z-30">
                     <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-green-600 font-black text-2xl">24</span></div>
                  </div>
                  {/* Yellow Ball */}
                  <div className="absolute -bottom-2 right-1 w-16 h-16 bg-gradient-to-br from-yellow-300 to-yellow-600 rounded-full border-2 border-white/20 shadow-[0_0_15px_rgba(202,138,4,0.6)] flex items-center justify-center z-20">
                     <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-inner"><span className="text-yellow-600 font-black text-lg">60</span></div>
                  </div>
                </div>
                
                <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">CHELA Bingo</h1>
                <p className="text-green-400/80 text-sm font-medium tracking-widest uppercase mt-1 mb-8">100-Player Massive Multiplayer</p>

                {/* The Big Play Button */}
                <button className="w-full relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-2xl blur opacity-70 transition duration-300"></div>
                  <div className="relative w-full py-5 bg-gradient-to-b from-[#115e3b] to-[#0a4a2e] border border-green-400/50 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-transform shadow-[inset_0_2px_10px_rgba(255,255,255,0.2)]">
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
              </div>
            </motion.div>
          )}

          {/* ================= REAL LOGS TAB ================= */}
          {activeTab === 'logs' && (
            <motion.div key="logs" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-3 pt-4">
              <h2 className="text-xl font-black text-white mb-2">My Game History</h2>
              
              {loadingLogs ? (
                <div className="text-center py-10 text-green-400 animate-pulse">Syncing with server...</div>
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

          {/* ================= TOP TAB ================= */}
          {activeTab === 'top' && (
            <motion.div key="top" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-2 pt-4">
              <div className="flex justify-between items-end mb-4 px-1">
                <h2 className="text-xl font-black text-white">Top High Rollers</h2>
                <span className="text-xs text-yellow-400/80 font-medium">All Time</span>
              </div>
              
              {/* Leaderboard Header Row */}
              <div className="flex text-[10px] text-white/40 uppercase tracking-widest px-4 pb-2 border-b border-white/10 mb-2">
                <div className="w-10">#</div>
                <div className="flex-1">Player</div>
                <div className="w-20 text-right">Played</div>
                <div className="w-28 text-right">Winnings</div>
              </div>

              {/* Leaderboard List */}
              {mockTopPlayers.map((player, idx) => {
                const isFirst = idx === 0;
                const isSecond = idx === 1;
                const isThird = idx === 2;
                
                return (
                  <div key={idx} className={`
                    flex items-center p-3 rounded-xl border
                    ${isFirst ? 'bg-yellow-500/10 border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.1)]' : 
                      isSecond ? 'bg-gray-300/10 border-gray-300/20' : 
                      isThird ? 'bg-orange-700/10 border-orange-700/20' : 
                      'bg-[#062416] border-white/5'}
                  `}>
                    <div className="w-8 flex justify-center">
                      {isFirst ? <span className="text-xl drop-shadow-md">🥇</span> : 
                       isSecond ? <span className="text-xl drop-shadow-md">🥈</span> : 
                       isThird ? <span className="text-xl drop-shadow-md">🥉</span> : 
                       <span className="text-sm font-bold text-white/30">{idx + 1}</span>}
                    </div>
                    <div className={`flex-1 font-bold text-sm ${isFirst ? 'text-yellow-400' : 'text-white/90'}`}>
                      {player.id}
                    </div>
                    <div className="w-16 text-right text-xs font-medium text-white/60">
                      {player.played}
                    </div>
                    <div className="w-28 text-right text-sm font-black text-green-400">
                      {player.won}
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}

          {/* ================= PROFILE TAB ================= */}
          {activeTab === 'profile' && (
            <motion.div key="profile" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center pt-8">
              <div className="w-full bg-[#062416] border border-green-500/30 rounded-3xl p-6 shadow-[0_10px_30px_rgba(34,197,94,0.1)] text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-green-900/40 to-transparent"></div>
                
                <div className="relative w-24 h-24 bg-[#0a4a2e] border-4 border-[#02120b] rounded-full mx-auto mb-4 flex items-center justify-center text-4xl shadow-xl">
                  👤
                </div>
                
                <h3 className="text-2xl font-black text-white mb-1">Player_{tgId || '0000'}</h3>
                <p className="text-white/40 text-sm mb-6 uppercase tracking-widest">Active Member</p>
                
                <div className="bg-[#02120b] rounded-2xl p-4 mb-6 border border-white/5">
                  <div className="text-xs text-white/50 uppercase tracking-widest mb-1">Available Funds</div>
                  <div className="text-3xl font-black text-green-400">{balance.toFixed(2)} ETB</div>
                </div>

                <div className="text-xs text-white/40 px-4">
                  Manage deposits and withdrawals securely through the CHELA Bingo Telegram Bot menu.
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* BOTTOM NAVIGATION BAR */}
      <nav className="shrink-0 absolute bottom-0 w-full bg-[#03150c] border-t border-white/10 pb-safe pt-2 px-6 z-50">
        <div className="flex justify-between items-center max-w-md mx-auto h-16">
          <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'home' ? 'text-green-400' : 'text-white/40'}`}>
            <span className={`text-2xl ${activeTab === 'home' ? 'scale-110 drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]' : ''} transition-transform`}>🏠</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Home</span>
          </button>
          
          <button onClick={() => setActiveTab('logs')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'logs' ? 'text-green-400' : 'text-white/40'}`}>
            <span className={`text-2xl ${activeTab === 'logs' ? 'scale-110' : ''} transition-transform`}>📋</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Logs</span>
          </button>
          
          <button onClick={() => setActiveTab('top')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'top' ? 'text-green-400' : 'text-white/40'}`}>
            <span className={`text-2xl ${activeTab === 'top' ? 'scale-110 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : ''} transition-transform`}>🏆</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Top</span>
          </button>
          
          <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center gap-1 transition-colors ${activeTab === 'profile' ? 'text-green-400' : 'text-white/40'}`}>
            <span className={`text-2xl ${activeTab === 'profile' ? 'scale-110' : ''} transition-transform`}>👤</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Profile</span>
          </button>
        </div>
      </nav>
      
    </div>
  );
}