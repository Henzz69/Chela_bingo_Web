'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';

export default function BingoLobby() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'home' | 'logs' | 'top' | 'profile'>('home');
  const [tgId, setTgId] = useState<number | null>(null);
  
  // Real History State
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Play Button & Modal State
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  // Placeholder balance
  const balance = 324.00;

  useEffect(() => {
    // 1. Grab User ID from Telegram
    let currentTgId = 5681654051; // Fallback to Admin ID for testing
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id) {
      currentTgId = (window as any).Telegram.WebApp.initDataUnsafe.user.id;
    }
    setTgId(currentTgId);

    // 2. Fetch REAL History from Supabase
    const fetchHistory = async () => {
      setLoadingLogs(true);
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );

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

  // Handle Stake Selection and Game Joining
  const handleJoinGame = async (entryFee: number) => {
    if (isJoining || !tgId) return;
    setIsJoining(true);
    setJoinError(null);
    
    try {
      // 1. Call your actual backend API to join/create a room
      const res = await fetch('/api/bingo/join', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tgId: tgId,
          entry_fee: entryFee 
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to join room");
      }

      // 2. If successful, route to the ACTUAL room ID returned by the database
      if (data.roomId) {
         router.push(`/test-lobby/${data.roomId}`);
      } else {
         throw new Error("No Room ID returned from server.");
      }
      
    } catch (error: any) {
      console.error("Join Error:", error);
      setJoinError(error.message || "Failed to connect to game server.");
      setIsJoining(false); 
    }
  };

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

      {/* STAKE SELECTION MODAL */}
      <AnimatePresence>
        {showStakeModal && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} 
              animate={{ scale: 1, y: 0 }} 
              exit={{ scale: 0.9, y: 20 }} 
              className="bg-[#062416] border border-green-500/30 rounded-3xl p-6 w-full max-w-sm shadow-2xl relative"
            >
              {/* Close Button */}
              <button 
                onClick={() => { setShowStakeModal(false); setJoinError(null); }} 
                className="absolute top-4 right-4 text-white/50 hover:text-white text-xl p-2"
                disabled={isJoining}
              >
                ✕
              </button>

              <h2 className="text-2xl font-black text-white mb-1 text-center">Choose Your Stake</h2>
              <p className="text-white/50 text-xs text-center mb-6 uppercase tracking-widest">Higher stakes = Bigger Pots</p>

              {joinError && (
                <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-xl text-red-200 text-sm text-center">
                  {joinError}
                </div>
              )}

              <div className="flex flex-col gap-3">
                {[
                  { stake: 10, label: "Bronze Lvl", color: "from-[#cd7f32] to-[#8b5a2b]", shadow: "rgba(205,127,50,0.4)" },
                  { stake: 50, label: "Silver Lvl", color: "from-gray-300 to-gray-500", shadow: "rgba(209,213,219,0.4)" },
                  { stake: 100, label: "Gold Lvl", color: "from-yellow-400 to-yellow-600", shadow: "rgba(250,204,21,0.4)" }
                ].map((tier) => (
                  <button 
                    key={tier.stake}
                    onClick={() => handleJoinGame(tier.stake)}
                    disabled={isJoining}
                    className={`
                      w-full relative py-4 rounded-2xl flex items-center justify-between px-6 transition-all duration-300
                      bg-gradient-to-r ${tier.color} text-black font-black
                      ${isJoining ? 'opacity-50 cursor-not-allowed' : 'active:scale-95 hover:shadow-[0_0_20px_var(--tw-shadow-color)]'}
                    `}
                    style={{ '--tw-shadow-color': tier.shadow } as any}
                  >
                    <span className="text-lg uppercase tracking-wider">{tier.label}</span>
                    <span className="text-2xl">{tier.stake} ETB</span>
                  </button>
                ))}
              </div>

              {isJoining && (
                <div className="mt-6 text-center text-green-400 text-sm font-bold animate-pulse">
                  Connecting to Game Server...
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto px-4 pb-24 z-10 scrollbar-hide">
        <AnimatePresence mode="wait">
          
          {/* ================= HOME TAB ================= */}
          {activeTab === 'home' && (
            <motion.div key="home" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-col items-center justify-center h-full gap-6">
              
              <div className="relative w-full max-w-sm flex flex-col items-center mt-4">
                
                {/* Floating Emojis */}
                <div className="absolute -top-4 -left-2 text-3xl animate-bounce" style={{ animationDelay: '0s' }}>💰</div>
                <div className="absolute top-10 -right-2 text-2xl animate-bounce" style={{ animationDelay: '0.5s' }}>💎</div>
                <div className="absolute -bottom-4 left-2 text-2xl animate-bounce" style={{ animationDelay: '1s' }}>🎲</div>

                {/* THE FIESTA BALLS CLUSTER */}
                <div className="relative w-36 h-36 flex items-center justify-center mb-6">
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
                
                <h1 className="text-4xl font-black tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">CHELA Bingo</h1>
                <p className="text-green-400/80 text-sm font-medium tracking-widest uppercase mt-1 mb-8">100-Player Massive Multiplayer</p>

                {/* THE BIG PLAY BUTTON (NOW OPENS MODAL) */}
                <button 
                  onClick={() => setShowStakeModal(true)} 
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
              </div>
            </motion.div>
          )}

          {/* ... (Logs, Top, and Profile tabs remain exactly the same as the previous response) ... */}
          {/* I have omitted them here to save space, but leave them exactly as they are in your file! */}

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