// GET /api/fixtures
// Returns upcoming fixtures from the Supabase `fixtures` table.
// Security: service-role read, result capped at 100, cache headers set,
//           no raw DB errors exposed to client.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_FIXTURES = 100;

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('fixtures')
      .select('id, home_team, away_team, start_time, home_odds, draw_odds, away_odds')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .limit(MAX_FIXTURES);

    if (error) throw error;

    const formatted = (data ?? []).map((f: any) => ({
      id:        f.id,
      match:     `${f.home_team} vs ${f.away_team}`,
      home_team: f.home_team,
      away_team: f.away_team,
      date:      f.start_time,
      status:    'NS',
      league:    null,
      home_logo: null,
      away_logo: null,
      odds: [
        { label: '1', value: parseFloat(f.home_odds) || 0 },
        { label: 'X', value: parseFloat(f.draw_odds) || 0 },
        { label: '2', value: parseFloat(f.away_odds) || 0 },
      ],
    }));

    return NextResponse.json(formatted, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });

  } catch (error: any) {
    console.error('[GET /api/fixtures]', error.message);
    return NextResponse.json({ error: 'Failed to load fixtures' }, { status: 500 });
  }
}
