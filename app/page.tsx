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
  bank_name?: string;       // Added new bank detail field
  account_name?: string;    // Added new bank detail field
  account_number?: string;  // Added new bank detail field
}

interface DashboardStats {
  deposits: number;
  withdrawals: number;
  gamesHosted: number;
  netFlow: number;
}

interface AdminStats {
  total_profit: number;
  total_wallets: number;
  active_rooms: number;
}

export default function AdminDashboard() {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState(false);

  const [timeScale, setTimeScale] = useState<TimeScale>('today');
  const [stats, setStats] = useState<DashboardStats>({ deposits: 0, withdrawals: 0, gamesHosted: 0, netFlow: 0 });
  const [macroStats, setMacroStats] = useState<AdminStats | null>(null);
  
  const [pendingTxs, setPendingTxs] = useState<EnrichedTransaction[]>([]);
  const [recentDeposits, setRecentDeposits] = useState<EnrichedTransaction[]>([]);
  
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [processingTx, setProcessingTx] = useState<string | null>(null);

  // 📊 THE HYBRID ANALYTICS ENGINE
  useEffect(() => {
    if (!isUnlocked) return; 

    const fetchDashboardData = async () => {
      setIsLoadingData(true);
      
      const now = new Date();
      let startDate = new Date(0); 
      if (timeScale === 'today') startDate = new Date(now.setHours(0,0,0,0));
      if (timeScale === 'week') startDate = new Date(now.setDate(now.getDate() - 7));
      if (timeScale === 'month') startDate = new Date(now.setDate(now.getDate() - 30));
      const isoStart = startDate.toISOString();

      try {
        // Fetch Macro Stats
        const { data: globalData } = await supabase.rpc('get_admin_stats');
        if (globalData) setMacroStats(globalData as AdminStats);

        // Fetch Secure Enriched Transactions (Bypasses RLS)
        const { data: txDataRpc } = await supabase.rpc('get_admin_transactions');
        if (txDataRpc) {
          setPendingTxs(txDataRpc.pending_withdrawals);
          setRecentDeposits(txDataRpc.recent_deposits);
        }

        // Fetch Time-Scaled Metrics
        const { data: txData } = await supabase
          .from('transactions')
          .select('amount, tx_type')
          .gte('created_at', isoStart)
          .eq('status', 'completed');

        const { count: gamesCount } = await supabase
          .from('bingo_rooms')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', isoStart);

        let deposits = 0;
        let withdrawals = 0;

        txData?.forEach(tx => {
          if (tx.tx_type === 'deposit') deposits += Number(tx.amount);
          if (tx.tx_type === 'withdrawal') withdrawals += Number(tx.amount);
        });

        setStats({
          deposits,
          withdrawals,
          gamesHosted: gamesCount || 0,
          netFlow: deposits - withdrawals
        });

      } catch (err) {
        console.error("Dashboard Sync Failed:", err);
      } finally {
        setIsLoadingData(false);
      }
    };

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

  // 🚀 SECURE ACTION HANDLERS
  const handleApprove = async (txId: string) => {
    setProcessingTx(txId);
    await supabase.rpc('admin_approve_withdrawal', { p_tx_id: txId });
    setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
    setProcessingTx(null);
  };

  const handleReject = async (txId: string, userId: string, amount: number) => {
    if (!window.confirm("Reject this withdrawal and refund the user's wallet?")) return;
    setProcessingTx(txId);
    await supabase.rpc('admin_reject_withdrawal', {
        p_tx_id: txId,
        p_user_id: userId,
        p_amount: amount
    });
    setPendingTxs(prev => prev.filter(tx => tx.id !== txId));
    setProcessingTx(null);
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
            <span className="text-[9px] text-neutral-600 tracking-widest">AUTHORIZED DEVICE</span>
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* ⚡ WITHDRAWALS: Action Queue */}
          <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg flex flex-col h-[600px]">
            <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
                <span className="text-yellow-500">📤</span> WITHDRAWALS
              </h2>
              <span className="bg-yellow-500/10 text-yellow-500 text-[10px] font-bold px-2 py-1 rounded border border-yellow-500/20 uppercase">
                {pendingTxs.length} Pending
              </span>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 space-y-4 custom-scrollbar">
              {pendingTxs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-neutral-500 text-sm font-medium">All queues clear. No pending requests.</div>
              ) : (
                <AnimatePresence>
                  {pendingTxs.map((tx) => (
                    <motion.div key={tx.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -10 }} 
                      className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl flex flex-col gap-4 relative overflow-hidden shadow-md"
                    >
                      {/* Decorative accent strip */}
                      <div className="absolute left-0 top-0 w-1 h-full bg-orange-500/50"></div>
                      
                      {/* Top Row: Amount & Time */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-neutral-800/50 pb-3">
                        <div className="flex items-center gap-3">
                          <span className="text-orange-400 font-black text-2xl">{tx.amount.toLocaleString()} ETB</span>
                          <span className="bg-neutral-900 text-neutral-400 text-[10px] tracking-widest uppercase px-2 py-1 rounded-md">{timeAgo(tx.created_at)}</span>
                        </div>
                        <div className="text-[10px] text-neutral-500 font-mono">
                          ID: {tx.user_id}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Player Details Box */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-neutral-500 text-[10px] uppercase tracking-widest w-16">Player:</span>
                            <span className="font-bold text-white text-sm">{tx.display_name || 'Unknown'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-neutral-500 text-[10px] uppercase tracking-widest w-16">Phone:</span>
                            <span className="text-blue-400 font-mono text-xs">{tx.phone || 'N/A'}</span>
                          </div>
                        </div>

                        {/* Beautiful Banking Details Box */}
                        <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 space-y-2 shadow-inner">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-500/70 text-[10px] uppercase tracking-widest w-16">Bank:</span>
                            <span className="font-bold text-emerald-400 text-xs">{tx.bank_name || 'Not provided'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-500/70 text-[10px] uppercase tracking-widest w-16">Name:</span>
                            <span className="font-bold text-white text-xs">{tx.account_name || 'Not provided'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-500/70 text-[10px] uppercase tracking-widest w-16">Account:</span>
                            <span className="text-white font-mono bg-black px-1.5 py-0.5 rounded text-xs">{tx.account_number || 'Not provided'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 w-full pt-2 border-t border-neutral-800/50">
                        {processingTx === tx.id ? (
                          <div className="w-full text-center text-xs text-emerald-500 font-bold animate-pulse py-2 bg-emerald-500/10 rounded border border-emerald-500/20">Processing Transaction...</div>
                        ) : (
                          <>
                            <button onClick={() => handleApprove(tx.id)} className="flex-1 py-3 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500 hover:text-black transition-all font-black text-[11px] uppercase tracking-widest shadow-[0_0_10px_rgba(16,185,129,0.1)]">
                              Approve Payment
                            </button>
                            <button onClick={() => handleReject(tx.id, tx.user_id, tx.amount)} className="flex-1 py-3 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all font-black text-[11px] uppercase tracking-widest shadow-[0_0_10px_rgba(239,68,68,0.1)]">
                              Reject & Refund
                            </button>
                          </>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </section>

          {/* 📥 DEPOSITS: Settled Ledger */}
          <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg flex flex-col h-[600px]">
            <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
                <span className="text-emerald-500">📥</span> DEPOSIT LEDGER
              </h2>
              <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-2 py-1 rounded border border-emerald-500/20 uppercase">
                Last 100
              </span>
            </div>
            
            <div className="overflow-y-auto flex-1 p-4 space-y-3 custom-scrollbar">
              {recentDeposits.length === 0 ? (
                <div className="flex items-center justify-center h-full text-neutral-500 text-sm font-medium">No recent deposit activity.</div>
              ) : (
                recentDeposits.map((tx) => (
                  <div key={tx.id} className="bg-neutral-950/50 border border-neutral-800/50 p-3 rounded-lg flex items-center justify-between hover:border-neutral-700 transition-colors">
                    <div>
                      <div className="text-emerald-400 font-bold text-sm">+{tx.amount.toLocaleString()} ETB</div>
                      <div className="text-[10px] text-neutral-500 truncate max-w-[150px] sm:max-w-[200px] mt-0.5">
                        {tx.display_name || tx.user_id}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-neutral-400 tracking-widest uppercase">{timeAgo(tx.created_at)}</div>
                      <div className="text-[9px] text-emerald-500/50 uppercase mt-0.5 font-bold tracking-widest">Automated</div>
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