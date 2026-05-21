"""
Bingo Caller — Multiplayer Batching Engine (Bulletproof Edition)
==============================================================
- MIN_PLAYERS: 2
- JOIN_WINDOW_SECONDS: 30 (Waits 30s after the room hits the front of the queue)
- COUNTDOWN_SECONDS: 5 (Doors locked, prepare to start)
"""

import os
import time
import random
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

# ── Load env ──────────────────────────────────────────────────
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=ENV_FILE, override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

# Initialize Supabase client
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Config ────────────────────────────────────────────────────
MIN_PLAYERS           = 2   # Must have at least 2 players to play Bingo
JOIN_WINDOW_SECONDS   = 30  # Time allowed for others to join once unblocked
COUNTDOWN_SECONDS     = 5   # Doors locked visual
DRAW_INTERVAL         = 3   # Draw a number every 3 seconds
TICK_INTERVAL         = 1   
MAX_CONCURRENT_GAMES  = 3
OVERFLOW_PLAYER_LIMIT = 100

_last_draw_time: dict[str, float] = {}
_room_unblocked_at: dict[str, float] = {} # Tracks when a room hits the front of the queue

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[ENGINE {ts}] {msg}")

def get_running_games_count(entry_fee: float) -> int:
    try:
        res = sb.table("bingo_rooms").select("id", count="exact").in_("status", ["countdown", "active"]).eq("entry_fee", entry_fee).execute()
        return res.count or 0
    except Exception as e:
        log(f"⚠️ Error counting running games: {e}")
        return 0

def get_player_count(room_id: str) -> int:
    try:
        res = sb.table("bingo_cards").select("id", count="exact").eq("room_id", room_id).execute()
        return res.count or 0
    except Exception as e:
        log(f"⚠️ Error counting players for {room_id[:8]}: {e}")
        return 0

def get_first_player_join_time(room_id: str):
    """Finds exactly when Player 1 bought their card."""
    try:
        res = sb.table("bingo_cards").select("*").eq("room_id", room_id).order("id").limit(1).execute()
        
        if res.data and len(res.data) > 0:
            row = res.data[0]
            raw_time = row.get("joined_at") or row.get("created_at") or row.get("inserted_at")
            
            if raw_time:
                clean_time = raw_time.replace("Z", "+00:00")
                return datetime.fromisoformat(clean_time)
            else:
                log(f"🚨 DB WARNING: Card exists, but no timestamp column found! Raw DB Row: {row}")
        else:
            log(f"🚨 DB WARNING: No cards found for room {room_id}")
            
    except Exception as e:
        log(f"❌ TIME PARSE ERROR: {e}")
        
    return None

# ══════════════════════════════════════════════════════════════
# ZOMBIE CLEANUP
# ══════════════════════════════════════════════════════════════
def cleanup_zombie_rooms():
    log("🧹 Sweeping database for zombie rooms...")
    try:
        res = sb.table("bingo_rooms").select("id").in_("status", ["countdown", "active"]).execute()
        zombies = res.data or []
        if not zombies:
            log("✨ No zombies found. Database is clean.")
            return

        for z in zombies:
            sb.table("bingo_rooms").update({"status": "finished", "finished_at": now_utc().isoformat()}).eq("id", z["id"]).execute()
            log(f"💀 Killed zombie room: {z['id'][:8]}")
    except Exception as e:
        log(f"[ERROR] Failed to clean zombie rooms. Error: {e}")

