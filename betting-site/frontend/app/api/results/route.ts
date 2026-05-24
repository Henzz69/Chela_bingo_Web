// GET /api/results
// Returns yesterday's finished football matches from Sportsmonks.
// Security: API key guard, fetch timeout, no key exposed in errors,
//           longer cache since results don't change.
import { NextResponse } from 'next/server';

// Finished state IDs from Sportsmonks v3
const FINISHED_STATES = new Set([5, 6, 7, 8, 9, 10, 11, 12]);
const FETCH_TIMEOUT_MS = 8_000;

export async function GET() {
  const API_KEY = process.env.SPORTSMONKS_API_KEY;

  if (!API_KEY) {
    console.error('[/api/results] SPORTSMONKS_API_KEY not configured');
    return NextResponse.json({ error: 'Results unavailable' }, { status: 503 });
  }

  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(
        `https://api.sportmonks.com/v3/football/fixtures/date/${dateStr}?api_token=${API_KEY}`,
        { signal: controller.signal, next: { revalidate: 120 } }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Upstream API error: ${response.status}`);
    }

    const json = await response.json();
    const data: any[] = json.data || [];

    const finished = data.filter((f: any) => FINISHED_STATES.has(f.state_id));

    const formatted = finished.map((fixture: any) => {
      const parts = (fixture.name ?? '').split(' vs ');
      return {
        id:          fixture.id,
        match:       fixture.name ?? 'Unknown Match',
        league:      null,
        date:        fixture.starting_at ?? null,
        status:      'FT',
        home_team:   parts[0]?.trim() ?? null,
        away_team:   parts[1]?.trim() ?? null,
        home_logo:   null,
        away_logo:   null,
        home_score:  null,
        away_score:  null,
        result_info: fixture.result_info ?? null,
        odds:        [],
      };
    });

    return NextResponse.json(formatted, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' },
    });

  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    console.error('[/api/results]', isTimeout ? 'Request timed out' : error.message);
    return NextResponse.json(
      { error: isTimeout ? 'Results request timed out' : 'Failed to load results' },
      { status: 503 }
    );
  }
}
