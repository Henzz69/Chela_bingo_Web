/**
 * POST /api/bingo/draw
 *
 * Draws the next number from the room's pre-shuffled sequence.
 * Appends it to drawn_numbers and logs it in bingo_draw_log.
 *
 * Payload: { roomId: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  let body: { roomId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { roomId } = body;
  if (typeof roomId !== 'string' || !UUID_RE.test(roomId)) {
    return NextResponse.json({ error: 'roomId must be a valid UUID' }, { status: 400 });
  }

  // ── 1. Fetch current room state ──────────────────────────
  const { data: room, error: fetchError } = await supabaseAdmin
    .from('bingo_rooms')
    .select('id, status, draw_sequence, drawn_numbers')
    .eq('id', roomId)
    .single();

  if (fetchError || !room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  if (room.status !== 'active') {
    return NextResponse.json({ error: 'Room is not active' }, { status: 400 });
  }

  const drawSequence: number[] = room.draw_sequence as number[];
  const drawnNumbers: number[] = room.drawn_numbers as number[];
  const nextIndex = drawnNumbers.length;

  if (nextIndex >= 75) {
    return NextResponse.json({ error: 'All 75 numbers have been drawn — game over' }, { status: 400 });
  }

  // ── 2. Extract next number ───────────────────────────────
  const nextNumber = drawSequence[nextIndex];
  const updatedDrawn = [...drawnNumbers, nextNumber];

  // ── 3. Update bingo_rooms ────────────────────────────────
  const { error: updateError } = await supabaseAdmin
    .from('bingo_rooms')
    .update({ drawn_numbers: updatedDrawn })
    .eq('id', roomId);

  if (updateError) {
    console.error('[/api/bingo/draw] update error:', updateError.message);
    return NextResponse.json({ error: 'Failed to update drawn numbers' }, { status: 500 });
  }

  // ── 4. Log the draw ──────────────────────────────────────
  const { error: logError } = await supabaseAdmin
    .from('bingo_draw_log')
    .insert({
      room_id: roomId,
      draw_position: nextIndex + 1,
      number_drawn: nextNumber,
    });

  if (logError) {
    console.error('[/api/bingo/draw] log error:', logError.message);
    // Non-fatal — the draw still happened
  }

  // ── 5. Return result ─────────────────────────────────────
  return NextResponse.json(
    { nextNumber, drawn_numbers: updatedDrawn, position: nextIndex + 1 },
    { status: 200 }
  );
}
