'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function BingoLobby() {
  const [activeTab, setActiveTab] = useState<'home' | 'logs' | 'top' | 'profile'>('home');
  
  // Placeholder balance (replace with your actual state/store)
  const balance = 324.00;

  // 1. Mock Data for Logs
  const mockLogs = [
    { id: 'RM-A1B2', stake: 10, date: 'Today, 14:20' },
    { id: 'RM-C3D4', stake: 50, date: 'Today, 12:05' },
    { id: 'RM-E5F6', stake: 100, date: 'Yesterday' },
    { id: 'RM-G7H8', stake: 10, date: 'May 24' },
    { id: 'RM-I9J0', stake: 10, date: 'May 24' },
  ];

  // 2. Mock Data for Top Players
  const mockTopPlayers = [
    { id: "USER_9942", played: 8420, won: "850,000 ETB" },
    { id: "USER_8123", played: 7110, won: "620,000 ETB" },
    { id: "USER_7741", played: 6500, won: "475,500 ETB" },
    { id: "USER_3392", played: 5200, won: "390,000 ETB" },
    { id: "USER_1024", played: 4800, won: "250,000 ETB" },
    { id: "USER_5581", played: 4100, won: "180,000 ETB" },
    { id: "USER_9921", played: 3800, won: "145,000 ETB" },
    { id: "USER_4412", played: 3100, won: "110,000 ETB" },
    { id: "USER_8829", played: 2900, won: "95,000 ETB" },
    { id: "USER_1102", played: 2100, won: "60,000 ETB" },
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
              
              {/* Casino Centerpiece */}
              <div className="relative w-full max-w-sm flex flex-col items-center mt-8">
                {/* Floating Emojis for Casino Vibe */}
                <div className="absolute -top-6 -left-4 text-3xl animate-bounce" style={{ animationDelay: '0s' }}>💸</div>
                <div className="absolute top-10 -right-2 text-2xl animate-bounce" style={{ animationDelay: '0.5s' }}>🪙</div>
                <div className="absolute -bottom-4 left-4 text-2xl animate-bounce" style={{ animationDelay: '1s' }}>🎰</div>

                <div className="w-24 h-24 bg-gradient-to-b from-gray-700 to-black rounded-full border-4 border-gray-500 flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.2)] z-10 mb-4">
                  <span className="text-5xl font-black text-white">8</span>
                </div>
                
                <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">CHELA Bingo</h1>
                <p className="text-green-400/80 text-sm font-medium tracking-widest uppercase mt-1 mb-8">100-Player Massive Multiplayer</p>

                {/* The Big Play Button */}
                <button className="w-full relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-2xl blur opacity-70 group-hover:opacity-100 transition duration-300"></div>
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

          {/* ================= LOGS TAB ================= */}
          {activeTab === 'logs' && (
            <motion.div key="logs" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-3 pt-4">
              <h2 className="text-xl font-black text-white mb-2">My Game History</h2>
              {mockLogs.map((log, idx) => (
                <div key={idx} className="bg-[#062416] border border-white/5 rounded-xl p-4 flex justify-between items-center">
                  <div>
                    <div className="text-sm font-bold text-white mb-1">{log.id}</div>
                    <div className="text-xs text-white/40">{log.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/50 uppercase tracking-wider mb-1">Stake</div>
                    <div className="text-sm font-black text-green-400">{log.stake} ETB</div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* ================= TOP TAB ================= */}
          {activeTab === 'top' && (
            <motion.div key="top" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-2 pt-4">
              <div className="flex justify-between items-end mb-4 px-1">
                <h2 className="text-xl font-black text-white">Top High Rollers</h2>
                <span className="text-xs text-yellow-400/80 font-medium">All Time</span>
              </div>
              
              {/* Leaderboard Header */}
              <div className="flex text-[10px] text-white/40 uppercase tracking-widest px-4 pb-2">
                <div className="w-10">#</div>
                <div className="flex-1">Player ID</div>
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
                      {isFirst ? <span className="text-xl">🥇</span> : 
                       isSecond ? <span className="text-xl">🥈</span> : 
                       isThird ? <span className="text-xl">🥉</span> : 
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
            <motion.div key="profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center h-full text-white/50 pt-20">
              <span className="text-4xl mb-4">👤</span>
              <p>Profile Settings Coming Soon</p>
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