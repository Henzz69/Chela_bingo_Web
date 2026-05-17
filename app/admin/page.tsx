'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useBingoStore } from '@/store/bingoStore';     // Assuming you have the user's tgId here

// 🛡️ THE VAULT LOCK: Only this Telegram ID can see the page
const ADMIN_TG_ID = 5681654051; 

interface AdminStats {
  total_profit: number;
  total_wallets: number;
  active_rooms: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // We mock fetching the current user's ID. In your real app, pull this from Telegram WebApp initData
  const currentTgId = 5681654051; // Replace with actual logic to get logged-in user's TG ID

  useEffect(() => {
    if (currentTgId !== ADMIN_TG_ID) return;

    const fetchStats = async () => {
      try {
        const { data, error } = await supabase.rpc('get_admin_stats');
        if (error) throw error;
        setStats(data as AdminStats);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    
    // Set an interval to refresh the stats every 10 seconds so you can watch it live!
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [currentTgId]);

  // 🛑 SECURITY BOUNCER
  if (currentTgId !== ADMIN_TG_ID) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-xl text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-2">403: Access Denied</h1>
          <p className="text-red-200">You do not have god-mode privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-8 font-mono">
      <div className="max-w-5xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-neutral-800">
          <div>
            <h1 className="text-3xl font-bold tracking-tighter text-emerald-400">CHELA COMMAND</h1>
            <p className="text-neutral-500 text-sm mt-1">Live Network Telemetry</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-emerald-500 text-sm font-semibold">SYSTEM LIVE</span>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && <p className="text-neutral-400 animate-pulse">Establishing secure connection...</p>}
        {error && <p className="text-red-400 bg-red-900/20 p-4 rounded-lg border border-red-900">{error}</p>}

        {/* Dashboard Grid */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* House Profit Card */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
              <h3 className="text-neutral-400 text-sm font-semibold mb-1">TOTAL HOUSE PROFIT</h3>
              <div className="text-4xl font-bold text-white flex items-baseline gap-1">
                {stats.total_profit.toLocaleString()} <span className="text-lg text-emerald-500">ETB</span>
              </div>
              <p className="text-emerald-400/60 text-xs mt-2">All-time collected Derash</p>
            </div>

            {/* Total Player Wallets Card */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-blue-500"></div>
              <h3 className="text-neutral-400 text-sm font-semibold mb-1">TOTAL ETB IN CIRCULATION</h3>
              <div className="text-4xl font-bold text-white flex items-baseline gap-1">
                {stats.total_wallets.toLocaleString()} <span className="text-lg text-blue-500">ETB</span>
              </div>
              <p className="text-blue-400/60 text-xs mt-2">Current balances across all users</p>
            </div>

            {/* Active Rooms Card */}
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-orange-500"></div>
              <h3 className="text-neutral-400 text-sm font-semibold mb-1">ACTIVE SERVERS</h3>
              <div className="text-4xl font-bold text-white flex items-baseline gap-1">
                {stats.active_rooms}
              </div>
              <p className="text-orange-400/60 text-xs mt-2">Games currently playing or waiting</p>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}