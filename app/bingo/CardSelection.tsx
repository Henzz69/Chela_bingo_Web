'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';

interface Props {
  tgId: number;
}

// 🚀 OPTIMIZATION: Slimmed down summary bars to save vertical space
const SummaryBar = ({ label, value, colorClass }: { label: string; value: string; colorClass: string }) => (
  <div className="bg-white dark:bg-[#0a4a2e]/80 border border-[#22C55E]/30 dark:border-white/10 rounded-lg flex-1 py-1 px-1.5 text-center shadow-sm dark:shadow-none transition-colors">
    <div className={`${colorClass} font-black text-[10px] leading-tight`}>{value}</div>
    <div className="text-[7px] text-[#064E3B]/60 dark:text-white/40 uppercase tracking-wide leading-tight mt-0.5">{label}</div>
  </div>
);

export default function BingoCardSelection({ tgId }: Props) {
  const { 
    currentRoom, selectedCardId, allCardGrids, takenCardIds, 
    selectCardPreview, finalizeJoinWithCard, loadingRooms, 
    error, clearError, theme, rooms, joinStakeRoom 
  } = useBingoStore();

  useEffect(() => {
    if (currentRoom && (currentRoom.status === 'active' || currentRoom.status === 'finished')) {
      console.log(`📡 Room ${currentRoom.id} locked or active! Re-routing user to a fresh room...`);
      joinStakeRoom(tgId, currentRoom.entry_fee, currentRoom.max_players || 100)
        .catch((err) => console.error("Auto-reroute sequencing exception:", err));
    }
  }, [currentRoom?.status, tgId, joinStakeRoom, currentRoom?.entry_fee, currentRoom?.max_players]);

  if (!currentRoom) return null;
  const currentPreviewGrid = selectedCardId ? allCardGrids[selectedCardId] : null;

  const liveGamesCount = rooms.filter(r => r.status === 'active' || r.status === 'countdown').length;

  const houseEdge = 0.20;
  const activePlayers = takenCardIds ? takenCardIds.size : 0;
  const entryFee = currentRoom.entry_fee || 0;
  const maxPlayers = currentRoom.max_players || 100;
  
  const currentPot = activePlayers * entryFee * (1 - houseEdge);
  const maxPot = maxPlayers * entryFee * (1 - houseEdge);
  const fillPercentage = maxPot > 0 ? Math.min((currentPot / maxPot) * 100, 100) : 0;

  return (
    <div className={`w-full h-[100dvh] overflow-hidden bg-[#F0FDF4] dark:bg-[#042014] text-[#022C22] dark:text-white flex flex-col pt-safe transition-colors duration-500 ${theme === 'dark' ? 'dark' : ''}`}>
      
      {/* 🚀 OPTIMIZATION: Tighter padding and gap in the navigation header */}
      <nav className="shrink-0 bg-white dark:bg-[#0a4a2e] border-b border-[#22C55E]/20 dark:border-white/10 px-3 py-1.5 flex flex-col gap-1.5 transition-colors">
        <div className="flex items-center gap-2">
          <button onClick={() => useBingoStore.setState({ screen: 'select' })} className="text-[#064E3B]/70 dark:text-white/60 hover:text-[#022C22] dark:hover:text-white transition text-xs flex gap-1 items-center font-bold">
            ← Back
          </button>
          <h1 className="text-base font-extrabold text-green-500 dark:text-green-400 mx-auto pr-10">Select Card</h1>
        </div>
        
        <div className="flex gap-2 w-full max-w-sm mx-auto">
          <SummaryBar label="LIVE GAMES" value={`${liveGamesCount}`} colorClass="text-orange-500 dark:text-orange-400" />
          <SummaryBar label="STAKE" value={`${entryFee} ETB`} colorClass="text-yellow-600 dark:text-yellow-400" />
        </div>
      </nav>

      <main className="flex-1 min-h-0 p-1.5 flex flex-col gap-1.5 w-full max-w-md mx-auto">
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="shrink-0 bg-red-100 dark:bg-red-500/10 border border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg flex gap-3 items-center text-xs">
              {error}
              <button onClick={clearError} className="ml-auto text-red-500 hover:text-red-700 dark:hover:text-white font-bold">×</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 🚀 OPTIMIZATION: Compact Jackpot Slider */}
        <div className="shrink-0 bg-white dark:bg-[#062416] border border-[#22C55E]/30 dark:border-[#22C55E]/20 rounded-xl py-1.5 px-3 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-full bg-yellow-500/5 blur-2xl rounded-full" />
          <div className="flex justify-between items-end mb-1 relative z-10">
            <div className="flex flex-col">
              <span className="text-[8px] text-[#064E3B]/60 dark:text-white/50 font-black uppercase tracking-widest leading-tight">Est. Prize Pot</span>
              <span className="text-[10px] font-bold text-[#064E3B]/40 dark:text-white/40">{activePlayers} / {maxPlayers} Players</span>
            </div>
            <motion.span 
              key={currentPot}
              initial={{ scale: 1.1, color: '#F59E0B' }}
              animate={{ scale: 1, color: theme === 'dark' ? '#FBBF24' : '#D97706' }}
              className="text-lg font-black drop-shadow-sm tracking-tight leading-none"
            >
              {currentPot > 0 ? currentPot.toFixed(2) : '0'} ETB
            </motion.span>
          </div>
          <div className="w-full h-1.5 bg-gray-100 dark:bg-black/40 rounded-full overflow-hidden shadow-inner relative z-10">
            <motion.div
              className="h-full bg-gradient-to-r from-green-500 to-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]"
              initial={{ width: 0 }}
              animate={{ width: `${fillPercentage}%` }}
              transition={{ type: 'spring', stiffness: 60, damping: 15 }}
            />
          </div>
        </div>

        {/* 🚀 OPTIMIZATION: Tighter padding on the 100-card grid */}
        <div className="shrink-0 bg-white dark:bg-[#0a4a2e] border border-[#22C55E]/20 dark:border-white/10 rounded-xl p-1.5 shadow-sm dark:shadow-none transition-colors">
          <div className="grid grid-cols-10 gap-[2px] aspect-square w-full">
            {[...Array(100)].map((_, i) => {
              const cardId = i + 1;
              const isTaken = takenCardIds.has(cardId);
              const isSelected = selectedCardId === cardId;

              return (
                <motion.button
                  key={cardId}
                  whileTap={!isTaken ? { scale: 0.85 } : {}}
                  onClick={() => selectCardPreview(cardId)}
                  disabled={isTaken}
                  className={`
                    aspect-square rounded-[3px] text-[9px] sm:text-[10px] font-black flex items-center justify-center transition-all duration-200 select-none
                    ${isSelected
                      ? 'bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.8)] scale-110 z-20'
                      : isTaken
                        ? 'bg-orange-100 dark:bg-orange-500/20 border border-orange-300 dark:border-orange-500/50 text-orange-500 dark:text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.2)] z-10 cursor-not-allowed'
                        : 'bg-[#DCFCE7] dark:bg-[#063320] text-[#064E3B] dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-500/30'
                    }
                  `}
                >
                  {cardId}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* 🚀 OPTIMIZATION: Strict max-height on preview to prevent overlapping */}
        <div className="flex-1 min-h-0 flex flex-col justify-center items-center py-1 relative w-full">
          <AnimatePresence mode="wait">
            {selectedCardId && currentPreviewGrid ? (
              <motion.div key={selectedCardId} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} 
                className="w-full max-w-[180px] h-full max-h-[180px] aspect-square flex flex-col bg-white rounded-xl p-1.5 shadow-xl border border-gray-100 dark:border-none relative mt-3"
              >
                <div className="absolute -top-4 left-0 w-full text-center font-bold text-[#064E3B]/50 dark:text-white/50 text-[9px] uppercase tracking-widest">
                  BOARD #{selectedCardId} PREVIEW
                </div>
                <div className="grid grid-cols-5 gap-[2px] mb-1">
                  {['B', 'I', 'N', 'G', 'O'].map(col => <div key={col} className="text-center font-black text-xs text-black">{col}</div>)}
                </div>
                <div className="grid grid-cols-5 gap-[2px] flex-1 min-h-0">
                  {currentPreviewGrid.map((num: number, idx: number) => {
                    const isFree = idx === 12;
                    return (
                      <div key={idx} className={`w-full h-full rounded-[3px] flex items-center justify-center font-black transition-all ${isFree ? 'bg-orange-100 text-orange-500' : 'bg-slate-100 text-black' } `}>
                        {isFree ? <span className="text-orange-500 text-xs">★</span> : <span className="text-[10px] sm:text-xs">{num}</span>}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full flex flex-col items-center justify-center text-[#064E3B]/40 dark:text-white/30 text-[10px] font-bold uppercase tracking-widest text-center px-4">
                Tap an available card above<br/>to preview your board
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 🚀 OPTIMIZATION: Slimmer Start Button */}
        <div className="shrink-0 pb-safe pb-1">
          <motion.button
            key="submit-btn"
            whileTap={{ scale: 0.97 }}
            onClick={() => finalizeJoinWithCard(tgId)}
            disabled={selectedCardId === null || loadingRooms}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-green-600 text-white font-black text-base shadow-[0_4px_15px_rgba(34,197,94,0.3)] disabled:opacity-50 disabled:from-gray-400 disabled:to-gray-500 dark:disabled:from-gray-600 dark:disabled:to-gray-700 disabled:shadow-none transition-all flex items-center justify-center h-12"
          >
            {loadingRooms ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'START GAME'}
          </motion.button>
        </div>
      </main>
    </div>
  );
}