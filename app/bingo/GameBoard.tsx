'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { columnLetter } from '@/lib/bingoCards';

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];

// 🚀 CONFIGURE YOUR BUSINESS LOGIC HERE
const HOUSE_EDGE = 0.20; // 20% house cut from the total pot

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
    takenCardIds,
    daubCell,
    claimBingo,
    leaveGame,
    clearError,
  } = useBingoStore();

  const [countdownStart, setCountdownStart] = useState<number>(30);
  const playerCount = takenCardIds.size;
  
  // 🚀 FIX 1: The timer trigger is now a flat boolean. 
  // It won't restart when players 3, 4, or 50 join!
  const isReadyToStart = playerCount >= 2;

  useEffect(() => {
    if (gameStatus === 'waiting' && isReadyToStart) {
      const interval = setInterval(() => {
        setCountdownStart((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(interval);
    } else if (gameStatus !== 'waiting') {
      setCountdownStart(30);
    }
  }, [gameStatus, isReadyToStart]);

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

  // 🚀 FIX 2: Dynamic Derash calculation
  const totalStaked = currentRoom.entry_fee * playerCount;
  const currentPot = totalStaked * (1 - HOUSE_EDGE);

  return (
    <div className="w-full h-[100dvh] overflow-hidden bg-[#042014] text-white flex flex-col pt-safe">
      
      {/* ── UPGRADED TOP NAV (Stake & Derash Dashboard) ── */}
      <nav className="shrink-0 bg-[#0a4a2e] border-b border-white/10 px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={leaveGame} className="text-white/40 hover:text-white transition text-[10px] font-bold uppercase tracking-widest bg-black/20 px-2.5 py-1.5 rounded-lg border border-white/5">
              ← Exit
            </button>
            <div className="leading-tight">
              <h1 className="text-sm font-black">CHELA <span className="text-green-400">Bingo</span></h1>
              <span className="text-[9px] text-white/40 block">Card #{mySession.card_index}</span>
            </div>
          </div>
          <div className="text-[10px] font-black text-green-400 bg-green-500/10 px-2 py-1 rounded border border-green-500/20 uppercase tracking-widest">
            {playerCount} PLAYERS
          </div>
        </div>

        <div className="flex gap-2 w-full max-w-sm mx-auto">
          <div className="bg-[#063320] border border-white/10 rounded-lg flex-1 py-1 text-center shadow-inner">
            <div className="text-white font-black text-[11px]">{currentRoom.entry_fee} ETB</div>
            <div className="text-[8px] text-white/40 uppercase tracking-widest">Stake</div>
          </div>
          <div className="bg-gradient-to-b from-[#0d5c3a] to-[#0a4a2e] border border-green-500/30 rounded-lg flex-1 py-1 text-center shadow-[0_0_10px_rgba(34,197,94,0.1)]">
            {/* The Pot will now dynamically tick UP as more players join! */}
            <div className="text-yellow-400 font-black text-[11px]">{currentPot > 0 ? currentPot.toFixed(2) : '0.00'} ETB</div>
            <div className="text-[8px] text-green-100/60 uppercase tracking-widest">Derash (Pot)</div>
          </div>
        </div>
      </nav>

      {/* ── MAIN LAYOUT (Flexible Container) ── */}
      <main className="flex-1 min-h-0 p-2 flex flex-col gap-2 w-full max-w-md mx-auto">
        
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="shrink-0 fixed top-24 left-4 right-4 z-50 bg-red-500/90 border border-red-500 text-white px-4 py-3 rounded-xl flex gap-3 items-center shadow-2xl backdrop-blur-sm">
              <span className="font-bold text-sm flex-1">{error}</span>
              <button onClick={clearError} className="text-white/60 hover:text-white text-xl leading-none">×</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HUD Dashboard ── */}
        <div className="shrink-0 flex gap-2 h-24">
          <div className="flex-1 bg-[#0a4a2e] border border-white/10 rounded-xl p-3 flex flex-col justify-center items-center text-center relative overflow-hidden">
            <AnimatePresence mode="wait">
              {gameStatus === 'waiting' && playerCount < 2 && (
                <motion.div key="wait1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-yellow-400">
                  <div className="text-lg mb-1 animate-pulse">⏳</div>
                  <div className="text-[11px] font-bold uppercase tracking-widest">Waiting for Players</div>
                </motion.div>
              )}
              {gameStatus === 'waiting' && playerCount >= 2 && (
                <motion.div key="wait2" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-green-400">
                  <div className="text-[10px] uppercase font-bold text-green-500/70 mb-1">Lobby Open</div>
                  <div className="text-2xl font-black">{countdownStart}s</div>
                </motion.div>
              )}
              {gameStatus === 'countdown' && (
                <motion.div key="count" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="text-orange-400">
                  <div className="text-xl mb-1 animate-bounce">🚀</div>
                  <div className="text-[11px] font-bold uppercase tracking-widest">Starting...</div>
                </motion.div>
              )}
              {gameStatus === 'active' && (
                <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-green-400">
                  <div className="absolute inset-0 bg-green-500/10 animate-pulse" />
                  <div className="text-xl mb-1">🎱</div>
                  <div className="text-[11px] font-bold uppercase tracking-widest relative z-10">Game Active</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="aspect-square h-full bg-[#0a4a2e] border border-white/10 rounded-xl flex flex-col justify-center items-center relative">
            <div className="absolute top-2 text-[8px] text-white/30 uppercase tracking-widest w-full text-center">Last Draw</div>
            <AnimatePresence mode="wait">
              {lastDrawn ? (
                <motion.div key={lastDrawn} initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} className="w-14 h-14 mt-3 bg-gradient-to-b from-yellow-400 to-orange-500 text-black rounded-full flex flex-col items-center justify-center shadow-[0_0_20px_rgba(250,204,21,0.5)]">
                  <span className="text-[8px] font-bold opacity-70 leading-none">{columnLetter(lastDrawn)}</span>
                  <span className="text-2xl font-black leading-none">{lastDrawn}</span>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-14 h-14 mt-3 bg-[#063320] rounded-full flex items-center justify-center border border-white/5">
                  <span className="text-white/20 text-xl">?</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── 5x5 BINGO GRID ── */}
        <div className="shrink-0 w-full bg-[#0a4a2e] border border-white/10 rounded-xl p-2 relative">
          <AnimatePresence>
            {winResult?.won && gameStatus === 'active' && (
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded-xl">
                <button onClick={handleClaimWin} className="px-8 py-4 bg-gradient-to-b from-green-400 to-green-600 text-white font-black text-xl rounded-2xl shadow-[0_0_40px_rgba(34,197,94,0.8)] hover:scale-105 transition-transform animate-pulse border-2 border-white/50">
                  CLAIM BINGO!
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-5 gap-1.5 mb-1.5">
            {COLUMNS.map(col => (
              <div key={col} className="text-center font-black text-lg text-green-400/80">{col}</div>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-1.5 w-full aspect-square">
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
                  whileTap={isClickable ? { scale: 0.85 } : {}}
                  className={`
                    w-full h-full rounded-lg flex flex-col items-center justify-center font-black text-lg sm:text-xl
                    transition-all duration-300 select-none relative overflow-hidden
                    ${isFree
                      ? 'bg-gradient-to-br from-green-500 to-green-600 text-white shadow-inner'
                      : isDaubed
                        ? isWinLine
                          ? 'bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.8)] scale-105 z-10 ring-2 ring-white'
                          : 'bg-green-500 text-white shadow-inner opacity-90'
                        : isDrawn
                          ? 'bg-[#063320] border border-green-400 text-green-300 cursor-pointer animate-pulse shadow-[inset_0_0_10px_rgba(34,197,94,0.2)]'
                          : 'bg-[#062416] border border-white/5 text-white/20 cursor-default'
                    }
                  `}
                >
                  {isFree ? (
                    <span className="text-[10px] sm:text-xs font-black tracking-widest text-green-100">FREE</span>
                  ) : (
                    <>
                      <span className="text-[8px] text-current opacity-40 leading-none absolute top-1">{columnLetter(num)}</span>
                      <span className="mt-2">{num}</span>
                    </>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── DRAW HISTORY ── */}
        <div className="flex-1 min-h-0 bg-[#0a4a2e] border border-white/10 rounded-xl flex flex-col p-2">
          <div className="flex justify-between items-center mb-1 shrink-0 px-1">
            <span className="text-[9px] text-white/40 uppercase tracking-widest">Draw Tape</span>
            <span className="text-[9px] text-white/40">{drawnNumbers.length} / 75</span>
          </div>
          <div className="flex-1 overflow-x-auto flex items-center gap-2 px-1 pb-1 scrollbar-hide">
            {[...drawnNumbers].reverse().map((num, i) => (
              <motion.div
                key={`${num}-${i}`}
                initial={{ scale: 0, x: -20 }}
                animate={{ scale: 1, x: 0 }}
                className={`shrink-0 w-8 h-8 rounded-full flex flex-col items-center justify-center shadow-sm ${
                  i === 0
                    ? 'bg-yellow-400 text-black shadow-[0_0_10px_rgba(250,204,21,0.5)] border border-white/50 z-10'
                    : 'bg-[#063320] text-white/50 border border-white/5'
                }`}
              >
                <span className="text-[11px] font-black">{num}</span>
              </motion.div>
            ))}
            {drawnNumbers.length === 0 && (
              <span className="text-white/20 text-xs italic mx-auto">Awaiting first draw...</span>
            )}
          </div>
        </div>
      </main>

      {/* ── ENDGAME MODAL ── */}
      <AnimatePresence>
        {gameStatus === 'finished' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, y: 50, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 15 }} className={`w-full max-w-sm text-center p-8 rounded-3xl border-2 ${isWinner ? 'bg-[#0a4a2e] border-yellow-400 shadow-[0_0_60px_rgba(250,204,21,0.3)]' : 'bg-[#1a1a1a] border-white/10'}`}>
              {isWinner ? (
                <>
                  <div className="text-7xl mb-4 animate-bounce">🏆</div>
                  <h2 className="text-4xl font-black text-yellow-400 mb-2 tracking-tight">BINGO!</h2>
                  <p className="text-lg text-white/80 mb-4">You took the pot!</p>
                  <div className="bg-black/40 rounded-xl p-4 mb-8 border border-yellow-400/20">
                    <div className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Winnings</div>
                    <p className="text-4xl font-black text-green-400">+{payout?.toFixed(2)} ETB</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-6xl mb-4 opacity-50">💀</div>
                  <h2 className="text-2xl font-black text-white/60 mb-2">Game Over</h2>
                  <p className="text-white/40 mb-8 text-sm px-4">An opponent called BINGO first. Better luck next time.</p>
                </>
              )}
              <button onClick={leaveGame} className="w-full py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors border border-white/10">
                Return to Lobby
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}