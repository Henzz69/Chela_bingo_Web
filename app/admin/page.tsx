'use client';

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';

// 🔒 THE MASTER PASSWORD VAULT
const MASTER_PASSWORD = "chelahebenki2026";

type TimeScale = 'today' | 'week' | 'month' | 'all';

interface EnrichedTransaction {
  id: string;
  user_id: string;
  amount: number;
  tx_type: string;
  status: string;
  created_at: string;
  display_name?: string;
  phone?: string;
  bank_name?: string;       
  account_name?: string;    
  account_number?: string;  
}

interface LiveBingoGame {
  id: string;
  status: string;
  entry_fee: number;
  active_players: number;
  live_pot: number;
}

interface UserLookup {
  display_name: string | null;
  phone: string | null;
}

export default function AdminDashboard() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState(false);

  const [timeScale, setTimeScale] = useState<TimeScale>('today');
  
  // 📊 Telemetry State
  const [totalWallets, setTotalWallets] = useState<number>(0);
  const [trueProfit, setTrueProfit] = useState<number>(0);
  const [activeGames, setActiveGames] = useState<Record<string, LiveBingoGame>>({});
  
  const [pendingTxs, setPendingTxs] = useState<EnrichedTransaction[]>([]);
  const [recentDeposits, setRecentDeposits] = useState<EnrichedTransaction[]>([]);
  
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [processingTx, setProcessingTx] = useState<string | null>(null);

  // 🚀 CORE SYNC ENGINE
  const fetchDashboardData = async () => {
    if (!isUnlocked) return;
    setIsLoadingData(true);
    
    const now = new Date();
    let startDate = new Date(0); 
    if (timeScale === 'today') startDate = new Date(now.setHours(0,0,0,0));
    if (timeScale === 'week') startDate = new Date(now.setDate(now.getDate() - 7));
    if (timeScale === 'month') startDate = new Date(now.setDate(now.getDate() - 30));
    const isoStart = startDate.toISOString();

    try {
      // 1. Fetch Global Wallets (We still use your RPC for this lightweight check)
      const { data: globalData } = await supabase.rpc('get_admin_stats');
      if (globalData) setTotalWallets(globalData.total_wallets);

      // 2. THE TRUE PROFIT CALCULATION (Zero DB Changes Required)
      // We sum all 80% payouts, and calculate the corresponding 20% house cut (Payout * 0.25)
      const { data: winTxs } = await supabase
        .from('transactions')
        .select('amount')
        .eq('tx_type', 'bingo_win')
        .gte('created_at', isoStart);
        
      const totalPayouts = (winTxs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
      setTrueProfit(totalPayouts * 0.25);

      // 3. Time-Filtered Withdrawals
      const { data: pendingWData } = await supabase
          .from('transactions')
          .select('*')
          .eq('tx_type', 'withdrawal')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

      // 4. Time-Filtered Deposits
      const { data: depositsData } = await supabase
          .from('transactions')
          .select('*')
          .eq('tx_type', 'deposit')
          .eq('status', 'completed')
          .gte('created_at', isoStart)
          .order('created_at', { ascending: false })
          .limit(200);

      // 5. Fetch User Lookup Dictionary
      const { data: usersData } = await supabase.from('tg_users').select('tg_id, display_name, phone');
      const userMap: Record<string, UserLookup> = {};
      if (usersData) {
          usersData.forEach((u: any) => {
              userMap[u.tg_id.toString()] = { display_name: u.display_name, phone: u.phone };
          });
      }

      // Enrich Data
      const enrich = (txs: any[]) => (txs || []).map(tx => ({
          ...tx,
          display_name: userMap[tx.user_id?.toString()]?.display_name || `User ${tx.user_id}`,
          phone: userMap[tx.user_id?.toString()]?.phone || 'No Phone'
      }));

      setPendingTxs(enrich(pendingWData || []));
      setRecentDeposits(enrich(depositsData || []).filter(tx => tx.amount >= 50));

      // 6. LIVE GAMES RADAR
      const { data: liveRooms } = await supabase
        .from('bingo_rooms')
        .select('id, status, entry_fee')
        .in('status', ['waiting', 'countdown', 'active']);

      if (liveRooms && liveRooms.length > 0) {
        const roomIds = liveRooms.map(r => r.id);
        // Fetch active cards for these rooms
        const { data: activeCards } = await supabase
          .from('bingo_cards')
          .select('room_id')
          .in('room_id', roomIds)
          .not('card_index', 'is', null);

        // Map player counts
        const cardCounts = (activeCards || []).reduce((acc: any, card: any) => {
          acc[card.room_id] = (acc[card.room_id] || 0) + 1;
          return acc;
        }, {});

        const mappedRooms: Record<string, LiveBingoGame> = {};
        liveRooms.forEach(r => {
           const players = cardCounts[r.id] || 0;
           mappedRooms[r.id] = {
             id: r.id,
             status: r.status,
             entry_fee: r.entry_fee,
             active_players: players,
             live_pot: players * r.entry_fee
           };
        });
        setActiveGames(mappedRooms);
      } else {
        setActiveGames({});
      }

    } catch (err) {
      console.error("Dashboard Sync Failed:", err);
    } finally {
      setIsLoadingData(false);
    }
  };

  // 📡 WEBSOCKET REAL-TIME ENGINE
  useEffect(() => {
    if (!isUnlocked) return;
    fetchDashboardData();

    // Channel 1: Watch Rooms
    const roomSub = supabase.channel('admin-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_rooms' }, (payload) => {
         const newRoom = payload.new as any;
         if (['finished', 'closed'].includes(newRoom.status)) {
            setActiveGames(prev => {
              const clone = { ...prev };
              delete clone[newRoom.id];
              return clone;
            });
         } else if (['waiting', 'countdown', 'active'].includes(newRoom.status)) {
            setActiveGames(prev => ({
              ...prev,
              [newRoom.id]: {
                id: newRoom.id,
                status: newRoom.status,
                entry_fee: newRoom.entry_fee,
                active_players: prev[newRoom.id]?.active_players || 0,
                live_pot: (prev[newRoom.id]?.active_players || 0) * newRoom.entry_fee
              }
            }));
         }
      }).subscribe();

    // Channel 2: Watch Cards (Player Count Ticker)
    const cardSub = supabase.channel('admin-cards')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bingo_cards' }, (payload) => {
         const card = payload.new as any;
         if (card.card_index !== null) {
            setActiveGames(prev => {
              const room = prev[card.room_id];
              if (!room) return prev;
              const newPlayers = room.active_players + 1;
              return {
                ...prev,
                [room.id]: { ...room, active_players: newPlayers, live_pot: newPlayers * room.entry_fee }
              };
            });
         }
      }).subscribe();

    // Channel 3: Watch Ledger (Deposits/Withdrawals)
    const txSub = supabase.channel('admin-txs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, () => {
         // Silently refresh ledger tables on new transaction
         fetchDashboardData(); 
      }).subscribe();

    return () => {
      supabase.removeChannel(roomSub);
      supabase.removeChannel(cardSub);
      supabase.removeChannel(txSub);
    };
  }, [isUnlocked, timeScale]);

  const timeAgo = (dateStr: string) => {
    const diff = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return `${Math.floor(diff / 1440)}d ago`;
  };

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (passInput === MASTER_PASSWORD) {
      setIsUnlocked(true);
    } else {
      setPassError(true);
      setTimeout(() => setPassError(false), 2000);
    }
  };

  const handleApprove = async (txId: string) => {
    if (!window.confirm("Mark this withdrawal as Approved and Paid?")) return;
    setProcessingTx(txId);
    try {
        const { error } = await supabase.from('transactions').update({ status: 'completed' }).eq('id', txId);
        if (error) throw error;
        setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
    } catch (err: any) {
        alert("Error approving transaction.");
    } finally {
        setProcessingTx(null);
    }
  };

  const handleReject = async (txId: string, userId: string, amount: number) => {
    if (!window.confirm(`Are you sure you want to REJECT and REFUND ${amount} ETB?`)) return;
    setProcessingTx(txId);
    try {
        const { error } = await supabase.rpc('admin_reject_withdrawal', {
            p_tx_id: txId.toString(),
            p_user_id: userId.toString(),
            p_amount: Number(amount)
        });
        if (error) throw error;
        setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
        alert(`✅ Refunded ${amount} ETB.`);
    } catch (err: any) {
        alert(`Failed to complete reject command.\n\nReason: ${err.message}`);
    } finally {
        setProcessingTx(null);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-mono">
        <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl w-full max-w-sm text-center shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
          <div className="w-16 h-16 bg-neutral-950 border border-neutral-800 rounded-full mx-auto mb-6 flex items-center justify-center shadow-inner">
            <span className="text-2xl opacity-80">🔐</span>
          </div>
          <h1 className="text-xl font-black tracking-widest text-white uppercase mb-2">Restricted Access</h1>
          <form onSubmit={handleUnlock} className="flex flex-col gap-4 mt-8">
            <input 
              type="password" 
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              placeholder="••••••••"
              className={`w-full bg-neutral-950 border ${passError ? 'border-red-500 text-red-500' : 'border-neutral-800 text-emerald-400'} rounded-xl px-4 py-3 text-center tracking-[0.3em] font-black focus:outline-none focus:border-emerald-500 transition-colors`}
              autoFocus
            />
            <button type="submit" className={`w-full py-3 rounded-xl font-black tracking-widest uppercase transition-all ${passError ? 'bg-red-500 text-white' : 'bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95'}`}>
              {passError ? 'DENIED' : 'DECRYPT'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 p-4 md:p-8 font-mono overflow-y-auto">
      <div className="max-w-6xl mx-auto space-y-8 pb-24">
        
        <header className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">CHELA COMMAND</h1>
            <p className="text-neutral-500 text-xs tracking-widest uppercase mt-1">Live Network Telemetry</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-emerald-500 text-[10px] font-black tracking-widest">WSS CONNECTED</span>
            </div>
            <button onClick={fetchDashboardData} disabled={isLoadingData} className="text-[10px] text-neutral-400 bg-neutral-900 border border-neutral-800 px-2 py-0.5 mt-1 rounded hover:bg-neutral-800 active:scale-95 transition-all">
              {isLoadingData ? 'SYNCING...' : '🔄 FORCE REFRESH'}
            </button>
          </div>
        </header>

        {/* TIME FILTERS (Now actively wired to queries) */}
        <div className="flex gap-2 bg-neutral-900/40 p-1 rounded-xl border border-neutral-800/80 w-max">
          {(['today', 'week', 'month', 'all'] as TimeScale[]).map((scale) => (
            <button key={scale} onClick={() => setTimeScale(scale)} className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${timeScale === scale ? 'bg-emerald-500 text-black shadow-md' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}>
              {scale}
            </button>
          ))}
        </div>

        {/* 🌍 GLOBAL TELEMETRY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden shadow-lg">
            <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,1)]"></div>
            <h3 className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mb-1">True House Profit</h3>
            <div className="text-4xl font-black text-white flex items-baseline gap-1">
              {trueProfit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} <span className="text-sm text-emerald-500">ETB</span>
            </div>
            <p className="text-emerald-400/60 text-[10px] mt-2 uppercase tracking-widest">20% cut from finished games</p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden shadow-lg">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
            <h3 className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mb-1">ETB In Circulation</h3>
            <div className="text-4xl font-black text-white flex items-baseline gap-1">
              {totalWallets.toLocaleString()} <span className="text-sm text-blue-500">ETB</span>
            </div>
            <p className="text-blue-400/60 text-[10px] mt-2 uppercase tracking-widest">Total player wallet balances</p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden shadow-lg">
            <div className="absolute top-0 left-0 w-full h-1 bg-orange-500 animate-pulse"></div>
            <h3 className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mb-1">Live Servers Online</h3>
            <div className="text-4xl font-black text-white flex items-baseline gap-1">
              {Object.keys(activeGames).length}
            </div>
            <p className="text-orange-400/60 text-[10px] mt-2 uppercase tracking-widest">Active & Waiting Rooms</p>
          </div>
        </div>

        {/* 🎮 LIVE BINGO SERVERS (Websocket Driven) */}
        {Object.keys(activeGames).length > 0 && (
          <section className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-sm font-black tracking-widest text-neutral-400 flex items-center gap-2 uppercase mb-4">
              <span className="text-blue-500 text-base animate-spin-slow">📡</span> Active Game Radar
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.values(activeGames).map((room) => (
                <div key={room.id} className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 relative overflow-hidden shadow-md">
                  <div className={`absolute left-0 top-0 w-1 h-full ${room.status === 'active' ? 'bg-orange-500' : 'bg-blue-500'}`}></div>
                  <div className="flex justify-between items-center border-b border-neutral-900 pb-2 mb-3">
                    <span className="text-[11px] font-bold text-white tracking-wider">ID: {room.id.substring(0, 8).toUpperCase()}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase border ${room.status === 'active' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20 animate-pulse' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                      {room.status}
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider">Locked Players:</span>
                      <span className="font-bold text-white font-mono">{room.active_players}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider">Live Pot:</span>
                      <span className="font-bold text-emerald-400 font-mono">{room.live_pot.toLocaleString()} ETB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider">Stake Tier:</span>
                      <span className="font-bold text-amber-500 font-mono">{room.entry_fee} ETB</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          
          {/* ⚡ PENDING WITHDRAWALS */}
          <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg flex flex-col h-[700px]">
            <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
                <span className="text-yellow-500">📤</span> WITHDRAWAL QUEUE
              </h2>
              <span className="bg-yellow-500/10 text-yellow-500 text-[10px] font-bold px-3 py-1.5 rounded border border-yellow-500/20 uppercase shadow-[0_0_10px_rgba(234,179,8,0.2)]">
                {pendingTxs.length} Pending
              </span>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 md:p-6 space-y-6 bg-[#0a0a0a]">
              {pendingTxs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500">
                    <span className="text-4xl mb-2 opacity-50">☕</span>
                    <span className="text-sm font-medium tracking-widest uppercase">All queues clear</span>
                </div>
              ) : (
                <AnimatePresence>
                  {pendingTxs.map((tx) => (
                    <motion.div key={tx.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: -50 }} 
                      className="bg-neutral-950 border border-neutral-800 rounded-xl flex flex-col relative overflow-hidden shadow-xl"
                    >
                      <div className="absolute left-0 top-0 w-1.5 h-full bg-gradient-to-b from-orange-400 to-yellow-600"></div>
                      
                      <div className="flex items-center justify-between p-4 border-b border-neutral-800/80 bg-neutral-900/50">
                        <div className="flex items-center gap-3">
                          <span className="text-orange-400 font-black text-3xl drop-shadow-md">{tx.amount.toLocaleString()} ETB</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] text-neutral-400 tracking-widest uppercase font-bold">{timeAgo(tx.created_at)}</span>
                            <span className="text-[9px] text-neutral-600 font-mono mt-1">TX: {tx.id.split('-')[0]}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
                        <div className="p-4 border-b sm:border-b-0 sm:border-r border-neutral-800/80 space-y-3 bg-neutral-950">
                          <div>
                            <p className="text-neutral-600 text-[9px] font-black uppercase tracking-widest mb-1">Player Identity</p>
                            <p className="font-bold text-white text-sm">{(tx.display_name && tx.display_name !== 'Unknown User') ? tx.display_name : tx.user_id}</p>
                          </div>
                          <div>
                            <p className="text-neutral-600 text-[9px] font-black uppercase tracking-widest mb-1">Phone Link</p>
                            <p className="text-blue-400 font-mono text-xs bg-blue-500/10 inline-block px-2 py-1 rounded border border-blue-500/20">{tx.phone || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-neutral-600 text-[9px] font-black uppercase tracking-widest mb-1">Telegram UID</p>
                            <p className="text-neutral-500 font-mono text-[10px] select-all">{tx.user_id}</p>
                          </div>
                        </div>

                        <div className="p-4 space-y-3 bg-neutral-900/20">
                            <div>
                                <p className="text-emerald-500/70 text-[9px] font-black uppercase tracking-widest mb-1">Target Bank</p>
                                <p className="font-bold text-emerald-400 text-sm">{tx.bank_name || 'Not Provided'}</p>
                            </div>
                            <div>
                                <p className="text-emerald-500/70 text-[9px] font-black uppercase tracking-widest mb-1">Account Name</p>
                                <p className="font-bold text-white text-xs">{tx.account_name || 'Not Provided'}</p>
                            </div>
                            <div>
                                <p className="text-emerald-500/70 text-[9px] font-black uppercase tracking-widest mb-1">Account Number</p>
                                <p className="text-emerald-300 font-mono text-sm bg-black px-3 py-1.5 rounded border border-emerald-500/30 select-all tracking-wider shadow-inner block w-max">
                                    {tx.account_number || 'N/A'}
                                </p>
                            </div>
                        </div>
                      </div>

                      <div className="p-4 bg-neutral-900 border-t border-neutral-800">
                        {processingTx === tx.id ? (
                          <div className="w-full text-center text-xs text-orange-400 font-bold animate-pulse py-3 bg-orange-500/10 rounded-lg border border-orange-500/20 tracking-widest uppercase">
                            Executing Database Command...
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button onClick={() => handleReject(tx.id, tx.user_id, tx.amount)} className="flex-1 py-3 rounded-lg bg-[#1a0505] text-red-500 border border-red-900 hover:bg-red-500 hover:text-white transition-all font-black text-[11px] uppercase tracking-widest">
                              Reject & Refund
                            </button>
                            <button onClick={() => handleApprove(tx.id)} className="flex-[2] py-3 rounded-lg bg-emerald-500 text-black border border-emerald-400 hover:bg-emerald-400 transition-all font-black text-[11px] uppercase tracking-widest shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                              Mark as Paid
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </section>

          {/* 📥 COMPLETED DEPOSITS */}
          <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg flex flex-col h-[700px]">
            <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
                <span className="text-emerald-500">📥</span> DEPOSITS LOG
              </h2>
              <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-3 py-1.5 rounded border border-emerald-500/20 uppercase shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                {timeScale.toUpperCase()}
              </span>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 md:p-6 space-y-4 bg-[#0a0a0a]">
              {recentDeposits.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500">
                    <span className="text-4xl mb-2 opacity-50">📭</span>
                    <span className="text-sm font-medium tracking-widest uppercase">No data found</span>
                </div>
              ) : (
                recentDeposits.map((tx) => (
                    <div key={tx.id} className="bg-neutral-950 border border-neutral-800/80 p-4 rounded-xl flex flex-col gap-3 relative overflow-hidden group">
                      <div className="absolute left-0 top-0 w-1 h-full bg-emerald-500/30 group-hover:bg-emerald-500 transition-colors"></div>
                      
                      <div className="flex items-center justify-between border-b border-neutral-800/50 pb-2">
                        <div className="text-emerald-400 font-black text-xl drop-shadow-sm">+{tx.amount.toLocaleString()} ETB</div>
                        <div className="text-right flex flex-col items-end">
                          <div className="text-[10px] text-neutral-400 tracking-widest uppercase font-bold">{timeAgo(tx.created_at)}</div>
                          <div className="text-[9px] px-1.5 py-0.5 rounded mt-1 font-black tracking-widest border bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                            VERIFIED
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-end justify-between">
                         <div className="flex flex-col">
                             <span className="text-neutral-500 text-[9px] font-black uppercase tracking-widest mb-0.5">Credited To</span>
                             <span className="text-sm text-white font-bold">{(tx.display_name && tx.display_name !== 'Unknown User') ? tx.display_name : tx.user_id}</span>
                         </div>
                         <div className="text-xs font-mono text-neutral-400 bg-neutral-900/60 px-2 py-1 rounded border border-neutral-800/50">
                             {tx.phone || 'No Phone'}
                         </div>
                      </div>
                    </div>
                ))
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}