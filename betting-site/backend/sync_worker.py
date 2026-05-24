"""
sync_worker.py — TurboPlay Fixtures Sync Worker
================================================
Fetches upcoming Premier League fixtures (with 1X2 odds) from the
Sportmonks v3 API and UPSERTs them into the Supabase `fixtures` table.

Usage:
    python sync_worker.py              # run once
    watch -n 300 python sync_worker.py # run every 5 minutes (Linux/Mac)

Environment variables (loaded from .env via python-dotenv):
    SPORTMONKS_API_KEY       — your Sportmonks v3 API token
    SUPABASE_URL             — https://<project>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS)
"""

import os
import sys
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Load .env ─────────────────────────────────────────────────
load_dotenv()

SPORTMONKS_API_KEY       = os.environ.get("SPORTMONKS_API_KEY")
SUPABASE_URL             = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# ── Sportmonks constants ──────────────────────────────────────
# Premier League (England) league ID on Sportmonks v3
PREMIER_LEAGUE_ID = 8          # confirmed PL league id
BASE_URL          = "https://api.sportmonks.com/v3/football"

# Sportmonks market IDs for 1X2 (Full Time Result)
# Market 1 = "1X2" on most Sportmonks plans
MARKET_ID_1X2 = 1

# Sportmonks label IDs within the 1X2 market
# 1 = Home Win, 2 = Draw, 3 = Away Win
LABEL_HOME = "Home"
LABEL_DRAW = "Draw"
LABEL_AWAY = "Away"


def validate_env() -> bool:
    """Check all required env vars are present."""
    missing = []
    if not SPORTMONKS_API_KEY:
        missing.append("SPORTMONKS_API_KEY")
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        print(f"[ERROR] Missing environment variables: {', '.join(missing)}")
        print("        Copy .env.example to .env and fill in your values.")
        return False
    return True


def fetch_fixtures_page(page: int) -> dict:
    """Fetch one page of upcoming PL fixtures with odds included."""
    url = (
        f"{BASE_URL}/fixtures"
        f"?api_token={SPORTMONKS_API_KEY}"
        f"&filters[league_id]={PREMIER_LEAGUE_ID}"
        f"&include=odds"
        f"&filters[fixture_start_between]={datetime.now(timezone.utc).strftime('%Y-%m-%d')};2099-12-31"
        f"&per_page=25"
        f"&page={page}"
    )
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return resp.json()


def extract_1x2_odds(odds_list: list) -> tuple[float | None, float | None, float | None]:
    """
    Parse the odds array included on a fixture and return
    (home_odds, draw_odds, away_odds) for the 1X2 market.
    Returns (None, None, None) if not found.
    """
    home = draw = away = None
    for odd in odds_list:
        # Filter to 1X2 market only
        if odd.get("market_id") != MARKET_ID_1X2:
            continue
        label = (odd.get("label") or "").strip()
        value = odd.get("value")
        if value is None:
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            continue
        if label == LABEL_HOME:
            home = value
        elif label == LABEL_DRAW:
            draw = value
        elif label == LABEL_AWAY:
            away = value
    return home, draw, away


def parse_team_names(fixture: dict) -> tuple[str, str]:
    """
    Extract home/away team names.
    Sportmonks v3 puts them in fixture['name'] as 'Home vs Away'
    when participants are not included, or in participants[] when included.
    """
    name: str = fixture.get("name") or ""
    if " vs " in name:
        parts = name.split(" vs ", 1)
        return parts[0].strip(), parts[1].strip()
    # Fallback
    return name, "Unknown"


def fetch_all_fixtures() -> list[dict]:
    """Paginate through all upcoming PL fixtures and return a flat list."""
    all_fixtures = []
    page = 1

    print(f"\n[Sportmonks] Fetching Premier League fixtures...")

    while True:
        print(f"  → Page {page}...", end=" ", flush=True)
        try:
            data = fetch_fixtures_page(page)
        except requests.HTTPError as e:
            print(f"HTTP error: {e}")
            break
        except requests.RequestException as e:
            print(f"Network error: {e}")
            break

        fixtures = data.get("data") or []
        print(f"{len(fixtures)} fixtures received")

        if not fixtures:
            break

        all_fixtures.extend(fixtures)

        # Pagination metadata
        pagination = data.get("pagination") or {}
        has_more = pagination.get("has_more", False)
        if not has_more:
            break
        page += 1

    print(f"[Sportmonks] Total fixtures fetched: {len(all_fixtures)}")
    return all_fixtures


def build_upsert_rows(fixtures: list[dict]) -> list[dict]:
    """
    Map Sportmonks fixture objects to our Supabase schema:
        id (BigInt), home_team, away_team, start_time,
        home_odds, draw_odds, away_odds
    Skips fixtures where odds are not available.
    """
    rows = []
    skipped_no_odds = 0

    for f in fixtures:
        fixture_id   = f.get("id")
        start_time   = f.get("starting_at")  # ISO 8601 string
        odds_list    = f.get("odds") or []

        home_team, away_team = parse_team_names(f)
        home_odds, draw_odds, away_odds = extract_1x2_odds(odds_list)

        # Skip if any odds are missing
        if home_odds is None or draw_odds is None or away_odds is None:
            skipped_no_odds += 1
            continue

        rows.append({
            "id":         fixture_id,
            "home_team":  home_team,
            "away_team":  away_team,
            "start_time": start_time,
            "home_odds":  home_odds,
            "draw_odds":  draw_odds,
            "away_odds":  away_odds,
        })

    print(f"[Parser]  Rows with full 1X2 odds: {len(rows)}")
    print(f"[Parser]  Rows skipped (no odds):  {skipped_no_odds}")
    return rows


def upsert_to_supabase(supabase: Client, rows: list[dict]) -> None:
    """UPSERT rows into the fixtures table. Uses id as the conflict key."""
    if not rows:
        print("[Supabase] Nothing to upsert.")
        return

    print(f"\n[Supabase] Upserting {len(rows)} rows into fixtures table...")

    # Supabase Python client upsert — on_conflict defaults to primary key (id)
    result = (
        supabase.table("fixtures")
        .upsert(rows, on_conflict="id")
        .execute()
    )

    upserted_count = len(result.data) if result.data else 0
    print(f"[Supabase] ✅ Upserted {upserted_count} rows successfully.")


def main() -> None:
    print("=" * 60)
    print("  TurboPlay — Fixtures Sync Worker")
    print(f"  Started at: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # ── Validate env ──────────────────────────────────────────
    if not validate_env():
        sys.exit(1)

    # ── Connect to Supabase ───────────────────────────────────
    print(f"\n[Supabase] Connecting to {SUPABASE_URL}...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    print("[Supabase] Connected ✓")

    # ── Fetch from Sportmonks ─────────────────────────────────
    fixtures = fetch_all_fixtures()

    if not fixtures:
        print("\n[Worker] No fixtures returned from Sportmonks. Exiting.")
        sys.exit(0)

    # ── Build upsert payload ──────────────────────────────────
    rows = build_upsert_rows(fixtures)

    # ── Upsert to Supabase ────────────────────────────────────
    upsert_to_supabase(supabase, rows)

    print("\n" + "=" * 60)
    print(f"  Sync complete at: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)


if __name__ == "__main__":
    main()
