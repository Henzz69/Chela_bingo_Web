/**
 * POST /api/bingo/start
 *
 * Transitions a bingo room from 'waiting' to 'active'.
 * Generates a randomized draw sequence (1–75) and stores it.
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

/** Fisher-Yates shuffle to generate a random draw sequence 1–75 */
function generateDrawSequence(): number[] {
  const nums: number[] = [];
  for (let i = 1; i <= 75; i++) nums.push(i);
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

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

  const drawSequence = generateDrawSequence();

  const { data, error } = await supabaseAdmin
    .from('bingo_rooms')
    .update({
      status: 'active',
      draw_sequence: drawSequence,
      drawn_numbers: [],
      started_at: new Date().toISOString(),
    })
    .eq('id', roomId)
    .eq('status', 'waiting')
    .select()
    .single();

  if (error) {
    console.error('[/api/bingo/start] error:', error.message);
    return NextResponse.json(
      { error: error.code === 'PGRST116' ? 'Room not found or already started' : 'Failed to start room' },
      { status: error.code === 'PGRST116' ? 404 : 500 }
    );
  }

  return NextResponse.json({ success: true, room: data }, { status: 200 });
}
