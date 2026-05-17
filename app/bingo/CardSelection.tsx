'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { columnLetter } from '@/lib/bingoCards';

interface Props {
  tgId: number;
}

const SummaryBar = ({ label, value, colorClass }: { label: string, value: string, colorClass: string }) => (
  <div className="bg-[#0a4a2e]/80 border border-white/10 rounded-2xl flex-1 p-2 text-center">
    <div className={`${colorClass} font-black text-xs`}>{value}</div>
    <div className="text-[9px] text-white/40 uppercase tracking-wide">{label}</div>
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
    <div className="w-full min-h-screen bg-[#042014] text-white flex flex-col pt-safe">
      
      {/* ── Header Summary ── */}
      <nav className="bg-[#0a4a2e] border-b border-white/10 px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => useBingoStore.setState({ screen: 'select' })} className="text-white/60 hover:text-white transition text-xs flex gap-1 items-center">
            ← Back
          </button>
          <h1 className="text-xl font-extrabold text-green-400 mx-auto pr-10">Select Card</h1>
        </div>
        
        <div className="flex gap-2 w-full max-w-sm mx-auto">
          <SummaryBar label="ACTIVE GAME" value={`${currentRoom.active_game_count ?? 0}`} colorClass="text-orange-400" />
          <SummaryBar label="STAKE" value={`${currentRoom.entry_fee} ETB`} colorClass="text-yellow-400" />
        </div>
      </nav>

      <main className="flex-1 p-4 flex flex-col gap-5 w-full max-w-md mx-auto">
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 rounded-xl flex gap-3 items-center text-sm">
              {error}
              <button onClick={clearError} className="ml-auto text-red-400 hover:text-white">×</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 100 Card Grid ── */}
        <div className="bg-[#0a4a2e] border border-white/10 rounded-2xl p-4">
          <div className="grid grid-cols-10 gap-1.5 aspect-square">
            {[...Array(100)].map((_, i) => {
              const cardId = i + 1;
              const isTaken = takenCardIds.has(cardId);
              const isSelected = selectedCardId === cardId;

              return (
                <motion.button
                  key={cardId}
                  whileTap={!isTaken ? { scale: 0.9 } : {}}
                  onClick={() => selectCardPreview(cardId)}
                  disabled={isTaken}
                  className={`aspect-square rounded-md text-[11px] font-black flex items-center justify-center transition-all duration-200 select-none
                    ${isSelected
                      ? 'bg-orange-500 text-white shadow-[0_0_12px_rgba(249,115,22,0.6)] scale-110'
                      : isTaken
                        ? 'bg-red-500/20 text-red-400 cursor-not-allowed opacity-50'
                        : 'bg-[#063320] text-green-300 hover:bg-green-500/20'
                    }
                  `}
                >
                  {cardId}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Selected Card Preview ── */}
        <AnimatePresence mode="wait">
          {selectedCardId && currentPreviewGrid && (
            <motion.div key={selectedCardId} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="w-full flex flex-col gap-3">
              <h3 className="text-center font-bold text-white/50 text-sm uppercase tracking-widest">
                BOARD #{selectedCardId} PREVIEW
              </h3>
              <div className="bg-white rounded-2xl p-3 w-4/5 mx-auto aspect-square flex flex-col shadow-2xl">
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {['B', 'I', 'N', 'G', 'O'].map(col => (
                    <div key={col} className="text-center font-black text-xl text-black">{col}</div>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1 flex-1">
                  {currentPreviewGrid.map((num: number, idx: number) => {
                    const isFree = idx === 12;
                    return (
                      <div key={idx} className={`aspect-square rounded flex items-center justify-center font-black transition-all ${isFree ? 'bg-orange-100 text-orange-500' : 'bg-slate-50 text-black' } `}>
                        {isFree ? <span className="text-orange-500 text-xl">★</span> : <span className="text-base">{num}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Start Button ── */}
        <div className="mt-auto pt-4 pb-safe">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => finalizeJoinWithCard(tgId)}
            disabled={selectedCardId === null || loadingRooms}
            className="w-full py-4 rounded-full bg-green-500 text-white font-extrabold text-xl shadow-[0_4px_20px_rgba(34,197,94,0.4)] disabled:opacity-50 transition-all flex items-center justify-center h-16"
          >
            {loadingRooms ? <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : 'START GAME'}
          </motion.button>
        </div>
      </main>
    </div>
  );
}