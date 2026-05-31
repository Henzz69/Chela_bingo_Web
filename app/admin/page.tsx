'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';

// 🔒 THE MASTER PASSWORD VAULT
const MASTER_PASSWORD = "chelahebenki2026";

type TimeScale = 'today' | 'week' | 'month' | 'all';

interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  tx_type: string;
  status: string;
  created_at: string;
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
  // 🔒 Password State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState(false);

  const [timeScale, setTimeScale] = useState<TimeScale>('today');
  const [stats, setStats] = useState<DashboardStats>({ deposits: 0, withdrawals: 0, gamesHosted: 0, netFlow: 0 });
  const [macroStats, setMacroStats] = useState<AdminStats | null>(null);
  const [pendingTxs, setPendingTxs] = useState<Transaction[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // 📊 THE HYBRID ANALYTICS ENGINE (Only runs if unlocked!)
  useEffect(() => {
    if (!isUnlocked) return; // Do not fetch data if the vault is locked!

    const fetchDashboardData = async () => {
      setIsLoadingData(true);
      
      // Calculate Time Boundary for Micro Stats
      const now = new Date();
      let startDate = new Date(0); // Epoch (All Time)
      if (timeScale === 'today') startDate = new Date(now.setHours(0,0,0,0));
      if (timeScale === 'week') startDate = new Date(now.setDate(now.getDate() - 7));
      if (timeScale === 'month') startDate = new Date(now.setDate(now.getDate() - 30));
      const isoStart = startDate.toISOString();

      try {
        // 1. Fetch Global Telemetry (RPC)
        const { data: globalData, error: globalError } = await supabase.rpc('get_admin_stats');
        if (!globalError && globalData) setMacroStats(globalData as AdminStats);

        // 2. Fetch Pending Queue (Always fetches ALL pending)
        const { data: pendingData } = await supabase
          .from('transactions')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        if (pendingData) setPendingTxs(pendingData);

        // 3. Fetch Time-Scaled Transactions (Completed only)
        const { data: txData } = await supabase
          .from('transactions')
          .select('amount, tx_type')
          .gte('created_at', isoStart)
          .eq('status', 'completed');

        // 4. Fetch Time-Scaled Games
        const { count: gamesCount } = await supabase
          .from('bingo_rooms')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', isoStart);

        // 5. Crunch the Micro Numbers
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
    const interval = setInterval(fetchDashboardData, 15000); // Live refresh every 15s
    return () => clearInterval(interval);
  }, [isUnlocked, timeScale]);

  // Helper: Format relative time
  const timeAgo = (dateStr: string) => {
    const diff = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return `${Math.floor(diff / 1440)}d ago`;
  };

  // Password Unlock Handler
  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (passInput === MASTER_PASSWORD) {
      setIsUnlocked(true);
    } else {
      setPassError(true);
      setTimeout(() => setPassError(false), 2000);
    }
  };

  // ==========================================
  // RENDER 1: THE PASSWORD LOCK SCREEN
  // ==========================================
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

  // ==========================================
  // RENDER 2: SECURE DASHBOARD
  // ==========================================
  return (
    <div className="min-h-screen bg-[#050505] text-neutral-100 p-4 md:p-8 font-mono overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-8 pb-24">
        
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

        {/* 🌍 GLOBAL TELEMETRY (Restored Macro Stats) */}
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

        {/* ⚡ THE ACTION CENTER: Pending Queue */}
        <section className="bg-neutral-900/50 border border-neutral-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex justify-between items-center">
            <h2 className="text-lg font-black tracking-widest text-white flex items-center gap-2">
              <span className="text-yellow-500">⚡</span> PENDING QUEUE
            </h2>
            <span className="bg-yellow-500/10 text-yellow-500 text-[10px] font-bold px-2 py-1 rounded border border-yellow-500/20 uppercase">
              {pendingTxs.length} Awaiting Bot
            </span>
          </div>
          
          <div className="overflow-x-auto">
            {pendingTxs.length === 0 ? (
              <div className="p-8 text-center text-neutral-500 text-sm font-medium">All queues clear. Bot is fully synced.</div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-[10px] uppercase text-neutral-500 bg-neutral-950/50">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Time</th>
                    <th className="px-6 py-3 font-semibold">User ID</th>
                    <th className="px-6 py-3 font-semibold">Type</th>
                    <th className="px-6 py-3 font-semibold text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  <AnimatePresence>
                    {pendingTxs.map((tx) => (
                      <motion.tr key={tx.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-neutral-800/30 transition-colors">
                        <td className="px-6 py-4 text-neutral-400 text-xs">{timeAgo(tx.created_at)}</td>
                        <td className="px-6 py-4 font-mono text-neutral-300 text-xs">{tx.user_id}</td>
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${tx.tx_type === 'deposit' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-orange-500/10 text-orange-400 border-orange-500/20'}`}>
                            {tx.tx_type}
                          </span>
                        </td>
                        <td className={`px-6 py-4 text-right font-black ${tx.tx_type === 'deposit' ? 'text-emerald-400' : 'text-orange-400'}`}>
                          {tx.amount.toLocaleString()} ETB
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ⏱️ TIME-SCALED FINANCIAL ANALYTICS */}
        <div className="flex items-center justify-between pt-4">
          <h2 className="text-sm font-bold tracking-widest text-neutral-400 uppercase">Financial Velocity</h2>
          <div className="flex bg-neutral-900 border border-neutral-800 rounded-lg p-1">
            {(['today', 'week', 'month', 'all'] as TimeScale[]).map((scale) => (
              <button key={scale} onClick={() => setTimeScale(scale)}
                className={`px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-md transition-all ${timeScale === scale ? 'bg-emerald-500 text-black shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                {scale === 'week' ? '7D' : scale === 'month' ? '30D' : scale}
              </button>
            ))}
          </div>
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-4 gap-4 transition-opacity duration-300 ${isLoadingData ? 'opacity-50' : 'opacity-100'}`}>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden flex flex-col justify-between">
            <h3 className="text-neutral-500 text-[10px] font-black tracking-widest uppercase mb-2">Total Deposits</h3>
            <div className="text-3xl font-black text-emerald-400">+{stats.deposits.toLocaleString()}</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden flex flex-col justify-between">
            <h3 className="text-neutral-500 text-[10px] font-black tracking-widest uppercase mb-2">Total Withdrawals</h3>
            <div className="text-3xl font-black text-orange-400">-{stats.withdrawals.toLocaleString()}</div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden flex flex-col justify-between">
            <h3 className="text-neutral-500 text-[10px] font-black tracking-widest uppercase mb-2">Net Cash Flow</h3>
            <div className={`text-3xl font-black ${stats.netFlow >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
              {stats.netFlow > 0 ? '+' : ''}{stats.netFlow.toLocaleString()}
            </div>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl relative overflow-hidden flex flex-col justify-between">
            <h3 className="text-neutral-500 text-[10px] font-black tracking-widest uppercase mb-2">Games Hosted</h3>
            <div className="text-3xl font-black text-purple-400">{stats.gamesHosted.toLocaleString()}</div>
          </div>
        </div>

      </div>
    </div>
  );
}