# ══════════════════════════════════════════════════════════════
# PHASE 1: WAITING → COUNTDOWN (The Join Window & Queue)
# ══════════════════════════════════════════════════════════════
def process_waiting_rooms():
    try:
        result = sb.table("bingo_rooms").select("*").eq("status", "waiting").execute()
        rooms = result.data or []
    except Exception as e:
        log(f"⚠️ Error fetching waiting rooms: {e}")
        return

    for room in rooms:
        room_id = room["id"]
        entry_fee = room.get("entry_fee", 10)
        
        running_count = get_running_games_count(entry_fee)
        player_count = get_player_count(room_id)

        should_start = False
        reason = ""

        # Print basic status if people are in the room
        if player_count > 0:
            log(f"👀 X-RAY: Room {room_id[:8]} has {player_count} player(s). Active games: {running_count}")

        # RULE 1: OVERFLOW PROTECTION
        if player_count >= OVERFLOW_PLAYER_LIMIT and running_count < MAX_CONCURRENT_GAMES:
            should_start = True
            reason = "Lobby Overflow (100+ Players)"
            
        # RULE 2: THE QUEUE MANAGER
        elif running_count >= MAX_CONCURRENT_GAMES:
            if player_count > 0:
                log(f"🛑 QUEUED: Room {room_id[:8]} is waiting for current games to finish...")
                _room_unblocked_at[room_id] = time.time()
                
        # RULE 3: THE COUNTDOWN WINDOW
        elif running_count < MAX_CONCURRENT_GAMES:
            if player_count >= MIN_PLAYERS:
                first_join = get_first_player_join_time(room_id)
                if first_join:
                    unblocked_ts = _room_unblocked_at.get(room_id, 0.0)
                    start_measuring_from = max(first_join.timestamp(), unblocked_ts)
                    elapsed = time.time() - start_measuring_from
                    
                    if elapsed >= JOIN_WINDOW_SECONDS:
                        should_start = True
                        reason = f"30s Join Window Closed ({player_count} players batch)"
                    else:
                        remaining = int(JOIN_WINDOW_SECONDS - elapsed)
                        if remaining % 2 == 0 and remaining > 0:
                            log(f"⏳ Room {room_id[:8]} gathering players ({remaining}s left in window)...")
                else:
                    log(f"⚠️ Timestamp missing but 2+ players present. Starting Room {room_id[:8]}.")
                    should_start = True
                    reason = "Force Start (Failsafe for 2+ Players)"

        if should_start:
            try:
                sb.table("bingo_rooms").update({
                    "status": "countdown",
                    "countdown_started_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()
                
                log(f"🟡 Room {room_id[:8]} → DOORS LOCKED. Reason: {reason}")
                _room_unblocked_at.pop(room_id, None)

                new_room = {
                    "status": "waiting",
                    "entry_fee": entry_fee,
                    "max_players": room.get("max_players"),
                }
                sb.table("bingo_rooms").insert(new_room).execute()
                log(f"🌱 Spawned new {entry_fee} ETB Lobby.")

            except Exception as e:
                log(f"[ERROR] Transitioning room to countdown: {e}")

# ══════════════════════════════════════════════════════════════
# PHASE 2: COUNTDOWN → ACTIVE (The Final Override)
# ══════════════════════════════════════════════════════════════
def process_countdown_rooms():
    try:
        result = sb.table("bingo_rooms").select("*").eq("status", "countdown").execute()
        rooms = result.data or []
    except Exception as e: 
        log(f"⚠️ Error fetching countdown rooms: {e}")
        return

    for room in rooms:
        room_id = room["id"]
        entry_fee = room.get("entry_fee", 10)
        
        try:
            active_res = sb.table("bingo_rooms").select("id", count="exact").eq("status", "active").eq("entry_fee", entry_fee).execute()
            active_count = active_res.count or 0
        except Exception as e:
            log(f"⚠️ Error checking active count for {room_id[:8]}: {e}")
            active_count = 0
            
        # FIX: Ensure we don't bypass our 3 concurrent game limit!
        if active_count >= MAX_CONCURRENT_GAMES:
            sb.table("bingo_rooms").update({"status": "waiting"}).eq("id", room_id).execute()
            log(f"⏪ Room {room_id[:8]} slapped back to WAITING (Game Limit Reached).")
            continue

        cd_started = room.get("countdown_started_at")
        if not cd_started: continue

        try:
            started = datetime.fromisoformat(cd_started.replace("Z", "+00:00"))
        except Exception:
            started = now_utc()

        if (now_utc() - started).total_seconds() >= COUNTDOWN_SECONDS:
            try:
                # FIX: Shuffle the hat of 75 numbers right before the game begins!
                shuffled_hat = random.sample(range(1, 76), 75)
                
                sb.table("bingo_rooms").update({
                    "status": "active",
                    "started_at": now_utc().isoformat(),
                    "draw_sequence": shuffled_hat,
                    "drawn_numbers": []
                }).eq("id", room_id).execute()

                _last_draw_time[room_id] = time.time()
                log(f"🟢 Room {room_id[:8]} → ACTIVE (Game Started with Shuffled Deck!)")
            except Exception as e: 
                log(f"❌ ERROR activating game {room_id[:8]}: {e}")

# ══════════════════════════════════════════════════════════════
# PHASE 3: ACTIVE → FINISHED
# ══════════════════════════════════════════════════════════════
def process_active_rooms():
    try:
        result = sb.table("bingo_rooms").select("id, draw_sequence, drawn_numbers").eq("status", "active").execute()
        rooms = result.data or []
    except Exception as e: 
        log(f"⚠️ Error fetching active rooms: {e}")
        return

    for room in rooms:
        room_id = room["id"]
        draw_seq = room.get("draw_sequence") or []
        drawn = room.get("drawn_numbers") or []

        if isinstance(draw_seq, str): draw_seq = json.loads(draw_seq)
        if isinstance(drawn, str): drawn = json.loads(drawn)

        if len(drawn) >= 75:
            try:
                sb.table("bingo_rooms").update({
                    "status": "finished",
                    "finished_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()
                log(f"🔴 Room {room_id[:8]} → FINISHED")
                _last_draw_time.pop(room_id, None)
            except Exception as e: 
                log(f"❌ ERROR finishing room {room_id[:8]}: {e}")
            continue

        last_draw = _last_draw_time.get(room_id, 0)
        if time.time() - last_draw < DRAW_INTERVAL: continue

        next_index = len(drawn)
        if next_index >= len(draw_seq): continue

        next_number = draw_seq[next_index]
        updated_drawn = drawn + [next_number]

        try:
            sb.table("bingo_rooms").update({"drawn_numbers": updated_drawn}).eq("id", room_id).execute()
            _last_draw_time[room_id] = time.time()
            col = "BINGO"[min((next_number - 1) // 15, 4)]
            log(f"🎱 Room {room_id[:8]} drew {col}-{next_number} ({next_index + 1}/75)")
        except Exception as e: 
            log(f"❌ ERROR drawing number for {room_id[:8]}: {e}")

# ══════════════════════════════════════════════════════════════
# BOOTSTRAP LOBBY
# ══════════════════════════════════════════════════════════════
def ensure_initial_rooms():
    try:
        res = sb.table("bingo_rooms").select("id").eq("status", "waiting").execute()
        if not res.data:
            sb.table("bingo_rooms").insert({"status": "waiting", "entry_fee": 10}).execute()
    except Exception as e: 
        log(f"⚠️ Error bootstrapping initial rooms: {e}")

def main():
    log("=" * 50)
    log("🎰 CHELA Bingo Engine Online (Bulletproof Edition)")
    log("=" * 50)
    
    cleanup_zombie_rooms()
    ensure_initial_rooms()

    while True:
        try:
            process_waiting_rooms()
            process_countdown_rooms()
            process_active_rooms()
        except Exception as e:
            log(f"[FATAL] Main loop error: {e}")
        time.sleep(TICK_INTERVAL)

if __name__ == "__main__":
    main()