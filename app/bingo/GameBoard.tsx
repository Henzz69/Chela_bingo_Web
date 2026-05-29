'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBingoStore } from '@/store/bingoStore';
import { columnLetter } from '@/lib/bingoCards';
import { useTelegram } from '@/lib/useTelegram'; // To trigger haptics if desired later

const COLUMNS = ['B', 'I', 'N', 'G', 'O'];
const HOUSE_EDGE = 0.20; 

const MASTER_BOARD_ROWS = Array.from({ length: 15 }, (_, rowIndex) => [
  rowIndex + 1, rowIndex + 16, rowIndex + 31, rowIndex + 46, rowIndex + 61
]);

interface Props { tgId: number; }

function IsolatedCountdown({ isReadyToStart, gameStatus }: { isReadyToStart: boolean, gameStatus: string }) {
  const [countdownStart, setCountdownStart] = useState<number>(30);

  useEffect(() => {
    if (gameStatus === 'waiting' && isReadyToStart) {
      const interval = setInterval(() => { setCountdownStart((prev) => (prev > 0 ? prev - 1 : 0)); }, 1000);
      return () => clearInterval(interval);
    } else if (gameStatus !== 'waiting') {
      setCountdownStart(30);
    }
  }, [gameStatus, isReadyToStart]);

  if (gameStatus === 'waiting' && !isReadyToStart) {
    return (
      <motion.div key="wait1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-yellow-600 dark:text-yellow-400">
        <div className="text-xl mb-1 animate-pulse">⏳</div>
        <div className="text-[10px] font-bold uppercase tracking-widest leading-tight">Waiting</div>
      </motion.div>
    );
  }
  if (gameStatus === 'waiting' && isReadyToStart) {
    return (
      <motion.div key="wait2" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-green-600 dark:text-green-400">
        <div className="text-[10px] uppercase font-bold text-green-600/70 dark:text-green-500/70 mb-0.5">Count Down</div>
        <div className="text-2xl font-black">{countdownStart}s</div>
      </motion.div>
    );
  }
  return null;
}

