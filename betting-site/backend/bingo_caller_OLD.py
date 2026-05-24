"""
Bingo Caller — Automated Room State Engine
===========================================
Standalone Python script that manages the bingo room life cycle.

Loop (every 1 second):
  1. Find 'waiting' rooms with enough players → set to 'countdown'
  2. Find 'countdown' rooms where 30s expired → set to 'active', begin draws
  3. For 'active' rooms → draw a number every 7 seconds
  4. Skip 'finished' rooms entirely

Run:  python bingo_caller.py
Deps: pip install supabase python-dotenv
"""

import os
import time
import random
import json
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from supabase import create_client

# ── Load env ──────────────────────────────────────────────────
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(dotenv_path=ENV_FILE, override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Config ────────────────────────────────────────────────────
COUNTDOWN_SECONDS = 30    # Duration of countdown phase
DRAW_INTERVAL     = 7     # Seconds between number draws
TICK_INTERVAL     = 1     # Main loop tick interval
MIN_PLAYERS_DEFAULT = 2   # Default minimum players to start countdown

# Track last draw time per room to enforce DRAW_INTERVAL
_last_draw_time: dict[str, float] = {}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[CALLER {ts}] {msg}")


# ── Generate a shuffled 1-75 draw sequence ────────────────────
def generate_draw_sequence() -> list[int]:
    seq = list(range(1, 76))
    random.shuffle(seq)
    return seq


# ── Count players in a room (bingo_cards table) ──────────────
def count_players(room_id: str) -> int:
    try:
        result = (
            sb.table("bingo_cards")
            .select("id", count="exact")
            .eq("room_id", room_id)
            .execute()
        )
        return result.count if result.count is not None else len(result.data or [])
    except Exception as e:
        log(f"  [ERROR] count_players({room_id}): {e}")
        return 0


# ══════════════════════════════════════════════════════════════
# PHASE 1: waiting → countdown
# Find rooms in 'waiting' that have >= min_players
# ══════════════════════════════════════════════════════════════
def process_waiting_rooms():
    try:
        result = (
            sb.table("bingo_rooms")
            .select("id, min_players, stake")
            .eq("status", "waiting")
            .execute()
        )
        rooms = result.data or []
    except Exception as e:
        log(f"[ERROR] Fetching waiting rooms: {e}")
        return

    for room in rooms:
        room_id = room["id"]
        min_players = room.get("min_players") or MIN_PLAYERS_DEFAULT
        player_count = count_players(room_id)

        if player_count >= min_players:
            # Generate draw sequence and transition to countdown
            draw_seq = generate_draw_sequence()
            try:
                sb.table("bingo_rooms").update({
                    "status": "countdown",
                    "countdown_started_at": now_utc().isoformat(),
                    "draw_sequence": draw_seq,
                    "drawn_numbers": [],
                }).eq("id", room_id).execute()

                log(f"🟡 Room {room_id[:8]}... → COUNTDOWN ({player_count} players, stake={room.get('stake', '?')})")
            except Exception as e:
                log(f"[ERROR] Transitioning room {room_id[:8]} to countdown: {e}")


# ══════════════════════════════════════════════════════════════
# PHASE 2: countdown → active
# Find rooms in 'countdown' where 30s has elapsed
# ══════════════════════════════════════════════════════════════
def process_countdown_rooms():
    try:
        result = (
            sb.table("bingo_rooms")
            .select("id, countdown_started_at, stake")
            .eq("status", "countdown")
            .execute()
        )
        rooms = result.data or []
    except Exception as e:
        log(f"[ERROR] Fetching countdown rooms: {e}")
        return

    for room in rooms:
        room_id = room["id"]
        cd_started = room.get("countdown_started_at")

        if not cd_started:
            # Safety: if no timestamp, set it now
            sb.table("bingo_rooms").update({
                "countdown_started_at": now_utc().isoformat(),
            }).eq("id", room_id).execute()
            continue

        try:
            started = datetime.fromisoformat(cd_started.replace("Z", "+00:00"))
        except Exception:
            started = now_utc()

        elapsed = (now_utc() - started).total_seconds()

        if elapsed >= COUNTDOWN_SECONDS:
            # Transition to active — game begins!
            try:
                sb.table("bingo_rooms").update({
                    "status": "active",
                    "started_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()

                _last_draw_time[room_id] = time.time()
                log(f"🟢 Room {room_id[:8]}... → ACTIVE (countdown complete, game starting!)")
            except Exception as e:
                log(f"[ERROR] Transitioning room {room_id[:8]} to active: {e}")
        else:
            remaining = COUNTDOWN_SECONDS - int(elapsed)
            if remaining % 10 == 0 and remaining > 0:
                log(f"⏳ Room {room_id[:8]}... countdown: {remaining}s remaining")


# ══════════════════════════════════════════════════════════════
# PHASE 3: active → draw numbers
# For active rooms, draw every DRAW_INTERVAL seconds
# ══════════════════════════════════════════════════════════════
def process_active_rooms():
    try:
        result = (
            sb.table("bingo_rooms")
            .select("id, draw_sequence, drawn_numbers, stake")
            .eq("status", "active")
            .execute()
        )
        rooms = result.data or []
    except Exception as e:
        log(f"[ERROR] Fetching active rooms: {e}")
        return

    for room in rooms:
        room_id = room["id"]
        draw_seq = room.get("draw_sequence") or []
        drawn = room.get("drawn_numbers") or []

        # Parse JSONB if string
        if isinstance(draw_seq, str):
            draw_seq = json.loads(draw_seq)
        if isinstance(drawn, str):
            drawn = json.loads(drawn)

        # All 75 drawn → game should be finished
        if len(drawn) >= 75:
            try:
                sb.table("bingo_rooms").update({
                    "status": "finished",
                    "finished_at": now_utc().isoformat(),
                }).eq("id", room_id).execute()
                log(f"🔴 Room {room_id[:8]}... → FINISHED (all 75 numbers drawn)")
                _last_draw_time.pop(room_id, None)
            except Exception as e:
                log(f"[ERROR] Finishing room {room_id[:8]}: {e}")
            continue

        # Check if enough time has passed since last draw
        last_draw = _last_draw_time.get(room_id, 0)
        if time.time() - last_draw < DRAW_INTERVAL:
            continue

        # Draw the next number
        next_index = len(drawn)
        if next_index >= len(draw_seq):
            continue

        next_number = draw_seq[next_index]
        updated_drawn = drawn + [next_number]

        try:
            sb.table("bingo_rooms").update({
                "drawn_numbers": updated_drawn,
            }).eq("id", room_id).execute()

            _last_draw_time[room_id] = time.time()

            # Column letter for display
            col_letter = "BINGO"[min((next_number - 1) // 15, 4)]
            log(f"🎱 Room {room_id[:8]}... drew {col_letter}-{next_number} (#{next_index + 1}/75)")

            # Also log to bingo_draw_log
            try:
                sb.table("bingo_draw_log").insert({
                    "room_id": room_id,
                    "draw_position": next_index + 1,
                    "number_drawn": next_number,
                }).execute()
            except Exception:
                pass  # Non-fatal
        except Exception as e:
            log(f"[ERROR] Drawing number for room {room_id[:8]}: {e}")


# ══════════════════════════════════════════════════════════════
# MAIN LOOP
# ══════════════════════════════════════════════════════════════
def main():
    log("=" * 50)
    log("🎰 Bingo Caller Engine starting...")
    log(f"   Countdown: {COUNTDOWN_SECONDS}s")
    log(f"   Draw interval: {DRAW_INTERVAL}s")
    log(f"   Tick interval: {TICK_INTERVAL}s")
    log("=" * 50)

    cycle = 0
    while True:
        try:
            process_waiting_rooms()
            process_countdown_rooms()
            process_active_rooms()
        except Exception as e:
            log(f"[FATAL] Unhandled error in main loop: {e}")

        cycle += 1
        if cycle % 60 == 0:  # Every 60 seconds, print a heartbeat
            log("💓 Heartbeat — engine running")

        time.sleep(TICK_INTERVAL)


if __name__ == "__main__":
    main()
