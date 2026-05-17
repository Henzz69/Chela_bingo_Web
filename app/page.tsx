'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';

// ---------------------------------------------------------------------------
// Welcome / Home Page — Choose your game
// ---------------------------------------------------------------------------
export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col items-center justify-center relative overflow-hidden">

      {/* Animated background grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,230,118,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,230,118,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00e676]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16"
      >
        <h1 className="text-5xl font-black tracking-tight mb-3">
          TURBO<span className="text-[#00e676]">PLAY</span>
        </h1>
        <p className="text-[#888] text-lg">Choose your game and start winning</p>
      </motion.div>

      {/* Game Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-6 w-full max-w-3xl">

        {/* ── BETTING CARD ── */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Link href="/betting" className="group block">
            <div className="relative bg-[#1a1d23] border border-[#2a2d35] rounded-2xl p-8 h-72 flex flex-col justify-between overflow-hidden transition-all duration-300 group-hover:border-[#00e676]/50 group-hover:shadow-[0_0_40px_rgba(0,230,118,0.1)]">
              {/* Background icon */}
              <div className="absolute -right-6 -bottom-6 text-[120px] opacity-5 select-none">⚽</div>

              <div>
                <div className="w-14 h-14 bg-[#00e676]/10 rounded-xl flex items-center justify-center mb-5 group-hover:bg-[#00e676]/20 transition-colors">
                  <span className="text-3xl">⚽</span>
                </div>
                <h2 className="text-2xl font-black mb-2">Sports Betting</h2>
                <p className="text-[#888] text-sm leading-relaxed">
                  Live odds on today's fixtures. Place singles or accumulators on football matches worldwide.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <span className="text-[10px] bg-[#00e676]/10 text-[#00e676] px-2 py-1 rounded-full font-bold uppercase tracking-wider">Live Odds</span>
                  <span className="text-[10px] bg-[#333] text-[#888] px-2 py-1 rounded-full font-bold uppercase tracking-wider">Accumulators</span>
                </div>
                <span className="text-[#00e676] font-bold text-sm group-hover:translate-x-1 transition-transform inline-block">
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
            <div className="relative bg-[#1a1d23] border border-[#2a2d35] rounded-2xl p-8 h-72 flex flex-col justify-between overflow-hidden transition-all duration-300 group-hover:border-purple-500/50 group-hover:shadow-[0_0_40px_rgba(168,85,247,0.1)]">
              {/* Background icon */}
              <div className="absolute -right-6 -bottom-6 text-[120px] opacity-5 select-none">🎱</div>

              <div>
                <div className="w-14 h-14 bg-purple-500/10 rounded-xl flex items-center justify-center mb-5 group-hover:bg-purple-500/20 transition-colors">
                  <span className="text-3xl">🎱</span>
                </div>
                <h2 className="text-2xl font-black mb-2">
                  Wana <span className="text-purple-400">Bingo</span>
                </h2>
                <p className="text-[#888] text-sm leading-relaxed">
                  1v1 multiplayer 75-ball bingo. Join a room, daub your card, and shout BINGO to win the pot.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-1 rounded-full font-bold uppercase tracking-wider">Multiplayer</span>
                  <span className="text-[10px] bg-[#333] text-[#888] px-2 py-1 rounded-full font-bold uppercase tracking-wider">75-Ball</span>
                </div>
                <span className="text-purple-400 font-bold text-sm group-hover:translate-x-1 transition-transform inline-block">
                  Play →
                </span>
              </div>
            </div>
          </Link>
        </motion.div>
      </div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="mt-16 text-[#444] text-xs"
      >
        TurboPlay · Play responsibly · 18+
      </motion.p>
    </div>
  );
}
