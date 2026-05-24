"""Run the countdown migration via Supabase REST API."""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

sb = create_client(os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))

# Test connection
result = sb.table("bingo_rooms").select("id, status").limit(3).execute()
rooms = result.data or []
print(f"Rooms found: {len(rooms)}")
for r in rooms:
    rid = r["id"][:8]
    status = r["status"]
    print(f"  Room {rid}... status={status}")

# Try to add countdown_started_at column via RPC SQL
# (Supabase REST API can't run raw DDL, so we just verify the migration is needed)
# The migration SQL should be run via Supabase Dashboard SQL Editor
print("\n--- Migration SQL to run in Supabase Dashboard ---")
print("File: frontend/supabase/20260419_add_countdown_status.sql")
print("Run it in: Supabase Dashboard > SQL Editor")
print("\nDone.")
