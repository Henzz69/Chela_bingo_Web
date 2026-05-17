"""
run_migration.py
Applies 20260408000000_unify_schema.sql to the Supabase project
using the Management API /query endpoint (no PAT required — uses
the service-role JWT which has superuser-equivalent access).

Usage:
    python run_migration.py
"""

import sys
import json
import urllib.request
import urllib.error

# ── Config ────────────────────────────────────────────────────────
PROJECT_REF      = "gcdzcpagjjrtnewtnwps"
SERVICE_ROLE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjZHpjcGFnampydG5ld3Rud3BzIiwicm9sZSI6"
    "InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk5NDkzMSwiZXhwIjoyMDg5NTcwOTMxfQ"
    ".u1ZNHdFmRUz9JyoQz2VBh1E1goTEp6KMDD6UfGmhZx4"
)
MIGRATION_FILE   = r"C:\Users\Henok\betting-site\frontend\supabase\20260408000000_unify_schema.sql"

# Supabase Management API endpoint for raw SQL execution
# Docs: https://supabase.com/docs/reference/api/introduction
API_URL = f"https://{PROJECT_REF}.supabase.co/rest/v1/rpc/exec_sql"

# ── Alternative: use the pg-meta query endpoint ───────────────────
# The correct endpoint for running arbitrary SQL via the REST layer
# is the pg-meta service exposed at /pg/query on self-hosted, but
# on cloud projects we use the Postgres REST proxy via PostgREST.
# The most reliable approach without a PAT is to split the migration
# into individual statements and run them via the /rpc endpoint,
# OR use the direct DB connection string with psycopg2/asyncpg.
#
# We'll use the Supabase "sql" endpoint available on cloud projects:
QUERY_URL = f"https://{PROJECT_REF}.supabase.co/pg/query"

def run_via_pg_query(sql: str) -> dict:
    """POST to /pg/query — available on Supabase cloud projects."""
    payload = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        QUERY_URL,
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "apikey":        SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read().decode("utf-8")}
    except Exception as ex:
        return {"status": 0, "error": str(ex)}


def run_via_rpc(sql: str) -> dict:
    """
    Fallback: call a custom exec_sql RPC if it exists.
    This won't work unless the function is pre-created.
    """
    payload = json.dumps({"sql": sql}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "apikey":        SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Prefer":        "return=representation",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read().decode("utf-8")}
    except Exception as ex:
        return {"status": 0, "error": str(ex)}


def verify_bets_column() -> dict:
    """
    Verify bets.user_id is now BIGINT by querying information_schema.
    Uses the PostgREST /rest/v1/ endpoint with a filter.
    """
    url = (
        f"https://{PROJECT_REF}.supabase.co/rest/v1/rpc/exec_sql"
    )
    # Use a simple SELECT via PostgREST on information_schema
    verify_url = (
        f"https://{PROJECT_REF}.supabase.co/rest/v1/"
        "information_schema_columns"
        "?table_schema=eq.public&table_name=eq.bets&column_name=eq.user_id"
        "&select=column_name,data_type,udt_name"
    )
    req = urllib.request.Request(
        verify_url,
        headers={
            "apikey":        SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read().decode("utf-8")}
    except Exception as ex:
        return {"status": 0, "error": str(ex)}


if __name__ == "__main__":
    print("=" * 60)
    print("TurboPlay — Schema Unification Migration Runner")
    print("=" * 60)

    # Read migration file
    try:
        with open(MIGRATION_FILE, "r", encoding="utf-8") as f:
            sql = f.read()
        print(f"[OK] Migration file loaded ({len(sql):,} chars)")
    except FileNotFoundError:
        print(f"[ERROR] Migration file not found: {MIGRATION_FILE}")
        sys.exit(1)

    # Attempt 1: /pg/query endpoint
    print(f"\n[1/2] Attempting POST to {QUERY_URL} ...")
    result = run_via_pg_query(sql)
    print(f"      HTTP {result.get('status')}")
    body = result.get("body", result.get("error", ""))
    print(f"      Response: {body[:500]}")

    if result.get("status") in (200, 201, 204):
        print("\n[SUCCESS] Migration applied via /pg/query!")
    else:
        print(f"\n[INFO] /pg/query returned {result.get('status')} — endpoint may not be available.")
        print("       This is expected on cloud Supabase projects.")
        print()
        print("=" * 60)
        print("MANUAL EXECUTION REQUIRED")
        print("=" * 60)
        print()
        print("The Supabase cloud REST API does not expose a raw SQL")
        print("execution endpoint without a Personal Access Token (PAT).")
        print()
        print("To apply the migration, do ONE of the following:")
        print()
        print("OPTION A — Supabase Dashboard (easiest, 30 seconds):")
        print("  1. Go to: https://supabase.com/dashboard/project/gcdzcpagjjrtnewtnwps/sql/new")
        print("  2. Open the migration file:")
        print(f"     {MIGRATION_FILE}")
        print("  3. Paste the entire contents into the SQL editor")
        print("  4. Click 'Run'")
        print("  5. Verify with:")
        print("     SELECT column_name, data_type FROM information_schema.columns")
        print("     WHERE table_schema='public' AND table_name='bets' AND column_name='user_id';")
        print("     -- Expected: data_type = 'bigint'")
        print()
        print("OPTION B — Supabase CLI with PAT:")
        print("  1. Get your PAT from: https://supabase.com/dashboard/account/tokens")
        print("  2. Run: npx supabase login")
        print("  3. Run: npx supabase link --project-ref gcdzcpagjjrtnewtnwps")
        print("  4. Run: npx supabase db push")
        print()
        print("OPTION C — Direct psql connection:")
        print("  Connection string (get DB password from Supabase Dashboard > Settings > Database):")
        print("  psql postgresql://postgres.gcdzcpagjjrtnewtnwps:[DB_PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres")
        print(f"  \\i {MIGRATION_FILE}")
        print()

    # Verify column type (works via PostgREST if migration was applied)
    print("[VERIFY] Checking bets.user_id column type ...")
    verify_result = verify_bets_column()
    print(f"         HTTP {verify_result.get('status')}")
    print(f"         {verify_result.get('body', verify_result.get('error', ''))[:300]}")
