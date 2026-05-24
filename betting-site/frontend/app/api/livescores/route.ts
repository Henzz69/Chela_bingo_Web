// GET /api/livescores
// Returns currently live football matches from Sportsmonks.
// Security: API key guard, fetch timeout, no key exposed in errors,
//           short cache to avoid hammering the upstream API.
import { NextResponse } from 'next/server';

const FETCH_TIMEOUT_MS = 8_000;

export async function GET() {
  const API_KEY = process.env.SPORTSMONKS_API_KEY;

  if (!API_KEY) {
    console.error('[/api/livescores] SPORTSMONKS_API_KEY not configured');
    return NextResponse.json({ error: 'Live scores unavailable' }, { status: 503 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(
        `https://api.sportmonks.com/v3/football/livescores?api_token=${API_KEY}`,
        { signal: controller.signal, next: { revalidate: 30 } }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Upstream API error: ${response.status}`);
    }

    const json = await response.json();
    const data: any[] = json.data || [];

    const formatted = data.map((fixture: any) => {
      const parts = (fixture.name ?? '').split(' vs ');
      return {
        id:          fixture.id,
        match:       fixture.name ?? 'Unknown Match',
        league:      null,
        date:        fixture.starting_at ?? null,
        status:      'live',
        home_team:   parts[0]?.trim() ?? null,
        away_team:   parts[1]?.trim() ?? null,
        home_logo:   null,
        away_logo:   null,
        home_score:  null,
        away_score:  null,
        odds:        [],
      };
    });

    return NextResponse.json(formatted, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    });

  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    console.error('[/api/livescores]', isTimeout ? 'Request timed out' : error.message);
    return NextResponse.json(
      { error: isTimeout ? 'Live scores request timed out' : 'Failed to load live scores' },
      { status: 503 }
    );
  }
}
