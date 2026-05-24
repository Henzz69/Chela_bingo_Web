[5/24/2026 4:07 PM] Henok: 'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { columnLetter } from '@/lib/bingoCards';

interface Props {
  tgId: number;
}

const SummaryBar = ({ label, value, colorClass }: { label: string, value: string, colorClass: string }) => (
  <div className="bg-[#0a4a2e]/80 border border-white/10 rounded-xl flex-1 p-1.5 text-center">
    <div className={${colorClass} font-black text-[11px]}>{value}</div>
    <div className="text-[8px] text-white/40 uppercase tracking-wide">{label}</div>
  </div>
);

export default function BingoCardSelection({ tgId }: Props) {
  const {
    currentRoom,
    selectedCardId,
    allCardGrids,
    takenCardIds,
    selectCardPreview,
    finalizeJoinWithCard,
    loadingRooms,
    error,
    clearError,
  } = useBingoStore();

  if (!currentRoom) return null;

  const currentPreviewGrid = selectedCardId ? allCardGrids[selectedCardId] : null;

  return (
    // 🚀 FIX: Locked height to 100dvh, flex-col, overflow-hidden prevents scrolling
    <div className="w-full h-[100dvh] overflow-hidden bg-[#042014] text-white flex flex-col pt-safe">
      
      {/* ── Header Summary (Fixed Height) ── */}
      <nav className="shrink-0 bg-[#0a4a2e] border-b border-white/10 px-4 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => useBingoStore.setState({ screen: 'select' })} className="text-white/60 hover:text-white transition text-xs flex gap-1 items-center">
            ← Back
          </button>
          <h1 className="text-lg font-extrabold text-green-400 mx-auto pr-10">Select Card</h1>
        </div>
        
        <div className="flex gap-2 w-full max-w-sm mx-auto">
          <SummaryBar label="ACTIVE GAME" value={${currentRoom.active_game_count ?? 0}} colorClass="text-orange-400" />
          <SummaryBar label="STAKE" value={${currentRoom.entry_fee} ETB} colorClass="text-yellow-400" />
        </div>
      </nav>

      {/* ── Main Layout (Flexible) ── */}
      <main className="flex-1 min-h-0 p-2 flex flex-col gap-2 w-full max-w-md mx-auto">
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="shrink-0 bg-red-500/10 border border-red-500/30 text-red-400 px-3 py-1.5 rounded-lg flex gap-3 items-center text-xs">
              {error}
              <button onClick={clearError} className="ml-auto text-red-400 hover:text-white font-bold">×</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 100 Card Grid (Fixed Aspect Square) ── */}
        <div className="shrink-0 bg-[#0a4a2e] border border-white/10 rounded-xl p-2">
          <div className="grid grid-cols-10 gap-[3px] aspect-square w-full">
            {[...Array(100)].map((_, i) => {
              const cardId = i + 1;
              const isTaken = takenCardIds.has(cardId);
              const isSelected = selectedCardId === cardId;
[5/24/2026 4:07 PM] Henok: return (
                <motion.button
                  key={cardId}
                  whileTap={!isTaken ? { scale: 0.85 } : {}}
                  onClick={() => selectCardPreview(cardId)}
                  disabled={isTaken}
                  className={`
                    aspect-square rounded-[4px] text-[10px] sm:text-[11px] font-black flex items-center justify-center transition-all duration-200 select-none
                    ${isSelected
                      ? 'bg-green-500 text-white shadow-[0_0_12px_rgba(34,197,94,0.8)] scale-110 z-20'
                      : isTaken
                        // 🚀 FIX: Highlighted pulsing style for players waiting in the lobby!
                        ? 'bg-orange-500/20 border border-orange-500/50 text-orange-400 animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.4)] z-10 cursor-not-allowed'
                        : 'bg-[#063320] text-green-300 hover:bg-green-500/30'
                    }
                  `}
                >
                  {cardId}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Selected Card Preview (Mathematically Flexible) ── */}
        <div className="flex-1 min-h-0 flex flex-col justify-center items-center py-2 relative w-full">
          <AnimatePresence mode="wait">
            {selectedCardId && currentPreviewGrid ? (
              <motion.div 
                key={selectedCardId} 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.9 }} 
                // 🚀 FIX: h-full and max-h constraint ensures it scales to fit the empty space precisely
                className="w-full max-w-[240px] max-h-full aspect-square flex flex-col bg-white rounded-xl p-2 shadow-2xl relative"
              >
                <div className="absolute -top-5 left-0 w-full text-center font-bold text-white/50 text-[10px] uppercase tracking-widest">
                  BOARD #{selectedCardId} PREVIEW
                </div>
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {['B', 'I', 'N', 'G', 'O'].map(col => (
                    <div key={col} className="text-center font-black text-sm text-black">{col}</div>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1 flex-1 min-h-0">
                  {currentPreviewGrid.map((num: number, idx: number) => {
                    const isFree = idx === 12;
                    return (
                      <div key={idx} className={w-full h-full rounded-[4px] flex items-center justify-center font-black transition-all ${isFree ? 'bg-orange-100 text-orange-500' : 'bg-slate-100 text-black' } }>
                        {isFree ? <span className="text-orange-500 text-sm">★</span> : <span className="text-xs sm:text-sm">{num}</span>}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-full h-full flex flex-col items-center justify-center text-white/30 text-[11px] font-bold uppercase tracking-widest text-center px-4"
              >
                Tap an available card above<br/>to preview your board
              </motion.div>
            )}
          </AnimatePresence>
        </div>
[5/24/2026 4:07 PM] Henok: {/* ── Start Button (Fixed Height at Bottom) ── */}
        <div className="shrink-0 pb-safe pb-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => finalizeJoinWithCard(tgId)}
            disabled={selectedCardId === null || loadingRooms}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-green-500 to-green-600 text-white font-black text-lg shadow-[0_4px_15px_rgba(34,197,94,0.3)] disabled:opacity-50 disabled:from-gray-600 disabled:to-gray-700 disabled:shadow-none transition-all flex items-center justify-center h-14"
          >
            {loadingRooms ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'START GAME'}
          </motion.button>
        </div>
      </main>
    </div>
  );
}