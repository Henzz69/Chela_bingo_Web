// GET  /api/bingo/wallet?tgId=xxx   — Get wallet summary (unified balance)
// POST /api/bingo/wallet             — Deposit / Withdraw / Stake / Win
//
// All wallet operations use tg_id (BIGINT). The unified transactions table
// records all tx with module='bingo' or module='global'.
// tg_users.balance is the single source of truth for all modules.
//
// Security: tgId integer validation, amount limits, action whitelist,
//           win action never trusts client amount (server-side RPC only),
//           no raw DB errors exposed, consistent error shape.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Security constants ────────────────────────────────────────
const MIN_AMOUNT     = 1;
const MAX_DEPOSIT    = 100_000;
const MAX_WITHDRAWAL = 100_000;
const MAX_STAKE      = 10_000;
const VALID_ACTIONS  = new Set(['deposit', 'withdraw', 'stake', 'win']);

function isValidTgId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

// ── GET — wallet summary ──────────────────────────────────────
export async function GET(req: NextRequest) {
  // Accept tgId (preferred) or legacy userId for backward compat
  const rawTgId  = req.nextUrl.searchParams.get('tgId');
  const parsedTgId = rawTgId ? Number(rawTgId) : NaN;

  if (!rawTgId || !Number.isInteger(parsedTgId) || parsedTgId <= 0) {
    return NextResponse.json({ error: 'Valid tgId (integer) is required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc('bingo_get_wallet_summary', {
    p_tg_id: parsedTgId,
  });

  if (error || !data || data.error) {
    return NextResponse.json(
      { error: data?.error || 'User not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}

// ── POST — wallet mutations ───────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  // Unified: all actions now use tgId (BIGINT).
  // Legacy userId (UUID) is accepted but ignored — tgId takes precedence.
  const { tgId, action, amount, note } = body;

  // ── Validate tgId — required for all actions ──────────────
  const parsedTgId = Number(tgId);
  if (!isValidTgId(parsedTgId)) {
    return NextResponse.json({ error: 'Valid tgId (integer) is required' }, { status: 400 });
  }

  // ── Validate action ───────────────────────────────────────
  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Invalid action — must be one of: ${[...VALID_ACTIONS].join(', ')}` },
      { status: 400 }
    );
  }

  // ── Sanitize note ─────────────────────────────────────────
  const safeNote = note
    ? String(note).replace(/[<>"']/g, '').trim().slice(0, 200)
    : undefined;

  // ── deposit ──────────────────────────────────────────────
  if (action === 'deposit') {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt < MIN_AMOUNT || amt > MAX_DEPOSIT) {
      return NextResponse.json(
        { error: `Deposit amount must be between ${MIN_AMOUNT} and ${MAX_DEPOSIT}` },
        { status: 400 }
      );
    }

    // bingo_wallet_credit writes to unified transactions table (module='global')
    const { data, error } = await supabaseAdmin.rpc('bingo_wallet_credit', {
      p_tg_id:  parsedTgId,
      p_amount: amt,
      p_type:   'deposit',
      p_note:   safeNote || 'Deposit',
    });

    if (error || data?.error) {
      console.error('[POST /api/bingo/wallet deposit]', error?.message || data?.error);
      return NextResponse.json({ error: data?.error || 'Deposit failed' }, { status: 400 });
    }

    const { data: summary } = await supabaseAdmin.rpc('bingo_get_wallet_summary', { p_tg_id: parsedTgId });
    return NextResponse.json(summary);
  }

  // ── withdraw ──────────────────────────────────────────────
  if (action === 'withdraw') {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt < MIN_AMOUNT || amt > MAX_WITHDRAWAL) {
      return NextResponse.json(
        { error: `Withdrawal amount must be between ${MIN_AMOUNT} and ${MAX_WITHDRAWAL}` },
        { status: 400 }
      );
    }

    // bingo_wallet_debit writes to unified transactions table (module='global')
    const { data, error } = await supabaseAdmin.rpc('bingo_wallet_debit', {
      p_tg_id:  parsedTgId,
      p_amount: amt,
      p_type:   'withdrawal',
      p_note:   safeNote || 'Withdrawal',
    });

    if (error || data?.error) {
      console.error('[POST /api/bingo/wallet withdraw]', error?.message || data?.error);
      return NextResponse.json({ error: data?.error || 'Withdrawal failed' }, { status: 400 });
    }

    const { data: summary } = await supabaseAdmin.rpc('bingo_get_wallet_summary', { p_tg_id: parsedTgId });
    return NextResponse.json(summary);
  }

  // ── stake ─────────────────────────────────────────────────
  if (action === 'stake') {
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt < MIN_AMOUNT || amt > MAX_STAKE) {
      return NextResponse.json(
        { error: `Stake amount must be between ${MIN_AMOUNT} and ${MAX_STAKE}` },
        { status: 400 }
      );
    }

    // bingo_wallet_debit writes to unified transactions table (module='bingo', tx_type='bingo_entry')
    const { data, error } = await supabaseAdmin.rpc('bingo_wallet_debit', {
      p_tg_id:  parsedTgId,
      p_amount: amt,
      p_type:   'bingo_entry',
      p_note:   safeNote || 'Game stake',
    });

    if (error || data?.error) {
      console.error('[POST /api/bingo/wallet stake]', error?.message || data?.error);
      return NextResponse.json({ error: data?.error || 'Stake failed' }, { status: 400 });
    }

    const { data: summary } = await supabaseAdmin.rpc('bingo_get_wallet_summary', { p_tg_id: parsedTgId });
    return NextResponse.json(summary);
  }

  // ── win — server-side verification ONLY ──────────────────
  // The client-supplied `amount` is COMPLETELY IGNORED.
  // Payout is calculated exclusively by the bingo_claim_win RPC from DB data.
    // bingo_cards uses tg_id (BIGINT).
  if (action === 'win') {
    const { data: session, error: sessErr } = await supabaseAdmin
      .from('bingo_cards')
      .select('id, room_id')
      .eq('tg_id', parsedTgId)
      .eq('win_claimed', false)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sessErr || !session) {
      return NextResponse.json({ error: 'No active game session found' }, { status: 400 });
    }

    const { data: claimResult, error: claimErr } = await supabaseAdmin.rpc('bingo_claim_win', {
      p_session_id: session.id,
      p_room_id:    session.room_id,
      p_tg_id:      parsedTgId,
      p_idem_key:   `win-${session.id}`,
    });

    if (claimErr || claimResult?.error) {
      console.error('[POST /api/bingo/wallet win]', claimErr?.message || claimResult?.error);
      return NextResponse.json(
        { error: claimResult?.error || 'Win claim rejected' },
        { status: 403 }
      );
    }

    // Return updated wallet summary
    const { data: summary } = await supabaseAdmin.rpc('bingo_get_wallet_summary', {
      p_tg_id: parsedTgId,
    });
    return NextResponse.json(summary);
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
