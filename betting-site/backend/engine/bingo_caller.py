"""
Bingo Caller — Multiplayer Batching Engine (Bulletproof Edition)
==============================================================
- MIN_PLAYERS: 2
- COUNTDOWN_SECONDS: 30
- DOOR_LOCK_SECONDS: 5
- Failsafe execution loops to prevent hanging
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
COUNTDOWN_SECONDS     = 30  
DOOR_LOCK_SECONDS     = 5   
DRAW_INTERVAL         = 3   
TICK_INTERVAL         = 1   
MAX_CONCURRENT_GAMES  = 3

# Engine-level memory
_last_draw_time: dict[str, float] = {}
_boarding_start_times: dict[str, float] = {}

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
        log(f"⚠️ Error counting games: {e}")
        return 0

def get_player_count(room_id: str) -> int:
    try:
        # 🚀 THE FIX: We check for status 'ready' to avoid the .not_() crash!
        res = sb.table("bingo_cards").select("id", count="exact").eq("room_id", room_id).eq("status", "ready").execute()
        return res.count or 0
    except Exception as e: 
        log(f"⚠️ Error counting players for {room_id[:8]}: {e}")
        return 0

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
    except Exception as e: 
        log(f"⚠️ Zombie cleanup failed: {e}")

# ══════════════════════════════════════════════════════════════
# PHASE 1: WAITING → COUNTDOWN
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

        # 1. Not enough players
        if player_count < MIN_PLAYERS:
            if room_id in _boarding_start_times:
                log(f"📉 Room {room_id[:8]} fell below minimum players. Clock paused.")
                _boarding_start_times.pop(room_id, None)
            continue

        # 2. Server is Full
        if running_count >= MAX_CONCURRENT_GAMES:
            if int(time.time()) % 10 == 0:  # Only log queue every 10 seconds to avoid spam
                log(f"🛑 QUEUED: Room {room_id[:8]} has {player_count} players but server is full.")
            continue

        # 3. WE HAVE 2+ PLAYERS! Start the engine clock
        if room_id not in _boarding_start_times:
            _boarding_start_times[room_id] = time.time()
            log(f"⏰ Room {room_id[:8]} hit minimum players! 30-Second boarding phase started.")

        elapsed = time.time() - _boarding_start_times[room_id]
        
        if elapsed >= COUNTDOWN_SECONDS:
            # Time is up! Lock the doors!
            try:
                sb.table("bingo_rooms").update({
                    "status": "countdown",
                    "countdown_started_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()
                
                log(f"🟡 Room {room_id[:8]} → DOORS LOCKED ({player_count} players).")
                _boarding_start_times.pop(room_id, None)

                # Spawn new lobby
                new_room = {
                    "status": "waiting",
                    "entry_fee": entry_fee,
                    "max_players": room.get("max_players", 100),
                }
                sb.table("bingo_rooms").insert(new_room).execute()

            except Exception as e:
                log(f"❌ [ERROR] Locking doors for {room_id[:8]}: {e}")
        else:
            remaining = int(COUNTDOWN_SECONDS - elapsed)
            if remaining % 5 == 0 and remaining > 0: 
                # Use a fast print to avoid IO blocking
                print(f"[ENGINE {now_utc().strftime('%H:%M:%S')}] ⏳ Room {room_id[:8]} boarding phase ends in {remaining}s... ({player_count}/100 players joined)")

# ══════════════════════════════════════════════════════════════
# PHASE 2: COUNTDOWN → ACTIVE
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
        cd_started = room.get("countdown_started_at")
        if not cd_started: continue

        try:
            started = datetime.fromisoformat(cd_started.replace("Z", "+00:00"))
        except Exception:
            started = now_utc()

        if (now_utc() - started).total_seconds() >= DOOR_LOCK_SECONDS:
            try:
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
        log(f"⚠️ Error ensuring initial rooms: {e}")

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
            # 🚀 THE WATCHDOG: Prevents the script from dying if a silent error occurs
            log(f"[FATAL WATCHDOG] Main loop error caught: {e}")
        
        # Absolute sleep to prevent CPU spiking
        time.sleep(TICK_INTERVAL)

if __name__ == "__main__":
    main()