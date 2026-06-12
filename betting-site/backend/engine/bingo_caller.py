"""
Bingo Caller — Multiplayer Batching Engine (Elastic Edition V2)
==============================================================
- MIN_PLAYERS: 2
- BASE_COUNTDOWN: 50 seconds
- ELASTIC EXTENSION: +2.5 seconds per player
- HARD CAP: 100 seconds maximum waiting time
- INSTANT LOCK: Automatically starts if lobby hits 100 players
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
BASE_COUNTDOWN        = 50.0  # 🚀 Starting timer
MAX_HARD_CAP          = 100.0 # 🚀 Absolute maximum wait time
ELASTIC_BONUS         = 2.5   # 🚀 Seconds added per player

DOOR_LOCK_SECONDS     = 5   
DRAW_INTERVAL         = 3   
TICK_INTERVAL         = 1   
MAX_CONCURRENT_GAMES  = 3

# Engine-level memory
_last_draw_time: dict[str, float] = {}
_boarding_start_times: dict[str, float] = {}
_expected_start_times: dict[str, float] = {} # 🚀 Tracks the exact UNIX timestamp the game will start

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
# PHASE 1: WAITING → COUNTDOWN (THE ELASTIC TIMER)
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
        max_capacity = room.get("max_players", 100)
        
        running_count = get_running_games_count(entry_fee)
        player_count = get_player_count(room_id)

        # 1. Not enough players
        if player_count < MIN_PLAYERS:
            if room_id in _boarding_start_times:
                log(f"📉 Room {room_id[:8]} fell below minimum players. Clock paused.")
                _boarding_start_times.pop(room_id, None)
                _expected_start_times.pop(room_id, None)
                try: sb.table("bingo_rooms").update({"expected_start_time": None}).eq("id", room_id).execute()
                except: pass
            continue

        # 2. Server is Full
        if running_count >= MAX_CONCURRENT_GAMES:
            if int(time.time()) % 10 == 0:  
                log(f"🛑 QUEUED: Room {room_id[:8]} has {player_count} players but server is full.")
            continue

        # 3. Valid Matchmaking State!
        if room_id not in _boarding_start_times:
            _boarding_start_times[room_id] = time.time()
            
            # Initial Dynamic Setup
            initial_duration = min(MAX_HARD_CAP, BASE_COUNTDOWN + (player_count * ELASTIC_BONUS))
            target_unix = _boarding_start_times[room_id] + initial_duration
            _expected_start_times[room_id] = target_unix
            
            iso_target = datetime.fromtimestamp(target_unix, tz=timezone.utc).isoformat()
            try: sb.table("bingo_rooms").update({"expected_start_time": iso_target}).eq("id", room_id).execute()
            except: pass
            
            log(f"⏰ Room {room_id[:8]} hit minimum players! Elastic Boarding started (Base: {initial_duration}s).")

        # 🚀 THE ELASTIC CALCULATOR
        current_duration = min(MAX_HARD_CAP, BASE_COUNTDOWN + (player_count * ELASTIC_BONUS))
        current_target_unix = _boarding_start_times[room_id] + current_duration
        
        # 🚀 ANTI-SPAM SYNC: Only update database if the timer expanded by at least 2.5 seconds
        last_saved_target = _expected_start_times.get(room_id, 0)
        if current_target_unix - last_saved_target >= ELASTIC_BONUS:
            _expected_start_times[room_id] = current_target_unix
            iso_target = datetime.fromtimestamp(current_target_unix, tz=timezone.utc).isoformat()
            try:
                sb.table("bingo_rooms").update({"expected_start_time": iso_target}).eq("id", room_id).execute()
                log(f"⏱️ FRENZY: Room {room_id[:8]} timer extended! New target locked.")
            except Exception as e:
                pass

        # Check conditions
        time_is_up = time.time() >= _expected_start_times.get(room_id, time.time() + 999)
        room_is_full = player_count >= max_capacity

        if time_is_up or room_is_full:
            try:
                sb.table("bingo_rooms").update({
                    "status": "countdown",
                    "countdown_started_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()
                
                reason = "SOLD OUT" if room_is_full else "TIME UP"
                log(f"🟡 Room {room_id[:8]} → DOORS LOCKED [{reason}] ({player_count} players).")
                
                _boarding_start_times.pop(room_id, None)
                _expected_start_times.pop(room_id, None)

                # Spawn subsequent blank lobby container
                new_room = {
                    "status": "waiting",
                    "entry_fee": entry_fee,
                    "max_players": max_capacity,
                }
                sb.table("bingo_rooms").insert(new_room).execute()

            except Exception as e:
                log(f"❌ [ERROR] Locking doors for {room_id[:8]}: {e}")
        else:
            remaining = int(_expected_start_times[room_id] - time.time())
            if remaining % 10 == 0 and remaining > 0: 
                print(f"[ENGINE {now_utc().strftime('%H:%M:%S')}] ⏳ Room {room_id[:8]} boarding phase ends in ~{remaining}s... ({player_count}/100 players)")

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
    log("🎰 CHELA Bingo Engine Online (Elastic Edition V2)")
    log("=" * 50)
    
    cleanup_zombie_rooms()
    ensure_initial_rooms()

    while True:
        try:
            process_waiting_rooms()
            process_countdown_rooms()
            process_active_rooms()
        except Exception as e:
            log(f"[FATAL WATCHDOG] Main loop error caught: {e}")
        
        time.sleep(TICK_INTERVAL)

if __name__ == "__main__":
    main()