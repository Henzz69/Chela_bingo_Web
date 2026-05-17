"""
run_cleanup_migration.py
Applies 20260411192400_cleanup_ghosts.sql to the Supabase project.
"""
import json
import urllib.request
import urllib.error
import sys

PROJECT_REF = "gcdzcpagjjrtnewtnwps"
SERVICE_ROLE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdjZHpjcGFnampydG5ld3Rud3BzIiwicm9sZSI6"
    "InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk5NDkzMSwiZXhwIjoyMDg5NTcwOTMxfQ"
    ".u1ZNHdFmRUz9JyoQz2VBh1E1goTEp6KMDD6UfGmhZx4"
)
MIGRATION_FILE = r"C:\Users\Henok\betting-site\frontend\supabase\20260411192400_cleanup_ghosts.sql"
QUERY_URL = "https://{}.supabase.co/pg/query".format(PROJECT_REF)

def main():
    # Read migration
    with open(MIGRATION_FILE, "r", encoding="utf-8") as f:
        sql = f.read()
    print("Migration loaded: {} chars".format(len(sql)))

    # Execute via /pg/query
    payload = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        QUERY_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": "Bearer " + SERVICE_ROLE_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")
            print("HTTP {}".format(status))
            print("Response: {}".format(body[:2000]))
            if status in (200, 201, 204):
                print("\n[SUCCESS] Migration applied!")
            return status
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8")
        print("HTTP {}".format(status))
        print("Error: {}".format(body[:2000]))
    except Exception as ex:
        print("Exception: {}".format(ex))
        status = 0

    if status not in (200, 201, 204):
        print("\n" + "=" * 60)
        print("MANUAL EXECUTION REQUIRED")
        print("=" * 60)
        print()
        print("Go to: https://supabase.com/dashboard/project/{}/sql/new".format(PROJECT_REF))
        print("Paste the contents of:")
        print("  {}".format(MIGRATION_FILE))
        print("Click 'Run'")
    return status

if __name__ == "__main__":
    sys.exit(0 if main() in (200, 201, 204) else 1)
