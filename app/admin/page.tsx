'use client';

import React, { useEffect, useState } from 'react';
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

interface AdminStats {
  total_profit: number;
  total_wallets: number;
  active_rooms: number;
}

interface UserLookup {
  display_name: string | null;
  phone: string | null;
}

interface LiveBingoGame {
  id: string;
  status: string;
  players_count?: number;
  player_count?: number;
  pot_size?: number;
  pot?: number;
  ticket_price?: number;
  price?: number;
}

// 🛡️ Strict Database Types to satisfy Vercel Build
interface DBTransaction {
  id: string;
  user_id: string | number;
  amount: number;
  tx_type: string;
  status: string;
  created_at: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
}

interface DBUser {
  tg_id: string | number;
  display_name: string | null;
  phone: string | null;
}

export default function AdminDashboard() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState(false);

  const [timeScale, setTimeScale] = useState<TimeScale>('today');
  const [macroStats, setMacroStats] = useState<AdminStats | null>(null);
  
  const [pendingTxs, setPendingTxs] = useState<EnrichedTransaction[]>([]);
  const [recentDeposits, setRecentDeposits] = useState<EnrichedTransaction[]>([]);
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activeGames, setActiveGames] = useState<any[]>([]);
  
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [processingTx, setProcessingTx] = useState<string | null>(null);

  // 📊 DIRECT SUPABASE FETCH ENGINE
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
      // Fetch Macro Stats safely
      const { data: globalData, error: globalErr } = await supabase.rpc('get_admin_stats');
      if (!globalErr && globalData) {
          setMacroStats(globalData as AdminStats);
      }

      // 1. Fetch ALL Pending Withdrawals Directly
      const { data: pendingWithdrawalsData, error: pendingErr } = await supabase
          .from('transactions')
          .select('*')
          .eq('tx_type', 'withdrawal')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

      if (pendingErr) console.error("Error fetching pending txs:", pendingErr);

      // 2. Fetch Completed Ledger Items (Deposits, Refunds, Admin Credits)
      const { data: completedDepositsData } = await supabase
          .from('transactions')
          .select('*')
          .in('tx_type', ['deposit', 'refund', 'admin_credit'])
          .eq('status', 'completed')
          .gt('amount', 0) // Prevents old broken negative test records from loading
          .order('created_at', { ascending: false })
          .limit(100);

      // 3. Fetch Active Bingo Games
      const { data: gamesData } = await supabase
          .from('bingo_rooms')
          .select('*')
          .in('status', ['waiting', 'active', 'playing', 'open']);
      
      if (gamesData) {
          setActiveGames(gamesData);
      }

      // 4. Fetch User Details to map names and phones
      const { data: usersData } = await supabase
          .from('tg_users')
          .select('tg_id, display_name, phone');

      // Create a fast lookup map strictly typed
      const userMap: Record<string, UserLookup> = {};
      if (usersData) {
          (usersData as DBUser[]).forEach((user) => {
              if (user.tg_id) {
                userMap[user.tg_id.toString().trim()] = {
                  display_name: user.display_name,
                  phone: user.phone
                };
              }
          });
      }

      // Enrich the withdrawals
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichedWithdrawals = ((pendingWithdrawalsData as DBTransaction[]) || []).map((tx: any) => {
          const lookupId = tx.user_id ? tx.user_id.toString().trim() : '';
          const match = userMap[lookupId];
          return {
              ...tx,
              display_name: match?.display_name || `User (${tx.user_id})`,
              phone: match?.phone || 'No Phone'
          } as EnrichedTransaction;
      });

      // Enrich the deposits AND strictly filter out test data under 50 ETB visually
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichedDeposits = ((completedDepositsData as DBTransaction[]) || [])
          .filter((tx) => {
              if (tx.tx_type === 'deposit' && tx.amount < 50) return false;
              return true;
          })
          .map((tx: any) => {
              const lookupId = tx.user_id ? tx.user_id.toString().trim() : '';
              const match = userMap[lookupId];
              return {
                  ...tx,
                  display_name: match?.display_name || `User (${tx.user_id})`,
                  phone: match?.phone || 'No Phone'
              } as EnrichedTransaction;
          });

      setPendingTxs(enrichedWithdrawals);
      setRecentDeposits(enrichedDeposits);

    } catch (err) {
      const error = err as Error;
      console.error("Dashboard Sync Failed Entirely:", error.message);
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 15000); 
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 🚀 DIRECT APPROVAL LOGIC
  const handleApprove = async (txId: string) => {
    if (!window.confirm("Mark this withdrawal as Approved and Paid?")) return;
    setProcessingTx(txId);
    try {
        const { error } = await supabase
            .from('transactions')
            .update({ status: 'completed' })
            .eq('id', txId);
            
        if (error) throw error;
        
        setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
        await fetchDashboardData();
    } catch (err) {
        const error = err as Error;
        console.error("Approval Failed:", error.message);
        alert("Error approving transaction. Check network status.");
    } finally {
        setProcessingTx(null);
    }
  };

  // 🚀 BULLETPROOF REJECT & FULL REFUND LOGIC
  const handleReject = async (txId: string, userId: string, amount: number) => {
    if (!window.confirm(`Are you sure you want to REJECT this transaction and REFUND ${amount} ETB to the user's wallet?`)) return;
    setProcessingTx(txId);

    try {
        const { error } = await supabase.rpc('admin_reject_withdrawal', {
            p_tx_id: txId.toString(),
            p_user_id: userId.toString(),
            p_amount: Number(amount)
        });

        if (error) throw error;

        setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
        alert(`✅ Success! Refunded ${amount} ETB back to user.`);
        await fetchDashboardData();

    } catch (err) {
        const error = err as Error;
        console.error("CRITICAL REJECT AND REFUND CANCELED:", error.message);
        alert(`Failed to complete reject command.\n\nReason: ${error.message || 'Check database schema alignment.'}`);
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
          <p className="text-neutral-500 text-xs mb-8">Enter authorization code to proceed.</p>
          <form onSubmit={handleUnlock} className="flex flex-col gap-4">
            <input 
              type="password" 
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              placeholder="••••••••"
              className={`w-full bg-neutral-950 border ${passError ? 'border-red-500 text-red-500' : 'border-neutral-800 text-emerald-400'} rounded-xl px-4 py-3 text-center tracking-[0.3em] font-black focus:outline-none focus:border-emerald-500 transition-colors`}
              autoFocus
            />
            <button 
              type="submit"
              className={`w-full py-3 rounded-xl font-black tracking-widest uppercase transition-all ${passError ? 'bg-red-500 text-white' : 'bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95'}`}
            >
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
        
        {/* Header */}
        <header className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div>
            <h1 className="text-3xl font-black tracking-tighter text-emerald-400 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">CHELA COMMAND</h1>
            <p className="text-neutral-500 text-xs tracking-widest uppercase mt-1">Live Network Telemetry</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-emerald-500 text-[10px] font-black tracking-widest">SYSTEM ONLINE</span>
            </div>
            <button onClick={fetchDashboardData} disabled={isLoadingData} className="text-[10px] text-neutral-400 bg-neutral-900 border border-neutral-800 px-2 py-0.5 mt-1 rounded hover:bg-neutral-800 active:scale-95 transition-all">
              {isLoadingData ? 'SYNCING...' : '🔄 FORCE REFRESH'}
            </button>
          </div>
        </header>

        {/* 🌍 GLOBAL TELEMETRY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
            <h3 className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mb-1">Total House Profit</h3>
            <div className="text-4xl font-black text-white flex items-baseline gap-1">
              {macroStats?.total_profit?.toLocaleString() || '0'} <span className="text-sm text-emerald-500">ETB</span>
            </div>
            <p className="text-emerald-400/60 text-[10px] mt-2 uppercase tracking-widest">All-time collected Derash</p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
            <h3 className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mb-1">ETB In Circulation</h3>
            <div className="text-4xl font-black text-white flex items-baseline gap-1">
              {macroStats?.total_wallets?.toLocaleString() || '0'} <span className="text-sm text-blue-500">ETB</span>
            </div>
            <p className="text-blue-400/60 text-[10px] mt-2 uppercase tracking-widest">Active balances across all users</p>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-orange-500"></div>
            <h3 className="text-neutral-400 text-[10px] font-black uppercase tracking-widest mb-1">Active Servers</h3>
            <div className="text-4xl font-black text-white flex items-baseline gap-1">
              {macroStats?.active_rooms || '0'}
            </div>
            <p className="text-orange-400/60 text-[10px] mt-2 uppercase tracking-widest">Games playing or waiting</p>
          </div>
        </div>

        {/* 🎮 LIVE BINGO SERVERS INTERFACE GRID */}
        {activeGames.length > 0 && (
          <section className="bg-neutral-900/40 border border-neutral-800 rounded-2xl p-6 shadow-xl">
            <h2 className="text-sm font-black tracking-widest text-neutral-400 flex items-center gap-2 uppercase mb-4">
              <span className="text-blue-500 text-base">🎰</span> Live Active Game Environments
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeGames.map((room) => (
                <div key={room.id} className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 relative overflow-hidden shadow-md">
                  <div className="absolute left-0 top-0 w-1 h-full bg-blue-500"></div>
                  <div className="flex justify-between items-center border-b border-neutral-900 pb-2 mb-3">
                    <span className="text-[11px] font-bold text-white tracking-wider">Room: {room.id.substring(0, 8).toUpperCase()}</span>
                    <span className="text-[9px] font-black bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded uppercase border border-blue-500/20">{room.status}</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider">Players Joined:</span>
                      <span className="font-bold text-white font-mono">{room.players_count ?? room.player_count ?? 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider">Accumulated Pot:</span>
                      <span className="font-bold text-emerald-400 font-mono">{room.pot_size ?? room.pot ?? 0} ETB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500 text-[10px] uppercase font-bold tracking-wider">Ticket Stake:</span>
                      <span className="font-bold text-amber-500 font-mono">{room.ticket_price ?? room.price ?? 0} ETB</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Time filters */}
        <div className="flex gap-2 bg-neutral-900/40 p-1 rounded-xl border border-neutral-800/80 w-max">
          {(['today', 'week', 'month', 'all'] as TimeScale[]).map((scale) => (
            <button key={scale} onClick={() => setTimeScale(scale)} className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${timeScale === scale ? 'bg-emerald-500 text-black shadow-md' : 'text-neutral-400 hover:text-white'}`}>
              {scale}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          
          {/* ⚡ WITHDRAWALS: Detailed Action Queue */}
          <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg flex flex-col h-[700px]">
            <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
                <span className="text-yellow-500">📤</span> WITHDRAWAL REQUESTS
              </h2>
              <span className="bg-yellow-500/10 text-yellow-500 text-[10px] font-bold px-3 py-1.5 rounded border border-yellow-500/20 uppercase shadow-[0_0_10px_rgba(234,179,8,0.2)]">
                {pendingTxs.length} Pending Action
              </span>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 md:p-6 space-y-6 custom-scrollbar bg-[#0a0a0a]">
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
                      <div className="absolute left-0 top-0 w-1.5 h-full bg-gradient-to-b from-orange-400 to-yellow-600 shadow-[0_0_15px_rgba(249,115,22,0.5)]"></div>
                      
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
                                <p className="text-emerald-500/70 text-[9px] font-black uppercase tracking-widest mb-1">Account Number (Select to copy)</p>
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

          {/* 📥 SUCCESSFUL DEPOSITS */}
          <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg flex flex-col h-[700px]">
            <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
                <span className="text-emerald-500">📥</span> SUCCESSFUL DEPOSITS
              </h2>
              <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-3 py-1.5 rounded border border-emerald-500/20 uppercase shadow-[0_0_10px_rgba(16,185,129,0.2)]">
                Last 100
              </span>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 md:p-6 space-y-4 custom-scrollbar bg-[#0a0a0a]">
              {recentDeposits.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500">
                    <span className="text-4xl mb-2 opacity-50">📭</span>
                    <span className="text-sm font-medium tracking-widest uppercase">No recent deposits</span>
                </div>
              ) : (
                recentDeposits.map((tx) => {
                  
                  // Dynamic Color Formatting Rules
                  const isRefund = tx.tx_type === 'refund';
                  const isAdminCredit = tx.tx_type === 'admin_credit';
                  
                  let textColor = "text-emerald-400";
                  let sidebarColor = "bg-emerald-500/30 group-hover:bg-emerald-500";
                  let badgeBg = "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
                  let badgeText = "API AUTOMATED";
                  let containerBg = "bg-neutral-950 border-neutral-800/80";
                  let providerText = tx.bank_name || "TELEBIRR"; // Fallback for old data

                  if (isRefund) {
                      textColor = "text-purple-400";
                      sidebarColor = "bg-purple-500";
                      badgeBg = "bg-purple-500 text-white border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.4)]";
                      badgeText = "💳 SYSTEM REFUND";
                      containerBg = "bg-purple-950/20 border-purple-500/30";
                      providerText = "INTERNAL WALLET";
                  } else if (isAdminCredit) {
                      textColor = "text-blue-400";
                      sidebarColor = "bg-blue-500/30 group-hover:bg-blue-500";
                      badgeBg = "bg-blue-500/10 text-blue-400 border-blue-500/20";
                      badgeText = "MANUAL CREDIT";
                  }

                  const displayAmount = Math.abs(tx.amount).toLocaleString();

                  return (
                    <div key={tx.id} className={`${containerBg} border p-4 rounded-xl flex flex-col gap-3 transition-colors relative overflow-hidden group`}>
                      <div className={`absolute left-0 top-0 w-1 h-full ${sidebarColor} transition-colors`}></div>
                      
                      <div className="flex items-center justify-between border-b border-neutral-800/50 pb-2">
                        <div className={`${textColor} font-black text-xl drop-shadow-sm`}>+{displayAmount} ETB</div>
                        <div className="text-right flex flex-col items-end">
                          <div className="text-[10px] text-neutral-400 tracking-widest uppercase font-bold">{timeAgo(tx.created_at)}</div>
                          <div className={`text-[9px] px-1.5 py-0.5 rounded mt-1 font-black tracking-widest border ${badgeBg}`}>
                            {badgeText}
                          </div>
                          <div className="text-[9px] text-neutral-500 font-bold uppercase tracking-widest mt-1">
                            VIA: {providerText}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-end justify-between">
                         <div className="flex flex-col">
                             <span className="text-neutral-500 text-[9px] font-black uppercase tracking-widest mb-0.5">Credited To</span>
                             <span className="text-sm text-white font-bold">{(tx.display_name && tx.display_name !== 'Unknown User') ? tx.display_name : tx.user_id}</span>
                         </div>
                         <div className="text-xs font-mono text-neutral-400 bg-neutral-900/60 px-2 py-1 rounded border border-neutral-800/50">
                             {tx.phone || 'No Phone Linked'}
                         </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

        </div>

      </div>
    </div>
  );
}