export default function BingoGameBoard({ tgId }: Props) {
  // 🚀 FIX: Pulled in isAutoMode and toggleAutoMode
  const { currentRoom, mySession, drawnNumbers, daubed, winResult, gameStatus, winnerId, payout, error, takenCardIds, daubCell, claimBingo, leaveGame, clearError, theme, isAutoMode, toggleAutoMode } = useBingoStore();
  const { isTelegram, haptic } = useTelegram();

  const [isClaiming, setIsClaiming] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showFalseAlarm, setShowFalseAlarm] = useState(false);
  
  const playerCount = takenCardIds.size;
  const isReadyToStart = playerCount >= 2;
  const lastDrawn = drawnNumbers.length > 0 ? drawnNumbers[drawnNumbers.length - 1] : null;

  // 🤖 THE AUTO-DAUBER WATCHER
  useEffect(() => {
    if (isAutoMode && lastDrawn && mySession?.grid && gameStatus === 'active') {
      const cellIndex = mySession.grid.indexOf(lastDrawn);
      if (cellIndex !== -1 && !daubed.has(cellIndex)) {
        // Slight delay gives the player a moment to see the ball before the card instantly stamps
        const timer = setTimeout(() => {
          daubCell(cellIndex);
          try { if (isTelegram && haptic && typeof haptic.impact === 'function') haptic.impact('light'); } catch(e){}
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [lastDrawn, isAutoMode, mySession, gameStatus, daubed, daubCell, isTelegram, haptic]);

  const handleClaimWin = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (isClaiming) return; 

    if (!winResult?.won) {
      setShowFalseAlarm(true);
      setTimeout(() => setShowFalseAlarm(false), 3000);
      return;
    }
    
    setIsClaiming(true);
    try { await claimBingo(tgId); } 
    catch (err) { setIsClaiming(false); }
  };

  const handleRefresh = () => window.location.reload();

  if (!mySession || !currentRoom) return null;
  const card: number[] = mySession.grid ?? [];
  const isWinner = winnerId === String(tgId);          
  const currentPot = (currentRoom.entry_fee * playerCount) * (1 - HOUSE_EDGE);

  return (
    <div className={`w-full h-[100dvh] overflow-hidden bg-[#F0FDF4] dark:bg-[#042014] text-[#022C22] dark:text-white flex flex-col pt-safe select-none relative transition-colors duration-500 ${theme === 'dark' ? 'dark' : ''}`}>
      
      <nav className="shrink-0 bg-white dark:bg-[#0a4a2e] border-b border-[#22C55E]/20 dark:border-white/10 px-2 py-2 transition-colors">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide snap-x pb-1">
          {[
            { label: 'Game', value: currentRoom.id.substring(0, 6).toUpperCase() },
            { label: 'Derash', value: currentPot > 0 ? currentPot.toFixed(0) : '0' },
            { label: 'Bonus', value: 'Off' },
            { label: 'Players', value: playerCount },
            { label: 'Stake', value: currentRoom.entry_fee },
            { label: 'Call', value: drawnNumbers.length },
          ].map((stat, idx) => (
            <div key={idx} className="shrink-0 snap-start bg-[#DCFCE7] dark:bg-[#063320] border border-[#22C55E]/30 dark:border-white/5 rounded px-2.5 py-1 text-center min-w-[50px] transition-colors">
              <div className="text-[9px] text-[#064E3B]/60 dark:text-white/50 uppercase tracking-wider leading-tight">{stat.label}</div>
              <div className="text-[11px] font-black text-green-600 dark:text-green-400 leading-tight">{stat.value}</div>
            </div>
          ))}
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="shrink-0 snap-start bg-[#DCFCE7] dark:bg-[#063320] border border-[#22C55E]/30 dark:border-white/5 rounded px-3 py-1 flex flex-col items-center justify-center active:scale-95 transition-all">
            <div className="text-[9px] text-[#064E3B]/60 dark:text-white/50 uppercase tracking-wider leading-tight">Sound</div>
            <div className="text-[11px] font-black leading-tight">{soundEnabled ? '🔊' : '🔇'}</div>
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="shrink-0 fixed top-16 left-2 right-2 z-50 bg-red-500/90 border border-red-50 text-white px-3 py-2 rounded-lg flex gap-2 items-center shadow-2xl">
            <span className="font-bold text-xs flex-1">{error}</span>
            <button onClick={clearError} className="text-white/60 hover:text-white text-lg leading-none">×</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showFalseAlarm && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[85%] max-w-sm bg-white dark:bg-[#062416] border-2 border-orange-500 rounded-2xl p-6 shadow-[0_10px_50px_rgba(249,115,22,0.2)] dark:shadow-[0_0_50px_rgba(249,115,22,0.4)] text-center">
            <div className="text-4xl mb-2">⚠️</div>
            <h3 className="text-xl font-black text-orange-500 dark:text-orange-400 mb-2 uppercase tracking-widest">Not Completed!</h3>
            <p className="text-[#064E3B]/80 dark:text-white/70 text-sm mb-6">You don't have a valid Bingo sequence yet. Keep matching the called numbers!</p>
            <button onClick={() => setShowFalseAlarm(false)} className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors active:scale-95">Resume Game</button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 min-h-0 flex gap-2 p-2">
        <div className="w-[38%] bg-white dark:bg-[#0a4a2e] border border-[#22C55E]/30 dark:border-white/10 shadow-sm dark:shadow-none rounded-xl flex flex-col overflow-hidden p-1 transition-colors">
          <div className="flex w-full mb-1 shrink-0">
            {COLUMNS.map((col, idx) => {
              const colors = ['text-blue-500 dark:text-blue-400', 'text-red-500 dark:text-red-400', 'text-yellow-600 dark:text-yellow-400', 'text-green-600 dark:text-green-400', 'text-purple-500 dark:text-purple-400'];
              return <div key={col} className={`flex-1 text-center font-black text-xs sm:text-sm ${colors[idx]}`}>{col}</div>
            })}
          </div>
          <div className="flex-1 flex flex-col gap-0.5 min-h-0">
            {MASTER_BOARD_ROWS.map((row, rIdx) => (
              <div key={rIdx} className="flex-1 flex gap-0.5">
                {row.map((num, cIdx) => {
                  const isDrawn = drawnNumbers.includes(num);
                  return (
                    <div key={num} className={`flex-1 flex items-center justify-center rounded-sm text-[9px] sm:text-[10px] font-bold transition-all duration-300
                        ${isDrawn 
                          ? 'bg-green-500 text-white border border-white/60 shadow-[0_0_8px_rgba(34,197,94,0.5),inset_0_0_4px_rgba(255,255,255,0.4)] z-10 scale-110' 
                          : 'bg-[#DCFCE7] dark:bg-[#062416] text-[#064E3B]/60 dark:text-white/20 border border-[#22C55E]/20 dark:border-white/5'
                        }`}>
                      {num}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="w-[62%] flex flex-col gap-2">
          <div className="flex gap-2 h-24 shrink-0">
            <div className="flex-1 bg-white dark:bg-[#0a4a2e] border border-[#22C55E]/30 dark:border-white/10 shadow-sm dark:shadow-none rounded-xl flex flex-col justify-center items-center text-center p-2 transition-colors">
              <AnimatePresence mode="wait">
                {gameStatus === 'waiting' && <IsolatedCountdown isReadyToStart={isReadyToStart} gameStatus={gameStatus} />}
                {gameStatus === 'countdown' && (
                  <motion.div key="count" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} className="text-orange-500 dark:text-orange-400">
                    <div className="text-xl mb-1 animate-bounce">🚀</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest leading-tight">Starting</div>
                  </motion.div>
                )}
                {gameStatus === 'active' && (
                  <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-green-600 dark:text-green-400 w-full relative flex flex-col items-center justify-center">
                    <div className="absolute inset-0 bg-green-500/10 animate-pulse rounded" />
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-1 text-[#064E3B]/50 dark:text-white/50">Current Call</div>
                    
                    {/* 🚀 FIX: The Heavy Spring Jumbo Ball */}
                    <AnimatePresence mode="wait">
                      {lastDrawn ? (
                        <motion.div key={lastDrawn} 
                          initial={{ scale: 0.3, y: 30, opacity: 0, rotate: -120 }} 
                          animate={{ scale: 1, y: 0, opacity: 1, rotate: 0 }} 
                          exit={{ scale: 0.8, opacity: 0, filter: "blur(2px)" }}
                          transition={{ type: "spring", stiffness: 450, damping: 18, mass: 1.2 }}
                          className="mx-auto w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-yellow-300 to-orange-400 dark:from-yellow-400 dark:to-orange-500 text-black rounded-full flex flex-col items-center justify-center shadow-[0_5px_15px_rgba(250,204,21,0.4)] dark:shadow-[0_0_20px_rgba(250,204,21,0.6)] border border-white/40 dark:border-white/20">
                          <span className="text-[9px] sm:text-[11px] font-black opacity-80 leading-none">{columnLetter(lastDrawn)}</span>
                          <span className="text-2xl sm:text-3xl font-black leading-none mt-0.5">{lastDrawn}</span>
                        </motion.div>
                      ) : (
                        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-14 h-14 sm:w-16 sm:h-16 bg-[#F0FDF4] dark:bg-[#063320] rounded-full flex items-center justify-center border border-[#22C55E]/30 dark:border-white/5">
                          <span className="text-[#064E3B]/30 dark:text-white/20 text-lg">?</span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex-1 bg-white dark:bg-[#0a4a2e] border border-[#22C55E]/30 dark:border-white/10 shadow-sm dark:shadow-none rounded-xl p-1 sm:p-2 flex flex-col relative overflow-hidden transition-colors">
            
            {/* 🚀 FIX: The Auto/Manual Control Switch */}
            <div className="flex justify-between items-center px-1 mb-1 shrink-0">
              <span className="text-[10px] text-[#064E3B]/50 dark:text-white/40 uppercase tracking-widest font-bold">Board #{mySession.card_index}</span>
              <button onClick={toggleAutoMode} className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest transition-colors ${isAutoMode ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isAutoMode ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                {isAutoMode ? 'Auto: ON' : 'Auto: OFF'}
              </button>
            </div>

            <div className="grid grid-cols-5 gap-1 sm:gap-1.5 w-full aspect-square mt-auto mb-auto">
              {card.map((num: number, idx: number) => {
                const isDaubed = daubed?.has(idx) ?? false;
                const isFree = idx === 12;
                const isWinLine = winResult?.line?.includes(idx);
                const isDrawn = num !== 0 && drawnNumbers.includes(num);
                const isClickable = isDrawn && !isDaubed && gameStatus === 'active';
                
                // 🚀 FIX: Hardcore Mode Visual Logic
                const showPulse = isDrawn && !isDaubed && isAutoMode;

                return (
                  <motion.button key={idx} onClick={() => daubCell(idx)} disabled={!isClickable && !isFree} whileTap={isClickable ? { scale: 0.85 } : {}}
                    className={`touch-manipulation w-full h-full rounded-md flex flex-col items-center justify-center font-black text-lg sm:text-xl transition-all duration-300 select-none relative overflow-hidden
                      ${isFree ? 'bg-gradient-to-br from-green-400 to-green-600 dark:from-green-500 dark:to-green-600 text-white shadow-inner'
                        : isDaubed ? isWinLine ? 'bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.6)] dark:shadow-[0_0_15px_rgba(250,204,21,0.8)] scale-105 z-10 ring-2 ring-white'
                                             : 'bg-green-500 text-white shadow-inner opacity-90'
                          : showPulse ? 'bg-white dark:bg-[#063320] border-2 border-green-500 dark:border-green-400 text-green-600 dark:text-green-300 cursor-pointer animate-pulse shadow-[inset_0_0_15px_rgba(34,197,94,0.15)] dark:shadow-[inset_0_0_15px_rgba(34,197,94,0.3)]'
                          : isClickable ? 'bg-[#DCFCE7] dark:bg-[#062416] border border-[#22C55E]/20 dark:border-white/5 text-[#064E3B]/40 dark:text-white/40 cursor-pointer' // Hardcore mode drawn (Looks blank, but is clickable)
                                    : 'bg-[#DCFCE7] dark:bg-[#062416] border border-[#22C55E]/20 dark:border-white/5 text-[#064E3B]/40 dark:text-white/40 cursor-default'
                      }`}
                  >
                    {isFree ? ( <span className="text-[9px] font-black tracking-widest text-green-100">FREE</span> ) : (
                      <>
                        <span className="text-[8px] sm:text-[9px] text-current opacity-50 leading-none absolute top-1">{columnLetter(num)}</span>
                        <span className="mt-1">{num}</span>
                      </>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      <footer className="shrink-0 px-2 pb-2 flex flex-col gap-2">
        <button onPointerDown={handleClaimWin} onClick={handleClaimWin} disabled={isClaiming}
          className={`w-full py-3 sm:py-4 rounded-xl font-black text-xl uppercase tracking-widest transition-all duration-300 touch-manipulation bg-gradient-to-b from-yellow-300 to-orange-400 dark:from-yellow-400 dark:to-orange-500 text-black shadow-[0_5px_20px_rgba(250,204,21,0.3)] dark:shadow-[0_0_20px_rgba(250,204,21,0.4)] hover:shadow-[0_5px_30px_rgba(250,204,21,0.5)] dark:hover:shadow-[0_0_30px_rgba(250,204,21,0.6)] active:scale-95 border-2 border-yellow-200 dark:border-yellow-200 ${isClaiming ? 'opacity-70 cursor-wait' : ''}`}
        >
          {isClaiming ? 'Claiming...' : 'BINGO!'}
        </button>

        <div className="flex gap-2">
          <button onClick={handleRefresh} className="flex-1 py-2.5 bg-white dark:bg-[#063320] hover:bg-[#F0FDF4] dark:hover:bg-[#0a4a2e] text-[#064E3B] dark:text-white/80 dark:hover:text-white rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1 border border-[#22C55E]/30 dark:border-white/10 active:scale-95 shadow-sm dark:shadow-none">
            🔄 Refresh
          </button>
          <button onClick={leaveGame} className="flex-1 py-2.5 bg-red-50 dark:bg-red-900/40 hover:bg-red-100 dark:hover:bg-red-900/70 text-red-600 dark:text-red-400 dark:hover:text-red-300 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1 border border-red-200 dark:border-red-900/50 active:scale-95 shadow-sm dark:shadow-none">
            🚪 Leave
          </button>
        </div>
      </footer>

      <AnimatePresence>
        {gameStatus === 'finished' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-white/90 dark:bg-black/95 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.8, y: 50, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 15 }} className={`w-full max-w-sm text-center p-8 rounded-3xl border-2 shadow-2xl ${isWinner ? 'bg-white dark:bg-[#0a4a2e] border-yellow-400 shadow-[0_15px_60px_rgba(250,204,21,0.2)] dark:shadow-[0_0_60px_rgba(250,204,21,0.3)]' : 'bg-[#F0FDF4] dark:bg-[#1a1a1a] border-[#22C55E]/30 dark:border-white/10'}`}>
              {isWinner ? (
                <>
                  <div className="text-7xl mb-4 animate-bounce">🏆</div>
                  <h2 className="text-4xl font-black text-yellow-500 dark:text-yellow-400 mb-2 tracking-tight">BINGO!</h2>
                  <p className="text-lg text-[#064E3B]/80 dark:text-white/80 mb-4">You took the pot!</p>
                  <div className="bg-[#F0FDF4] dark:bg-black/40 rounded-xl p-4 mb-8 border border-yellow-400/30 dark:border-yellow-400/20">
                    <div className="text-[10px] text-[#064E3B]/60 dark:text-white/40 uppercase tracking-widest mb-1">Winnings</div>
                    <p className="text-4xl font-black text-green-500 dark:text-green-400">+{payout?.toFixed(2)} ETB</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-6xl mb-4 opacity-50">💀</div>
                  <h2 className="text-2xl font-black text-[#022C22]/60 dark:text-white/60 mb-2">Game Over</h2>
                  <p className="text-[#064E3B]/60 dark:text-white/40 mb-8 text-sm px-4">An opponent called BINGO first. Better luck next time.</p>
                </>
              )}
              <button onClick={leaveGame} className="w-full py-4 bg-[#DCFCE7] dark:bg-white/10 hover:bg-green-100 dark:hover:bg-white/20 text-[#064E3B] dark:text-white font-bold rounded-xl transition-colors border border-[#22C55E]/30 dark:border-white/10 touch-manipulation active:scale-95 shadow-sm dark:shadow-none">
                Return to Lobby
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}