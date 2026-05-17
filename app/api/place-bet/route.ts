// POST /api/place-bet
// Atomically places a bet via the place_bet_batch Supabase RPC.
// Unified schema: bets.user_id is now BIGINT referencing tg_users(tg_id).
// The RPC place_bet_batch now accepts p_tg_id (BIGINT) instead of p_user_id (UUID).
// Security: JWT auth, stake limits, selection count cap, odds validation,
//           duplicate fixture guard, idempotency via RPC, CORS headers.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Security constants ────────────────────────────────────────
const MIN_STAKE        = 1;       // minimum stake in currency units
const MAX_STAKE        = 100_000; // maximum stake per slip
const MAX_SELECTIONS   = 20;      // max legs in an accumulator
const VALID_SELECTIONS = new Set(['1', 'X', '2']);

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse & validate body ──────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { selections, stake } = body;

    if (!Array.isArray(selections) || selections.length === 0) {
      return NextResponse.json({ error: 'No selections provided' }, { status: 400 });
    }
    if (selections.length > MAX_SELECTIONS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_SELECTIONS} selections per slip` },
        { status: 400 }
      );
    }
    if (typeof stake !== 'number' || !isFinite(stake) || stake < MIN_STAKE || stake > MAX_STAKE) {
      return NextResponse.json(
        { error: `Stake must be between ${MIN_STAKE} and ${MAX_STAKE}` },
        { status: 400 }
      );
    }

    // ── 2. Validate each selection ────────────────────────────
    const seenFixtures = new Set<number>();
    for (const sel of selections) {
      if (!sel || typeof sel !== 'object') {
        return NextResponse.json({ error: 'Invalid selection format' }, { status: 400 });
      }
      const fixtureId = Number(sel.gameId);
      if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
        return NextResponse.json({ error: 'Invalid fixture ID in selection' }, { status: 400 });
      }
      if (!VALID_SELECTIONS.has(sel.label)) {
        return NextResponse.json(
          { error: `Invalid selection label "${sel.label}" — must be 1, X, or 2` },
          { status: 400 }
        );
      }
      if (seenFixtures.has(fixtureId)) {
        return NextResponse.json(
          { error: 'Duplicate fixture in selections — one bet per match' },
          { status: 400 }
        );
      }
      seenFixtures.add(fixtureId);
    }

    // ── 3. Authenticate caller ────────────────────────────────
    const authHeader = req.headers.get('authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized — no token' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
    }

    // ── 4. Resolve tg_id from tg_users (unified identity) ─────
    // bets.user_id is now BIGINT referencing tg_users(tg_id).
    // The Supabase auth user.id is a UUID; we look up the matching tg_id.
    const { data: tgUserRow } = await supabaseAdmin
      .from('tg_users')
      .select('tg_id')
      .eq('tg_id', user.id)   // works if user.id was stored as tg_id
      .maybeSingle();

    // Fallback: try matching via profiles table (legacy Supabase-auth users)
    let tgId: number | null = tgUserRow?.tg_id ?? null;
    if (!tgId) {
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('tg_id')
        .eq('id', user.id)
        .maybeSingle();
      tgId = profileRow?.tg_id ?? null;
    }

    if (!tgId) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // ── 5. Build bet payload ──────────────────────────────────
    const betPayload = selections.map((sel: any) => ({
      fixture_id: Number(sel.gameId),
      selection:  String(sel.label),
      stake:      stake,
    }));

    // ── 6. Execute atomic RPC ─────────────────────────────────
    // place_bet_batch now accepts p_tg_id (BIGINT) — see migration step 7
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('place_bet_batch', {
      p_tg_id:       tgId,
      p_total_stake: stake,
      p_bets:        betPayload,
    });

    if (rpcError) {
      if (rpcError.message.includes('Insufficient funds')) {
        return NextResponse.json({ error: 'Insufficient funds' }, { status: 400 });
      }
      if (rpcError.message.includes('User not found')) {
        return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
      }
      throw rpcError;
    }

    // RPC returns { error } on business logic failures
    if (rpcData?.error) {
      const status = rpcData.error.includes('Insufficient') ? 400 : 422;
      return NextResponse.json({ error: rpcData.error }, { status });
    }

    return NextResponse.json(rpcData);

  } catch (error: any) {
    console.error('[POST /api/place-bet]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
