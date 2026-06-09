'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';

<<<<<<< HEAD
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import supabase from '@/lib/supabaseClient';

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

export default function AdminDashboard() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState(false);

  const [timeScale, setTimeScale] = useState<TimeScale>('today');
  const [macroStats, setMacroStats] = useState<AdminStats | null>(null);
  
  const [pendingTxs, setPendingTxs] = useState<EnrichedTransaction[]>([]);
  const [recentDeposits, setRecentDeposits] = useState<EnrichedTransaction[]>([]);
  
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
      if (!globalErr && globalData) setMacroStats(globalData as AdminStats);

      // 1. Fetch Pending Withdrawals Directly
      const { data: pendingWithdrawalsData, error: pendingErr } = await supabase
          .from('transactions')
          .select('*')
          .eq('tx_type', 'withdrawal')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });

      if (pendingErr) console.error("Error fetching pending txs:", pendingErr);

      // 2. Fetch Completed Deposits Directly (Linked to TimeScale)
      const { data: completedDepositsData } = await supabase
          .from('transactions')
          .select('*')
          .eq('tx_type', 'deposit')
          .eq('status', 'completed')
          .gte('created_at', isoStart)
          .order('created_at', { ascending: false })
          .limit(100);

      // 3. Fetch User Details to map names and phones
      const { data: usersData } = await supabase
          .from('tg_users')
          .select('tg_id, display_name, phone');

      // Create a fast lookup map strictly typed to avoid Vercel build failures
      const userMap: Record<string, UserLookup> = {};
      if (usersData) {
          usersData.forEach(user => {
              if (user.tg_id) {
                userMap[user.tg_id.toString()] = {
                  display_name: user.display_name,
                  phone: user.phone
                };
              }
          });
      }

      // Enrich the transactions with User Data safely
      const enrichedWithdrawals = (pendingWithdrawalsData || []).map(tx => {
          const lookupId = tx.user_id ? tx.user_id.toString() : '';
          const match = userMap[lookupId];
          return {
              ...tx,
              display_name: match?.display_name || 'Unknown User',
              phone: match?.phone || 'No Phone'
          };
      });

      const enrichedDeposits = (completedDepositsData || []).map(tx => {
          const lookupId = tx.user_id ? tx.user_id.toString() : '';
          const match = userMap[lookupId];
          return {
              ...tx,
              display_name: match?.display_name || 'Unknown User',
              phone: match?.phone || 'No Phone'
          };
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
        
        // Instant visual update instead of waiting for next sync interval
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
        const numericUserId = isNaN(Number(userId)) ? null : Number(userId);
        const searchId = numericUserId !== null ? numericUserId : userId;

        // 1. Fetch current user balance accurately
        const { data: userData, error: userErr } = await supabase
            .from('tg_users')
            .select('balance')
            .eq('tg_id', searchId)
            .single();

        if (userErr) throw userErr;
        if (!userData) throw new Error(`User with Telegram ID ${userId} does not exist.`);

        // 2. Process math explicitly
        const currentBalance = Number(userData.balance) || 0;
        const refundAmount = Number(amount) || 0;
        const newBalance = currentBalance + refundAmount;

        // 3. Update the user's balance safely
        const { error: refundErr } = await supabase
            .from('tg_users')
            .update({ balance: newBalance })
            .eq('tg_id', searchId);

        if (refundErr) throw refundErr;

        // 4. Mark transaction status as rejected
        const { error: txErr } = await supabase
            .from('transactions')
            .update({ status: 'rejected' })
            .eq('id', txId);

        if (txErr) throw txErr;

        setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
        alert(`✅ Success! Refunded ${refundAmount} ETB back to user.`);
        await fetchDashboardData();

    } catch (err) {
        const error = err as Error;
        console.error("CRITICAL COMMAND CANCELED:", error.message);
        alert(`Failed to complete reject command.\n\nReason: ${error.message || 'Check database permissions.'}`);
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
=======
export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0f1117] text-gray-900 dark:text-white flex flex-col items-center justify-center relative overflow-hidden transition-colors duration-500">
>>>>>>> parent of 09c9813 (Update page.tsx)

      {/* Animated background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,230,118,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,230,118,0.08)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(0,230,118,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,230,118,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

<<<<<<< HEAD
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
                      {/* Accent Strip */}
                      <div className="absolute left-0 top-0 w-1.5 h-full bg-gradient-to-b from-orange-400 to-yellow-600 shadow-[0_0_15px_rgba(249,115,22,0.5)]"></div>
                      
                      {/* Top Bar */}
                      <div className="flex items-center justify-between p-4 border-b border-neutral-800/80 bg-neutral-900/50">
                        <div className="flex items-center gap-3">
                          <span className="text-orange-400 font-black text-3xl drop-shadow-md">{tx.amount.toLocaleString()} ETB</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] text-neutral-400 tracking-widest uppercase font-bold">{timeAgo(tx.created_at)}</span>
                            <span className="text-[9px] text-neutral-600 font-mono mt-1">TX: {tx.id.split('-')[0]}</span>
                        </div>
                      </div>

                      {/* Main Content Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
                        
                        {/* Left Column: Player Identity */}
                        <div className="p-4 border-b sm:border-b-0 sm:border-r border-neutral-800/80 space-y-3 bg-neutral-950">
                          <div>
                            <p className="text-neutral-600 text-[9px] font-black uppercase tracking-widest mb-1">Player Identity</p>
                            <p className="font-bold text-white text-sm">{tx.display_name || 'Unknown'}</p>
                          </div>
                          <div>
                            <p className="text-neutral-600 text-[9px] font-black uppercase tracking-widest mb-1">Phone Link</p>
                            <p className="text-blue-400 font-mono text-xs bg-blue-500/10 inline-block px-2 py-1 rounded border border-blue-500/20">{tx.phone || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-neutral-600 text-[9px] font-black uppercase tracking-widest mb-1">Telegram UID</p>
                            <p className="text-neutral-500 font-mono text-[10px]">{tx.user_id}</p>
                          </div>
                        </div>

                        {/* Right Column: Banking Details */}
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

                      {/* Action Buttons Footer */}
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

          {/* 📥 DEPOSITS: Detailed Settled Ledger */}
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
                recentDeposits.map((tx) => (
                  <div key={tx.id} className="bg-neutral-950 border border-neutral-800/80 p-4 rounded-xl flex flex-col gap-3 hover:border-emerald-500/40 transition-colors relative overflow-hidden group">
                    <div className="absolute left-0 top-0 w-1 h-full bg-emerald-500/30 group-hover:bg-emerald-500 transition-colors"></div>
                    
                    <div className="flex items-center justify-between border-b border-neutral-800/50 pb-2">
                      <div className="text-emerald-400 font-black text-xl drop-shadow-sm">+{tx.amount.toLocaleString()} ETB</div>
                      <div className="text-right flex flex-col items-end">
                        <div className="text-[10px] text-neutral-400 tracking-widest uppercase font-bold">{timeAgo(tx.created_at)}</div>
                        <div className="text-[9px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded mt-1 font-black tracking-widest border border-emerald-500/20">API AUTOMATED</div>
                      </div>
                    </div>
                    
                    <div className="flex items-end justify-between">
                       <div className="flex flex-col">
                           <span className="text-neutral-500 text-[9px] font-black uppercase tracking-widest mb-0.5">Credited To</span>
                           <span className="text-sm text-white font-bold">{tx.display_name || tx.user_id}</span>
                       </div>
                       <div className="text-xs font-mono text-blue-400 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/20">
                           {tx.phone || 'No Phone Linked'}
                       </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

        </div>

=======
      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00e676]/10 dark:bg-[#00e676]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 dark:bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16 relative z-10"
      >
        <h1 className="text-5xl font-black tracking-tight mb-3 text-gray-900 dark:text-white">
          TURBO<span className="text-[#00e676]">PLAY</span>
        </h1>
        <p className="text-gray-500 dark:text-[#888] text-lg">Choose your game and start winning</p>
      </motion.div>

      {/* Game Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-6 w-full max-w-3xl relative z-10">

        {/* ── BETTING CARD ── */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Link href="/betting" className="group block">
            <div className="relative bg-white dark:bg-[#1a1d23] border border-gray-200 dark:border-[#2a2d35] rounded-2xl p-8 h-72 flex flex-col justify-between overflow-hidden shadow-xl shadow-gray-200/50 dark:shadow-none transition-all duration-300 group-hover:border-[#00e676]/50 group-hover:shadow-[0_0_40px_rgba(0,230,118,0.15)] dark:group-hover:shadow-[0_0_40px_rgba(0,230,118,0.1)]">
              {/* Background icon */}
              <div className="absolute -right-6 -bottom-6 text-[120px] opacity-10 dark:opacity-5 text-gray-900 dark:text-white select-none">⚽</div>

              <div>
                <div className="w-14 h-14 bg-[#00e676]/15 dark:bg-[#00e676]/10 rounded-xl flex items-center justify-center mb-5 group-hover:bg-[#00e676]/25 dark:group-hover:bg-[#00e676]/20 transition-colors">
                  <span className="text-3xl">⚽</span>
                </div>
                <h2 className="text-2xl font-black mb-2 text-gray-900 dark:text-white">Sports Betting</h2>
                <p className="text-gray-600 dark:text-[#888] text-sm leading-relaxed">
                  Live odds on today's fixtures. Place singles or accumulators on football matches worldwide.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <span className="text-[10px] bg-[#00e676]/15 dark:bg-[#00e676]/10 text-[#00b35c] dark:text-[#00e676] px-2 py-1 rounded-full font-bold uppercase tracking-wider">Live Odds</span>
                  <span className="text-[10px] bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#888] px-2 py-1 rounded-full font-bold uppercase tracking-wider">Accumulators</span>
                </div>
                <span className="text-[#00b35c] dark:text-[#00e676] font-bold text-sm group-hover:translate-x-1 transition-transform inline-block">
                  Play →
                </span>
              </div>
            </div>
          </Link>
        </motion.div>

        {/* ── BINGO CARD ── */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Link href="/bingo" className="group block">
            <div className="relative bg-white dark:bg-[#1a1d23] border border-gray-200 dark:border-[#2a2d35] rounded-2xl p-8 h-72 flex flex-col justify-between overflow-hidden shadow-xl shadow-gray-200/50 dark:shadow-none transition-all duration-300 group-hover:border-purple-500/50 group-hover:shadow-[0_0_40px_rgba(168,85,247,0.15)] dark:group-hover:shadow-[0_0_40px_rgba(168,85,247,0.1)]">
              {/* Background icon */}
              <div className="absolute -right-6 -bottom-6 text-[120px] opacity-10 dark:opacity-5 text-gray-900 dark:text-white select-none">🎱</div>

              <div>
                <div className="w-14 h-14 bg-purple-500/15 dark:bg-purple-500/10 rounded-xl flex items-center justify-center mb-5 group-hover:bg-purple-500/25 dark:group-hover:bg-purple-500/20 transition-colors">
                  <span className="text-3xl">🎱</span>
                </div>
                <h2 className="text-2xl font-black mb-2 text-gray-900 dark:text-white">
                  Wana <span className="text-purple-600 dark:text-purple-400">Bingo</span>
                </h2>
                <p className="text-gray-600 dark:text-[#888] text-sm leading-relaxed">
                  1v1 multiplayer 75-ball bingo. Join a room, daub your card, and shout BINGO to win the pot.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <span className="text-[10px] bg-purple-500/15 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2 py-1 rounded-full font-bold uppercase tracking-wider">Multiplayer</span>
                  <span className="text-[10px] bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#888] px-2 py-1 rounded-full font-bold uppercase tracking-wider">75-Ball</span>
                </div>
                <span className="text-purple-600 dark:text-purple-400 font-bold text-sm group-hover:translate-x-1 transition-transform inline-block">
                  Play →
                </span>
              </div>
            </div>
          </Link>
        </motion.div>
>>>>>>> parent of 09c9813 (Update page.tsx)
      </div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-16 text-gray-400 dark:text-[#444] text-xs relative z-10"
      >
        TurboPlay · Play responsibly · 18+
      </motion.p>
    </div>
  );
}