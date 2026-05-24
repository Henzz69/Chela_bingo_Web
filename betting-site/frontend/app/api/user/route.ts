// GET /api/user
// Returns the authenticated user's balance from the Supabase `tg_users` table.
// Unified schema: tg_users.balance is the single source of truth for all modules.
// Security: JWT auth, no sensitive data leakage, consistent error shape,
//           cache-control headers to prevent stale balance reads.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    // ── 2. Fetch balance from tg_users (was profiles) ─────────
    // tg_users.balance is the unified balance for sports + bingo.
    // We match on tg_id if available, otherwise fall back to the
    // Supabase auth UUID stored in a profiles row.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('tg_users')
      .select('balance')
      .eq('tg_id', user.id)
      .maybeSingle();

    // If not found by tg_id, try profiles table as fallback for
    // legacy Supabase-auth users who haven't linked a tg_id yet.
    if (!profile && !profileError) {
      const { data: legacyProfile, error: legacyErr } = await supabaseAdmin
        .from('profiles')
        .select('balance')
        .eq('id', user.id)
        .maybeSingle();

      const balance = parseFloat(legacyProfile?.balance ?? '0');
      return NextResponse.json(
        { balance: isFinite(balance) ? balance : 0 },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
      );
    }

    if (profileError) {
      // Profile missing — return 0 balance rather than 500
      if (profileError.code === 'PGRST116') {
        return NextResponse.json(
          { balance: 0 },
          {
            status: 200,
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
          }
        );
      }
      throw profileError;
    }

    const balance = parseFloat(profile?.balance ?? '0');
    if (!isFinite(balance)) {
      throw new Error('Invalid balance value in database');
    }

    return NextResponse.json(
      { balance },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
    );

  } catch (error: any) {
    console.error('[GET /api/user]', error.message);
    // Never expose internal error details to the client
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
