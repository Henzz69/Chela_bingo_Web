'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { columnLetter } from '@/lib/bingoCards';

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];

interface Props {
  tgId: number;   
}

export default function BingoGameBoard({ tgId }: Props) {
  const {
    currentRoom,
    mySession,
    drawnNumbers,
    daubed,
    winResult,
    gameStatus,
    winnerId,
    payout,
    error,
    daubCell,
    claimBingo,
    leaveGame,
    clearError,
  } = useBingoStore();

  const lastDrawn = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;

  const handleClaimWin = async () => {
    try {
      const newBalance = await claimBingo(tgId);
      if (typeof newBalance === 'number') {
        console.log("Victory! New ETB Balance:", newBalance);
      }
    } catch (err) {
      console.error("Failed to claim:", err);
    }
  };

  if (!mySession || !currentRoom) return null;

  const card: number[] = mySession.grid ?? [];

  const isWinner = winnerId === String(tgId);           
  const isLoser = gameStatus === 'finished' && winnerId && winnerId !== String(tgId);

  return (
    <div className="w-full flex flex-col text-white">
      <nav className="bg-[#0a4a2e] border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={leaveGame} className="text-white/40 hover:text-white transition text-sm">
            ← Leave
          </button>
          <h1 className="text-xl font-black">
            CHELA <span className="text-green-400">Bingo</span>
          </h1>
          <span className="text-[10px] text-white/40">
            Card #{mySession.card_index}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="text-lg font-black text-yellow-400">{currentRoom.entry_fee * currentRoom.max_players} ETB</div>
            <div className="text-[10px] text-white/40 uppercase tracking-wider">Prize Pot</div>
          </div>
          <span className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider ${
            gameStatus === 'active' ? 'bg-green-500/10 text-green-400 animate-pulse'
            : gameStatus === 'countdown' ? 'bg-orange-500/10 text-orange-400 animate-bounce'
            : gameStatus === 'waiting' ? 'bg-yellow-500/10 text-yellow-400'
            : 'bg-white/5 text-white/40'
          }`}>
            {gameStatus === 'waiting' ? '⏳ Waiting...'
             : gameStatus === 'countdown' ? '🚀 Starting!'
             : gameStatus === 'active' ? '🎱 In Progress'
             : '🏁 Finished'}
          </span>
        </div>
      </nav>

      <AnimatePresence>
        {gameStatus === 'finished' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className={`text-center p-12 rounded-3xl border-2 ${
                isWinner
                  ? 'bg-[#0d5c3a] border-yellow-400 shadow-[0_0_80px_rgba(250,204,21,0.4)]'
                  : 'bg-[#0d5c3a] border-white/10'
              }`}
            >
              {isWinner ? (
                <>
                  <div className="text-8xl mb-4">🏆</div>
                  <h2 className="text-5xl font-black text-yellow-400 mb-3">BINGO!</h2>
                  <p className="text-2xl text-white mb-2">You won!</p>
                  <p className="text-4xl font-black text-green-400 mb-8">+{payout?.toFixed(2)} ETB</p>
                </>
              ) : (
                <>
                  <div className="text-8xl mb-4">😔</div>
                  <h2 className="text-4xl font-black text-white/50 mb-3">Better luck next time</h2>
                  <p className="text-white/40 mb-8">Your opponent called BINGO first</p>
                </>
              )}
              <button
                onClick={leaveGame}
                className="px-8 py-4 bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl transition-colors"
              >
                Back to Lobby
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {winResult?.won && gameStatus === 'active' && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-green-500 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4"
          >
            <span className="text-2xl">🎉</span>
            <div>
              <div className="font-black text-lg">You have BINGO!</div>
              <div className="text-green-100 text-sm">Claim your win before someone else does!</div>
            </div>
            <button
              onClick={handleClaimWin}
              className="ml-4 px-6 py-2 bg-white text-green-700 font-black rounded-xl hover:bg-green-50 transition-colors"
            >
              CLAIM BINGO!
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-20 right-5 z-40 bg-red-500/10 border border-red-500/30 text-red-400 px-5 py-3 rounded-xl flex gap-3 items-center"
          >
            {error}
            <button onClick={clearError} className="text-red-400 hover:text-white">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-6 p-4 w-full max-w-md mx-auto">

        <div className="bg-[#0a4a2e] border border-white/10 rounded-2xl p-6 text-center">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-3">Last Drawn</div>
          <AnimatePresence mode="wait">
            {lastDrawn ? (
              <motion.div
                key={lastDrawn}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="w-24 h-24 bg-gradient-to-b from-yellow-400 to-orange-500 text-black rounded-full flex flex-col items-center justify-center mx-auto shadow-[0_0_30px_rgba(250,204,21,0.6)]"
              >
                <span className="text-[10px] font-bold opacity-70">{columnLetter(lastDrawn)}</span>
                <span className="text-4xl font-black">{lastDrawn}</span>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="w-24 h-24 bg-[#063320] rounded-full flex items-center justify-center mx-auto"
              >
                <span className="text-white/30 text-3xl">?</span>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="mt-3 text-white/40 text-sm">
            {drawnNumbers.length} / 75 drawn
          </div>
        </div>

        <div>
          <h3 className="text-lg font-bold mb-4 text-white/50 uppercase tracking-widest text-sm">
            Your Card
          </h3>

          <div className="grid grid-cols-5 gap-2 mb-2">
            {COLUMNS.map(col => (
              <div key={col} className="text-center font-black text-2xl text-green-400">
                {col}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {/* 🚀 FIX: Explicitly typed num and idx here! */}
            {card.map((num: number, idx: number) => {
              const isDaubed = daubed?.has(idx) ?? false;
              const isFree = idx === 12;
              const isWinLine = winResult?.line?.includes(idx);
              const isDrawn = num !== 0 && drawnNumbers.includes(num);
              const isClickable = isDrawn && !isDaubed && gameStatus === 'active';

              return (
                <motion.button
                  key={idx}
                  onClick={() => daubCell(idx)}
                  disabled={!isClickable && !isFree}
                  whileTap={isClickable ? { scale: 0.9 } : {}}
                  className={`
                    aspect-square rounded-xl flex flex-col items-center justify-center font-black text-xl
                    transition-all duration-200 select-none
                    ${isFree
                      ? 'bg-green-500 text-white cursor-default'
                      : isDaubed
                        ? isWinLine
                          ? 'bg-yellow-400 text-black shadow-[0_0_20px_rgba(250,204,21,0.6)]'
                          : 'bg-green-500 text-white'
                        : isDrawn
                          ? 'bg-[#063320] border-2 border-green-400 text-green-300 cursor-pointer hover:bg-green-500/20'
                          : 'bg-[#0a4a2e] border border-white/10 text-white/30 cursor-default'
                    }
                  `}
                >
                  {isFree ? (
                    <span className="text-sm font-black">FREE</span>
                  ) : (
                    <>
                      <span className="text-[10px] text-current opacity-50 leading-none">
                        {columnLetter(num)}
                      </span>
                      <span>{num}</span>
                    </>
                  )}
                </motion.button>
              );
            })}
          </div>

          <AnimatePresence>
            {gameStatus === 'waiting' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-6 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-center text-yellow-400"
              >
                <div className="text-2xl mb-2">⏳</div>
                <div className="font-bold">Waiting for opponent to join...</div>
              </motion.div>
            )}
            
            {gameStatus === 'countdown' && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-6 bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 text-center text-orange-400"
              >
                <div className="text-2xl mb-2 animate-bounce">🚀</div>
                <div className="font-bold text-lg">Doors locked! Game starting!</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="bg-[#0a4a2e] border border-white/10 rounded-2xl p-5">
          <div className="text-[10px] text-white/40 uppercase tracking-widest mb-4">Draw History</div>
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
            {[...drawnNumbers].reverse().map((num, i) => (
              <motion.span
                key={`${num}-${i}`}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                  i === 0
                    ? 'bg-gradient-to-b from-yellow-400 to-orange-500 text-black shadow-[0_0_8px_rgba(250,204,21,0.5)]'
                    : 'bg-[#063320] text-white/50'
                }`}
              >
                {num}
              </motion.span>
            ))}
            {drawnNumbers.length === 0 && (
              <span className="text-white/30 text-sm">No numbers drawn yet</span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}