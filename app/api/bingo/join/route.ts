export const dynamic = 'force-dynamic'; // 🔴 THIS KILLS THE NEXT.JS CACHE

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBingoCard } from '@/lib/bingo/cardGenerator';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    // ── 1. Parse request & Log it ──
    const body = await req.json();
    console.log("🚀 [MATCHMAKER] Received payload from phone:", body);
    
    // Safely convert whatever it receives into a strict number
    const entryFee = Number(body.entryFee); 
    
    if (isNaN(entryFee) || entryFee < 0) {
      return NextResponse.json({ 
        error: `Invalid entry fee. API received: ${JSON.stringify(body)}` 
      }, { status: 400 });
    }

    const tgIdNum = Number(body.tgId);
    if (!Number.isFinite(tgIdNum) || tgIdNum <= 0) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    // ── 2. USER CHECK ─────────────────────────────────────────
    // ... (keep the rest of your file exactly the same) ...

    // ── 2. USER CHECK ─────────────────────────────────────────
    const { data: user, error: userError } = await supabaseAdmin
      .from('tg_users')
      .select('*')
      .eq('tg_id', tgIdNum)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json({ error: 'User must register via the Telegram bot first' }, { status: 403 });
    }

    const balanceColumn = user.main_balance !== undefined ? 'main_balance' : 'balance';
    const currentBalance = user[balanceColumn] ?? 0;

    // ── 3. BULLETPROOF MATCHMAKER ─────────────────────────────
    // Find the newest waiting room for the EXACT stake they clicked
    const { data: nextRoom, error: matchError } = await supabaseAdmin
      .from('bingo_rooms')
      .select('*') // Select everything so we can send it to the store
      .eq('status', 'waiting')
      .eq('entry_fee', entryFee)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (matchError) {
      console.error('[/api/bingo/join] Matchmaker DB Error:', matchError);
    }

    if (!nextRoom) {
      return NextResponse.json({ error: 'The casino is currently resolving games. Please wait 30 seconds for the next lobby.' }, { status: 400 });
    }

    const targetRoomId = nextRoom.id;

    // ── 4. CASHIER ────────────────────────────────────────────
    if (currentBalance < entryFee) {
      return NextResponse.json({ error: `Insufficient funds. You need ${entryFee} ETB.` }, { status: 402 });
    }

    // ── 5. CARD GENERATION & INSERTION ────────────────────────
    const grid = generateBingoCard();

    const { count } = await supabaseAdmin
      .from('bingo_cards')
      .select('id', { count: 'exact', head: true })
      .eq('room_id', targetRoomId)
      .eq('tg_id', tgIdNum);

    const cardIndex = (count ?? 0) + 1;

    const { data: cardData, error: insertError } = await supabaseAdmin
      .from('bingo_cards')
      .insert({
        room_id: targetRoomId,
        tg_id: tgIdNum,
        card_index: cardIndex,
        grid,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') return NextResponse.json({ error: 'You already have this card.' }, { status: 409 });
      return NextResponse.json({ error: 'Failed to save card.' }, { status: 500 });
    }

    // ── 6. DEDUCT FUNDS ───────────────────────────────────────
    if (entryFee > 0) {
      await supabaseAdmin
        .from('tg_users')
        .update({ [balanceColumn]: currentBalance - entryFee })
        .eq('tg_id', tgIdNum);
    }

    // ── 7. RETURN CARD & ROOM DATA ────────────────────────────
    return NextResponse.json({ cardData, roomData: nextRoom }, { status: 200 });

  } catch (err: unknown) {
    console.error('[/api/bingo/join] Fatal Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}