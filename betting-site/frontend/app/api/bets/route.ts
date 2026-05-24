// GET /api/bets
// Returns the authenticated user's bet history.
// Unified schema: bets.user_id is now BIGINT referencing tg_users(tg_id).
// Security: JWT auth, hard limit on returned rows, no raw DB errors exposed,
//           optional ?limit query param (capped at 100).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ABSOLUTE_MAX_LIMIT = 100;
const DEFAULT_LIMIT       = 50;

export async function GET(req: NextRequest) {
  try {
    // ── 1. Authenticate caller ────────────────────────────────
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 2. Parse & clamp limit ────────────────────────────────
    const rawLimit = parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, ABSOLUTE_MAX_LIMIT)
      : DEFAULT_LIMIT;

    // ── 3. Resolve tg_id (unified identity) ───────────────────
    // bets.user_id is BIGINT referencing tg_users(tg_id).
    // Supabase auth user.id is a UUID — look up the matching tg_id.
    const { data: tgUserRow } = await supabaseAdmin
      .from('tg_users')
      .select('tg_id')
      .eq('tg_id', user.id)
      .maybeSingle();

    let tgId: number | null = tgUserRow?.tg_id ?? null;
    if (!tgId) {
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('tg_id')
        .eq('id', user.id)
        .maybeSingle();
      tgId = profileRow?.tg_id ?? null;
    }

    // If no tg_id found, return empty array (user has no bets yet)
    if (!tgId) {
      return NextResponse.json([]);
    }

    // ── 4. Fetch bets joined with fixtures ────────────────────
    const { data, error } = await supabaseAdmin
      .from('bets')
      .select(`
        id,
        match_name,
        selection,
        odds,
        stake,
        status,
        fixture_id,
        fixtures (
          id,
          home_team,
          away_team,
          home_odds,
          draw_odds,
          away_odds
        )
      `)
      .eq('user_id', tgId)
      .order('id', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // ── 5. Shape for the UI ───────────────────────────────────
    const formatted = (data ?? []).map((bet: any) => {
      const fix = bet.fixtures;
      // Prefer stored match_name (populated by place_bet_batch RPC),
      // fall back to joining fixture team names if available.
      const matchName = bet.match_name
        || (fix ? `${fix.home_team} vs ${fix.away_team}` : 'Unknown Match');

      // Prefer stored odds column; fall back to fixture odds lookup
      let oddsValue = parseFloat(bet.odds) || 0;
      if (!oddsValue && fix) {
        if (bet.selection === '1')      oddsValue = parseFloat(fix.home_odds) || 0;
        else if (bet.selection === 'X') oddsValue = parseFloat(fix.draw_odds) || 0;
        else if (bet.selection === '2') oddsValue = parseFloat(fix.away_odds) || 0;
      }

      return {
        id:         bet.id,
        match_name: matchName,
        selection:  bet.selection,
        odds:       oddsValue,
        stake:      parseFloat(bet.stake) || 0,
        status:     bet.status ?? 'pending',
      };
    });

    return NextResponse.json(formatted);

  } catch (error: any) {
    console.error('[GET /api/bets]', error.message);
    return NextResponse.json([], { status: 500 });
  }
}
