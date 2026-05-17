'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Odd {
  label: string;
  value: number;
}

interface Game {
  id: number;
  match: string;
  odds: Odd[];
  home_team?: string;
  away_team?: string;
  home_logo?: string;
  away_logo?: string;
  home_score?: number;
  away_score?: number;
  league?: string;
  status?: string;
  date?: string;
  result_info?: string;
}

interface Bet {
  id: number;
  match_name: string;
  selection: string;
  odds: number;
  stake: number;
  status?: 'pending' | 'won' | 'lost';
}

type MatchView = 'upcoming' | 'live' | 'results';

const API_BASE = '/api';

/** Returns the current user's Supabase JWT, or null if not signed in. */
async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Builds an Authorization header object, or empty object if no token. */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------------------
// Betting Page
// ---------------------------------------------------------------------------
export default function BettingPage() {
  const [odds, setOdds] = useState<Game[]>([]);
  const [myBets, setMyBets] = useState<Bet[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [matchView, setMatchView] = useState<MatchView>('upcoming');
  const [selectedLeague, setSelectedLeague] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [msg, setMsg] = useState('');

  const [selectedBets, setSelectedBets] = useState<(Odd & { match: string; gameId: number })[]>([]);
  const [stake, setStake] = useState(10);
  const [rightTab, setRightTab] = useState<'betslip' | 'my-bets'>('betslip');

  const totalOdds = selectedBets.reduce((acc, bet) => acc * bet.value, 1);

  const toggleSelection = (odd: Odd, game: Game) => {
    setSelectedBets(prev => {
      const exists = prev.find(b => b.gameId === game.id);
      if (exists) {
        if (exists.label === odd.label) return prev.filter(b => b.gameId !== game.id);
        return prev.map(b => b.gameId === game.id ? { ...odd, match: game.match, gameId: game.id } : b);
      }
      return [...prev, { ...odd, match: game.match, gameId: game.id }];
    });
    setRightTab('betslip');
  };

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await Promise.all([fetchUser(), fetchOdds(matchView), fetchBets()]);
      setIsLoading(false);
    };
    init();
    const interval = setInterval(() => { fetchUser(); fetchOdds(matchView); }, 30000);
    return () => clearInterval(interval);
  }, [matchView]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchUser = async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/user`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setBalance(data.balance != null ? parseFloat(data.balance) : 0);
    } catch { setBalance(0); }
  };

  const fetchOdds = async (view: MatchView) => {
    const endpoints: Record<MatchView, string> = {
      upcoming: `${API_BASE}/fixtures`,
      live: `${API_BASE}/livescores`,
      results: `${API_BASE}/results`,
    };
    try {
      const res = await fetch(endpoints[view]);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOdds(Array.isArray(data) ? data : []);
    } catch { setOdds([]); }
  };

  const fetchBets = async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/bets`, { headers });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setMyBets(Array.isArray(data) ? data : []);
    } catch { setMyBets([]); }
  };

  const handlePlaceBet = async () => {
    if (selectedBets.length === 0) { setMsg('Add at least one selection'); return; }
    if (balance === null || balance < stake) { setMsg('Insufficient Funds'); return; }
    if (stake <= 0) { setMsg('Stake must be greater than 0'); return; }
    setMsg('Processing...');
    try {
      const auth = await authHeaders();
      const response = await fetch(`${API_BASE}/place-bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ selections: selectedBets, total_odds: totalOdds, stake }),
      });
      const result = await response.json();
      if (response.ok) {
        setMsg('🎉 Bet Placed!');
        setBalance(result.new_balance);
        setSelectedBets([]);
        fetchBets();
        setRightTab('my-bets');
      } else {
        setMsg('Error: ' + (result.error ?? 'Unknown error'));
      }
    } catch { setMsg('Connection Error — is the backend running?'); }
    setTimeout(() => setMsg(''), 4000);
  };

  const filteredOdds = odds.filter(game => {
    const matchesSearch = game.match.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLeague = selectedLeague ? game.league === selectedLeague : true;
    return matchesSearch && matchesLeague;
  });

  const leagues = Array.from(new Set(odds.map(g => g.league).filter((l): l is string => !!l)));

  const tabLabel: Record<MatchView, string> = {
    upcoming: 'Upcoming Fixtures',
    live: 'Live Matches',
    results: 'Recent Results',
  };

  const betStatusClass = (status?: string) => {
    if (status === 'won') return 'bg-green-500/20 text-green-400';
    if (status === 'lost') return 'bg-red-500/20 text-red-400';
    return 'bg-[#111] text-white/40';
  };

  return (
    <div className="bg-[#1a1d23] text-white min-h-screen font-sans">
      {/* HEADER */}
      <nav className="bg-[#242933] px-6 py-4 flex justify-between items-center border-b border-[#333]">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[#666] hover:text-white transition text-sm">← Home</Link>
          <h2 className="text-2xl font-black">TURBO<span className="text-[#00e676]">BET</span></h2>
        </div>
        <div className="bg-[#111] px-4 py-2 rounded-full border border-[#333]">
          <span className="text-[#00e676] font-bold">Balance: {balance?.toFixed(2) ?? '0.00'} ETB</span>
        </div>
      </nav>

      {/* MAIN GRID */}
      <div className="grid grid-cols-[220px_1fr_350px] gap-0.5 max-w-[1600px] mx-auto">
        {/* LEFT: LEAGUES */}
        <aside className="bg-[#242933] p-5 min-h-[calc(100vh-70px)]">
          <h4 className="text-[10px] uppercase tracking-wider text-[#666] font-bold mb-3">Leagues</h4>
          <ul className="list-none p-0 space-y-2">
            <li onClick={() => setSelectedLeague(null)}
              className={`p-3 rounded-lg cursor-pointer transition hover:bg-[#3b4352] ${!selectedLeague ? 'bg-[#2f3542] text-white' : 'text-[#888]'}`}>
              All Leagues
            </li>
            {leagues.map(league => (
              <li key={league} onClick={() => setSelectedLeague(league)}
                className={`p-3 rounded-lg cursor-pointer transition hover:bg-[#3b4352] ${selectedLeague === league ? 'bg-[#2f3542] text-white' : 'text-[#888]'}`}>
                {league}
              </li>
            ))}
          </ul>
        </aside>

        {/* CENTER: MATCHES */}
        <main className="p-5">
          <div className="flex gap-4 mb-6 border-b border-[#333]">
            {(['upcoming', 'live', 'results'] as MatchView[]).map(view => (
              <button key={view} onClick={() => setMatchView(view)}
                className={`pb-2 px-1 text-sm font-bold uppercase tracking-widest transition ${matchView === view ? 'text-[#00e676] border-b-2 border-[#00e676]' : 'text-[#666] hover:text-white'}`}>
                {view}
              </button>
            ))}
          </div>

          <div className="mb-6">
            <input type="text" placeholder="Search teams or leagues..." value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-[#242933] border border-[#333] rounded-lg px-4 py-3 outline-none focus:border-[#00e676] transition-all text-sm" />
          </div>

          {isLoading ? (
            <div className="flex justify-center items-center h-64 text-[#888]">Loading matches...</div>
          ) : (
            <div className="grid gap-4">
              <div className="flex justify-between items-center px-2 text-[10px] uppercase tracking-wider text-[#666] font-bold">
                <span>{tabLabel[matchView]} ({filteredOdds.length})</span>
                {matchView === 'upcoming' && (
                  <div className="flex gap-2 w-[50%] pr-4 justify-around">
                    <span>1</span><span>X</span><span>2</span>
                  </div>
                )}
              </div>

              {filteredOdds.length > 0 ? filteredOdds.map(game => (
                <div key={game.id} className="bg-[#242933] rounded-xl p-5 grid grid-cols-[1.5fr_2fr] gap-5 items-center">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      {game.home_logo && <img src={game.home_logo} alt="" className="w-6 h-6 object-contain" />}
                      <div className="font-bold text-sm flex-1 truncate">{game.home_team ?? game.match.split(' vs ')[0]}</div>
                      {(matchView === 'live' || matchView === 'results') && <span className="font-mono text-[#00e676]">{game.home_score ?? 0}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {game.away_logo && <img src={game.away_logo} alt="" className="w-6 h-6 object-contain" />}
                      <div className="font-bold text-sm flex-1 truncate">{game.away_team ?? game.match.split(' vs ')[1]}</div>
                      {(matchView === 'live' || matchView === 'results') && <span className="font-mono text-[#00e676]">{game.away_score ?? 0}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold tracking-tighter ${matchView === 'live' ? 'bg-red-500/20 text-red-500 animate-pulse' : 'bg-[#00e676]/10 text-[#00e676]'}`}>
                        {matchView === 'live' ? 'Live' : matchView === 'results' ? (game.status ?? 'FT') : game.date ? new Date(game.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled'}
                      </div>
                      {game.league && <div className="text-[10px] text-white/30 uppercase font-bold tracking-widest">{game.league}</div>}
                      {matchView === 'results' && game.result_info && <div className="text-[10px] text-[#888] italic w-full mt-1">{game.result_info}</div>}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {game.odds.length > 0 ? game.odds.map((odd, idx) => {
                      const isSelected = selectedBets.some(b => b.gameId === game.id && b.label === odd.label);
                      return (
                        <button key={idx} onClick={() => toggleSelection(odd, game)}
                          className={`flex-1 border-none py-3 px-1 rounded-md cursor-pointer transition-colors ${isSelected ? 'bg-[#00e676] text-black' : 'bg-[#2f3640] text-white hover:bg-[#3b4352]'}`}>
                          <div className={`text-[10px] ${isSelected ? 'text-black/70' : 'text-[#888]'}`}>{odd.label}</div>
                          <div className="font-bold text-base">{odd.value}</div>
                        </button>
                      );
                    }) : <div className="text-[#555] text-xs italic self-center">No odds available</div>}
                  </div>
                </div>
              )) : (
                <div className="text-center py-20 text-[#666]">
                  {searchTerm ? `No matches found for "${searchTerm}"` : 'No matches available right now.'}
                </div>
              )}
            </div>
          )}
        </main>

        {/* RIGHT: BETSLIP */}
        <aside className="bg-[#242933] border-l border-[#333]">
          <div className="flex border-b border-[#333]">
            <button onClick={() => setRightTab('betslip')}
              className={`flex-1 p-4 border-none font-bold cursor-pointer transition ${rightTab === 'betslip' ? 'bg-[#242933] text-[#00e676]' : 'bg-[#1f232b] text-[#888] hover:text-white'}`}>
              BETSLIP {selectedBets.length > 0 && (
                <span className="ml-1 bg-[#00e676] text-black text-[10px] font-black px-1.5 py-0.5 rounded-full">{selectedBets.length}</span>
              )}
            </button>
            <button onClick={() => { setRightTab('my-bets'); fetchBets(); }}
              className={`flex-1 p-4 border-none font-bold cursor-pointer transition ${rightTab === 'my-bets' ? 'bg-[#242933] text-[#00e676]' : 'bg-[#1f232b] text-[#888] hover:text-white'}`}>
              MY BETS
            </button>
          </div>

          <div className="p-5">
            {rightTab === 'betslip' ? (
              selectedBets.length > 0 ? (
                <div className="space-y-3">
                  {selectedBets.map(bet => (
                    <div key={bet.gameId} className="bg-[#2f3640] p-4 rounded-lg border-l-4 border-[#00e676] relative">
                      <button onClick={() => setSelectedBets(prev => prev.filter(b => b.gameId !== bet.gameId))}
                        className="absolute top-2 right-2 text-white/30 hover:text-white text-lg leading-none" aria-label="Remove">×</button>
                      <div className="text-sm font-medium pr-4">{bet.match}</div>
                      <div className="text-[#00e676] font-bold mt-1">{bet.label} @ {bet.value}</div>
                    </div>
                  ))}
                  <div className="mt-4">
                    <label className="text-xs text-[#888] block mb-1">Stake Amount (ETB)</label>
                    <input type="number" min={1} value={stake} onChange={e => setStake(Math.max(1, Number(e.target.value)))}
                      className="w-full p-2 bg-[#111] text-white border border-[#444] rounded outline-none focus:border-[#00e676]" />
                  </div>
                  <div className="mt-4 flex justify-between text-sm">
                    <span className="text-[#888]">Total Odds:</span>
                    <span className="text-white font-bold">{totalOdds.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#888]">Potential Payout:</span>
                    <span className="text-[#00e676] font-bold">{(stake * totalOdds).toFixed(2)} ETB</span>
                  </div>
                  <button onClick={() => setSelectedBets([])}
                    className="w-full py-3 bg-transparent text-[#888] border border-[#444] mt-2 font-bold rounded cursor-pointer transition hover:bg-[#3b4352] active:scale-95">
                    CLEAR ALL
                  </button>
                  <button type="button" onClick={handlePlaceBet}
                    className="w-full py-4 bg-[#00e676] text-black border-none mt-4 font-bold rounded cursor-pointer transition hover:bg-[#00c868] active:scale-95">
                    PLACE BET
                  </button>
                </div>
              ) : <p className="text-[#666] text-center mt-10">Select an odd to add to slip</p>
            ) : (
              <div className="space-y-3">
                {myBets.length === 0 ? (
                  <p className="text-[#666] text-center mt-10">No active bets</p>
                ) : myBets.map(bet => (
                  <div key={bet.id} className="border-b border-[#444] pb-3 last:border-0">
                    <div className="text-xs text-[#888]">{bet.match_name}</div>
                    <div className="flex justify-between items-center mt-1">
                      <div className="text-sm font-semibold">
                        <span className="text-[#00e676]">{bet.selection}</span>
                        <span className="text-[#666] ml-2">@ {bet.odds}</span>
                      </div>
                      <div className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${betStatusClass(bet.status)}`}>
                        {bet.status ?? 'pending'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {msg && (
        <div className="fixed bottom-5 right-5 bg-[#242933] text-white px-6 py-4 rounded-lg border-l-4 border-[#00e676] shadow-2xl z-50">
          {msg}
        </div>
      )}
    </div>
  );
}
