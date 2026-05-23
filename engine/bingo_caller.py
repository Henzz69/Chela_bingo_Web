"""
Bingo Caller — Multiplayer Batching Engine (Streamlined Edition)
==============================================================
- MIN_PLAYERS: 2
- COUNTDOWN_SECONDS: 30 (Starts the moment 2 players are in the lobby)
- DOOR_LOCK_SECONDS: 5 (Brief pause before numbers draw)
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
MIN_PLAYERS           = 2   
COUNTDOWN_SECONDS     = 30  # 30 seconds to gather more players once we hit the minimum
DOOR_LOCK_SECONDS     = 5   # Quick buffer before drawing
DRAW_INTERVAL         = 3   
TICK_INTERVAL         = 1   
MAX_CONCURRENT_GAMES  = 3

_last_draw_time: dict[str, float] = {}

# This dictionary tracks exactly when a room successfully hit 2+ players
_room_ready_timers: dict[str, float] = {} 

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[ENGINE {ts}] {msg}")

def get_running_games_count(entry_fee: float) -> int:
    try:
        res = sb.table("bingo_rooms").select("id", count="exact").in_("status", ["countdown", "active"]).eq("entry_fee", entry_fee).execute()
        return res.count or 0
    except Exception: return 0

def get_player_count(room_id: str) -> int:
    try:
        res = sb.table("bingo_cards").select("id", count="exact").eq("room_id", room_id).execute()
        return res.count or 0
    except Exception: return 0

# ══════════════════════════════════════════════════════════════
# ZOMBIE CLEANUP
# ══════════════════════════════════════════════════════════════
def cleanup_zombie_rooms():
    log("🧹 Sweeping database for zombie rooms...")
    try:
        res = sb.table("bingo_rooms").select("id").in_("status", ["countdown", "active"]).execute()
        zombies = res.data or []
        for z in zombies:
            sb.table("bingo_rooms").update({"status": "finished", "finished_at": now_utc().isoformat()}).eq("id", z["id"]).execute()
            log(f"💀 Killed zombie room: {z['id'][:8]}")
    except Exception: pass

# ══════════════════════════════════════════════════════════════
# PHASE 1: WAITING → COUNTDOWN (The 30-Second Rule)
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

        # 1. The Room is Empty or Only Has 1 Player (Do nothing, wait forever)
        if player_count < MIN_PLAYERS:
            if player_count == 1:
                log(f"👤 Room {room_id[:8]} has 1 player. Waiting for an opponent...")
            
            # Reset timer if someone leaves and it drops below 2
            if room_id in _room_ready_timers:
                _room_ready_timers.pop(room_id)
            continue

        # 2. The Server is Full (Wait in queue)
        if running_count >= MAX_CONCURRENT_GAMES:
            log(f"🛑 QUEUED: Room {room_id[:8]} has players but server is full. Waiting...")
            # Keep resetting their timer so the 30s doesn't expire while they are blocked
            _room_ready_timers[room_id] = time.time()
            continue

        # 3. We have 2+ Players AND the server has space!
        # If we haven't started their timer yet, start it right now.
        if room_id not in _room_ready_timers:
            _room_ready_timers[room_id] = time.time()
            log(f"🔥 Room {room_id[:8]} hit {MIN_PLAYERS} players! Starting 30s countdown...")

        # Calculate how long it has been since we hit 2 players
        elapsed = time.time() - _room_ready_timers[room_id]
        
        if elapsed >= COUNTDOWN_SECONDS:
            # Time is up! Lock the doors!
            try:
                sb.table("bingo_rooms").update({
                    "status": "countdown",
                    "countdown_started_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()
                
                log(f"🟡 Room {room_id[:8]} → DOORS LOCKED ({player_count} players).")
                _room_ready_timers.pop(room_id, None)

                # Immediately spawn the next empty lobby for new players
                new_room = {
                    "status": "waiting",
                    "entry_fee": entry_fee,
                    "max_players": room.get("max_players", 100),
                }
                sb.table("bingo_rooms").insert(new_room).execute()

            except Exception as e:
                log(f"[ERROR] Locking doors: {e}")
        else:
            # Still ticking down...
            remaining = int(COUNTDOWN_SECONDS - elapsed)
            if remaining % 5 == 0 and remaining > 0:  # Print every 5 seconds to reduce log spam
                log(f"⏳ Room {room_id[:8]} starting in {remaining}s... ({player_count} players joined)")

# ══════════════════════════════════════════════════════════════
# PHASE 2: COUNTDOWN → ACTIVE (Door Lock Buffer)
# ══════════════════════════════════════════════════════════════
def process_countdown_rooms():
    try:
        result = sb.table("bingo_rooms").select("*").eq("status", "countdown").execute()
        rooms = result.data or []
    except Exception: return

    for room in rooms:
        room_id = room["id"]
        
        cd_started = room.get("countdown_started_at")
        if not cd_started: continue

        try:
            started = datetime.fromisoformat(cd_started.replace("Z", "+00:00"))
        except Exception:
            started = now_utc()

        if (now_utc() - started).total_seconds() >= DOOR_LOCK_SECONDS:
            try:
                # Shuffle the hat of 75 numbers right before the game begins!
                shuffled_hat = random.sample(range(1, 76), 75)
                
                sb.table("bingo_rooms").update({
                    "status": "active",
                    "started_at": now_utc().isoformat(),
                    "draw_sequence": shuffled_hat,
                    "drawn_numbers": []
                }).eq("id", room_id).execute()

                _last_draw_time[room_id] = time.time()
                log(f"🟢 Room {room_id[:8]} → ACTIVE (Game Started!)")
            except Exception as e: 
                log(f"❌ ERROR activating game {room_id[:8]}: {e}")

# ══════════════════════════════════════════════════════════════
# PHASE 3: ACTIVE → FINISHED
# ══════════════════════════════════════════════════════════════
def process_active_rooms():
    try:
        result = sb.table("bingo_rooms").select("id, draw_sequence, drawn_numbers").eq("status", "active").execute()
        rooms = result.data or []
    except Exception: return

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
            except Exception: pass
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
        except Exception: pass

# ══════════════════════════════════════════════════════════════
# BOOTSTRAP LOBBY
# ══════════════════════════════════════════════════════════════
def ensure_initial_rooms():
    try:
        res = sb.table("bingo_rooms").select("id").eq("status", "waiting").execute()
        if not res.data:
            sb.table("bingo_rooms").insert({"status": "waiting", "entry_fee": 10}).execute()
    except Exception: pass

def main():
    log("=" * 50)
    log("🎰 CHELA Bingo Engine Online (Streamlined Edition)")
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