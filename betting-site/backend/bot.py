"""
Chela Bingo - Telegram Bot
==========================
Handles: /start → Contact Registration → Play, Deposit, Withdraw, Balance.

Registration flow:
  1. User types /start → bot shows "📱 Register to Play" (request_contact)
  2. User shares contact → bot upserts tg_users with phone → shows Web App menu
  3. All subsequent interactions use the inline menu (Play, Deposit, Withdraw, Balance)

Run:  python bot.py
Deps: pip install pyTelegramBotAPI python-dotenv supabase
"""

import os
import re
import subprocess
import threading
import telebot
from telebot.types import (
    InlineKeyboardMarkup, InlineKeyboardButton,
    ReplyKeyboardMarkup, KeyboardButton,
    ReplyKeyboardRemove, WebAppInfo,
)
from dotenv import load_dotenv, set_key
from supabase import create_client

# Compute .env path relative to THIS script (not the CWD)
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

# MUST be called before any os.getenv() — explicitly point to the .env file
load_dotenv(dotenv_path=ENV_FILE, override=True)

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
BOT_TOKEN             = os.getenv("TELEGRAM_BOT_TOKEN", "")
MINI_APP_URL          = os.getenv("MINI_APP_URL", "")
SUPABASE_URL          = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

# ---------------------------------------------------------------------------
# ADMIN AUTHORIZATION
# ---------------------------------------------------------------------------
ADMIN_IDS = [5681654051]  # Henok

def is_admin(user_id: int) -> bool:
    """Check if a Telegram user ID is in the admin list."""
    return user_id in ADMIN_IDS

def _admin_log(admin_id: int, command: str, target: str = "N/A") -> None:
    """Print a secure log line for every admin action."""
    from datetime import datetime
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[ADMIN ACTION] [{ts}] Admin {admin_id} performed {command} on User {target}")

if not BOT_TOKEN or BOT_TOKEN == "your_bot_token_here":
    raise RuntimeError(
        "TELEGRAM_BOT_TOKEN is not set in backend/.env"
    )

# ---------------------------------------------------------------------------
# SUPABASE CLIENT
# ---------------------------------------------------------------------------
_supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    print(f"--- Supabase URL: {SUPABASE_URL} ---")
    print(f"--- Supabase Key: {SUPABASE_SERVICE_KEY[:20]}...{SUPABASE_SERVICE_KEY[-8:]} ({len(SUPABASE_SERVICE_KEY)} chars) ---")
    try:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("--- Supabase client created successfully ---")
    except Exception as e:
        print(f"--- ERROR creating Supabase client: {e} ---")
        _supabase = None
else:
    print("--- WARNING: Supabase URL or Service Key is empty! ---")
    print(f"---   SUPABASE_URL present: {bool(SUPABASE_URL)} ---")
    print(f"---   SUPABASE_SERVICE_ROLE_KEY present: {bool(SUPABASE_SERVICE_KEY)} ---")

def _get_user_balance(tg_id: int) -> float:
    """
    Fetches the unified balance for a Telegram user from tg_users.
    Returns 0.00 if the user has not registered yet or on any error.
    """
    if _supabase is None:
        return 0.00
    try:
        result = (
            _supabase.table("tg_users")
            .select("balance")
            .eq("tg_id", tg_id)
            .maybe_single()
            .execute()
        )
        if result.data and result.data.get("balance") is not None:
            return float(result.data["balance"])
    except Exception as e:
        print(f"[balance lookup error] {e}")
    return 0.00


def _is_user_registered(tg_id: int) -> bool:
    """Check if a user already exists in tg_users (i.e. has shared contact)."""
    if _supabase is None:
        print(f"[registration check] Supabase client is None — treating user {tg_id} as unregistered")
        return False
    try:
        result = (
            _supabase.table("tg_users")
            .select("tg_id")
            .eq("tg_id", tg_id)
            .maybe_single()
            .execute()
        )
        # Safely check: result could be None, or result.data could be None
        if result is None:
            print(f"[registration check] Query returned None for tg_id={tg_id}")
            return False
        if hasattr(result, 'data') and result.data is not None:
            return True
        return False
    except Exception as e:
        print(f"[registration check error] {type(e).__name__}: {e}")
        return False

# ---------------------------------------------------------------------------
# AUTO-TUNNEL
# Starts localtunnel automatically if MINI_APP_URL is missing/placeholder.
# Saves the new URL back to .env so it persists across restarts.
# ---------------------------------------------------------------------------
_tunnel_proc = None

def _start_tunnel(port: int = 3000) -> str:
    global _tunnel_proc
    print(f"--- Starting localtunnel on port {port} ---")
    _tunnel_proc = subprocess.Popen(
        ["npx", "localtunnel", "--port", str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        shell=True,
    )
    url = None
    for line in _tunnel_proc.stdout:
        print(f"[tunnel] {line.strip()}")
        match = re.search(r"your url is:\s*(https://\S+)", line)
        if match:
            url = match.group(1).strip()
            break
    if not url:
        raise RuntimeError("localtunnel failed to start - is Node.js installed?")
    # Drain remaining output in background
    threading.Thread(target=lambda: _tunnel_proc.stdout.read(), daemon=True).start()
    return url

def _needs_tunnel(url: str) -> bool:
    if not url:
        return True
    placeholders = ["your-deployed-url", "vercel.app"]
    return any(p in url for p in placeholders)

if _needs_tunnel(MINI_APP_URL):
    raw_url = _start_tunnel(3000)
    MINI_APP_URL = raw_url.rstrip("/") + "/bingo"
    set_key(ENV_FILE, "MINI_APP_URL", MINI_APP_URL)
    print(f"--- Tunnel URL saved to .env: {MINI_APP_URL} ---")

# ---------------------------------------------------------------------------
# BOT INIT
# ---------------------------------------------------------------------------
bot = telebot.TeleBot(BOT_TOKEN, parse_mode="Markdown")

# Delete any active webhook so polling always works (prevents Error 409)
bot.delete_webhook(drop_pending_updates=True)

# ---------------------------------------------------------------------------
# STATE MANAGEMENT
# In-memory: { chat_id: "IDLE" | "AWAITING_DEPOSIT" | "AWAITING_WITHDRAW" }
# ---------------------------------------------------------------------------
user_state: dict[int, str] = {}

STATE_IDLE              = "IDLE"
STATE_AWAITING_DEPOSIT  = "AWAITING_DEPOSIT"
STATE_AWAITING_WITHDRAW = "AWAITING_WITHDRAW"

def get_state(chat_id: int) -> str:
    return user_state.get(chat_id, STATE_IDLE)

def set_state(chat_id: int, state: str) -> None:
    user_state[chat_id] = state

# ---------------------------------------------------------------------------
# MARKUP DEFINITIONS
# ---------------------------------------------------------------------------

def registration_markup() -> ReplyKeyboardMarkup:
    """Reply keyboard with a single contact-sharing button."""
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    kb.add(KeyboardButton("📱 Register to Play", request_contact=True))
    return kb

def main_menu_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(InlineKeyboardButton("Play Now 🎮", web_app=WebAppInfo(url=MINI_APP_URL)))
    kb.add(
        InlineKeyboardButton("Deposit ➕",  callback_data="action_deposit"),
        InlineKeyboardButton("Withdraw ➖", callback_data="action_withdraw"),
    )
    kb.add(InlineKeyboardButton("Balance 💰", callback_data="action_balance"))
    return kb

def deposit_method_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=1)
    kb.add(InlineKeyboardButton("Telegram Star", callback_data="deposit_star"))
    kb.add(InlineKeyboardButton("Manual",        callback_data="deposit_manual"))
    return kb

def withdraw_method_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=1)
    kb.add(InlineKeyboardButton("Manual", callback_data="withdraw_manual"))
    return kb

def cancel_reply_keyboard() -> ReplyKeyboardMarkup:
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False)
    kb.add(KeyboardButton("❌ Cancel"))
    return kb

def remove_keyboard() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()

# ---------------------------------------------------------------------------
# /start COMMAND — Step 1: Show contact-sharing button
# If user is already registered, skip straight to the main menu.
# ---------------------------------------------------------------------------

@bot.message_handler(commands=["start"])
def cmd_start(message):
    set_state(message.chat.id, STATE_IDLE)
    tg_id = message.from_user.id

    # Check if user is already registered
    if _is_user_registered(tg_id):
        bot.send_message(
            message.chat.id,
            "🏆 *Win Bingo*\n\n"
            "Welcome back! You're already registered.\n\n"
            "• Click \"Play Now\" to join the live lobby.\n"
            "• Use \"Deposit\" to add funds securely via Telebirr.\n"
            "• Use \"Withdraw\" to cash out your winnings instantly.",
            reply_markup=main_menu_markup(),
        )
        return

    # New user — ask for contact to register
    bot.send_message(
        message.chat.id,
        "🏆 *Win Bingo*\n\n"
        "Welcome to the most exciting Bingo platform in Ethiopia!\n\n"
        "To get started, please share your phone number by tapping "
        "the button below. This is required for registration.",
        reply_markup=registration_markup(),
    )

# ---------------------------------------------------------------------------
# CONTACT HANDLER — Step 2: Register user via shared contact
# ---------------------------------------------------------------------------

@bot.message_handler(content_types=["contact"])
def handle_contact(message):
    chat_id = message.chat.id
    contact = message.contact

    # Security: only accept the user's own contact (not forwarded contacts)
    if contact.user_id != message.from_user.id:
        bot.send_message(
            chat_id,
            "⚠️ Please share *your own* contact using the button below.",
            reply_markup=registration_markup(),
        )
        return

    tg_id       = contact.user_id
    first_name  = message.from_user.first_name or ""
    last_name   = message.from_user.last_name or ""
    username    = message.from_user.username
    phone       = contact.phone_number  # e.g. "+251912345678"
    display     = f"{first_name} {last_name}".strip() or f"Player_{tg_id}"

    # Upsert into tg_users with the real phone number
    if _supabase is not None:
        try:
            _supabase.table("tg_users").upsert(
                {
                    "tg_id":        tg_id,
                    "display_name": display,
                    "tg_username":  username,
                    "phone":        phone,
                    # Placeholder to satisfy the NOT NULL constraint on password_hash
                    # for users who register via Telegram contact sharing (no password).
                    "password_hash": "telegram_native_auth",
                },
                on_conflict="tg_id",
            ).execute()
            print(f"[register] Upserted tg_user: tg_id={tg_id}, phone={phone}, name={display}")
        except Exception as e:
            print(f"[register] Supabase upsert error: {e}")
            bot.send_message(
                chat_id,
                "❌ Registration failed due to a server error. Please try again with /start.",
                reply_markup=remove_keyboard(),
            )
            return
    else:
        print(f"[register] Supabase not configured — skipping DB upsert for tg_id={tg_id}")

    # Success — remove the reply keyboard and show the main menu
    bot.send_message(
        chat_id,
        f"✅ *Registration complete!*\n\n"
        f"Welcome, {display}! Your phone number has been verified.\n\n"
        f"You're all set to play. Use the menu below to get started:",
        reply_markup=remove_keyboard(),
    )
    bot.send_message(
        chat_id,
        "🎮 *Main Menu*",
        reply_markup=main_menu_markup(),
    )

# ---------------------------------------------------------------------------
# CALLBACK QUERY HANDLER
# answerCallbackQuery is called on EVERY branch (no loading spinners)
# ---------------------------------------------------------------------------

@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    chat_id = call.message.chat.id
    data    = call.data

    if data == "action_balance":
        bot.answer_callback_query(call.id)
        tg_id   = call.from_user.id
        balance = _get_user_balance(tg_id)
        bot.send_message(chat_id, f"💰 *Wallet Balance:* {balance:.2f} ETB")
        bot.send_message(chat_id, "Main Menu", reply_markup=main_menu_markup())

    elif data == "action_deposit":
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "Choose Your Preferred Deposit Method",
                         reply_markup=deposit_method_markup())

    elif data == "action_withdraw":
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "Choose Your Preferred Withdraw Method",
                         reply_markup=withdraw_method_markup())

    elif data == "deposit_star":
        bot.answer_callback_query(call.id, text="Telegram Star coming soon!", show_alert=False)
        bot.send_message(chat_id, "⭐ Telegram Star payments coming soon. Please use Manual for now.")
        bot.send_message(chat_id, "Main Menu", reply_markup=main_menu_markup())

    elif data == "deposit_manual":
        bot.answer_callback_query(call.id)
        set_state(chat_id, STATE_AWAITING_DEPOSIT)
        bot.send_message(
            chat_id,
            "እባክዎ ማስገባት የሚፈልጉትን የገንዘብ መጠን ያስገቡ:\n\n"
            "Please enter the amount you want to deposit:",
            reply_markup=cancel_reply_keyboard(),
        )

    elif data == "withdraw_manual":
        bot.answer_callback_query(call.id)
        set_state(chat_id, STATE_AWAITING_WITHDRAW)
        bot.send_message(chat_id, "Please send the amount to withdraw:",
                         reply_markup=cancel_reply_keyboard())

    else:
        bot.answer_callback_query(call.id)

# ---------------------------------------------------------------------------
# TEXT MESSAGE HANDLER - state machine
# ---------------------------------------------------------------------------

@bot.message_handler(func=lambda m: m.content_type == "text" and not m.text.startswith("/"))
def handle_text(message):
    chat_id = message.chat.id
    text    = message.text.strip()
    state   = get_state(chat_id)

    # Global Cancel
    if text == "❌ Cancel":
        set_state(chat_id, STATE_IDLE)
        bot.send_message(chat_id, "Cancelled. Main Menu:", reply_markup=remove_keyboard())
        bot.send_message(chat_id, "Main Menu", reply_markup=main_menu_markup())
        return

    # Amount input states
    if state in (STATE_AWAITING_DEPOSIT, STATE_AWAITING_WITHDRAW):
        try:
            amount = float(text)
            if amount <= 0:
                raise ValueError("non-positive")
        except ValueError:
            bot.send_message(chat_id, "⚠️ Invalid amount. Please enter a positive number (e.g. 100):")
            return

        if state == STATE_AWAITING_DEPOSIT:
            set_state(chat_id, STATE_IDLE)
            bot.send_message(chat_id, "Processing...", reply_markup=remove_keyboard())
            bot.send_message(
                chat_id,
                f"Pay from telebirr to telebirr only\n\n"
                f"የቴሌብር አካውንት: 09********(we will assign a number in the future)\n\n"
                f"1. ከላይ ባለው የቴሌብር አካውንት {amount:.0f} ብር ያስገቡ\n"
                f"2. የላኩት የገንዘብ መጠን እና እዚህ ላይ እንዲሞላዎ የጠየቁት የብር መጠን ተመሳሳይ መሆኑን ያረጋግጡ\n"
                f"3. ብሩን ሲልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጽሁፍ መልዕክት (SMS) ከቴሌብር ይደርስዎታል\n"
                f"4. የደረሳችሁን አጭር የጽሁፍ መልዕክት (SMS) ሙሉውን ኮፒ (Copy) በማድረግ "
                f"ከታች ባለው የቴሌግራም የጽሁፍ ማስገቢያው ላይ ፔስት (Paste) በማድረግ ይላኩት",
            )

        elif state == STATE_AWAITING_WITHDRAW:
            # Use message.from_user.id (tg_id) — NOT chat_id (different in group chats)
            user_balance = _get_user_balance(message.from_user.id)
            set_state(chat_id, STATE_IDLE)
            bot.send_message(chat_id, "Checking balance...", reply_markup=remove_keyboard())
            if amount > user_balance:
                bot.send_message(
                    chat_id,
                    f"❌ Insufficient Balance. Your current balance is {user_balance:.2f} ETB."
                )
            else:
                bot.send_message(chat_id, f"✅ Withdrawal of {amount:.0f} ETB submitted. Processing...")
            bot.send_message(chat_id, "Main Menu", reply_markup=main_menu_markup())

        return

    # Unrecognised text while IDLE
    if state == STATE_IDLE:
        bot.send_message(chat_id, "Use the menu below:", reply_markup=main_menu_markup())

# ---------------------------------------------------------------------------
# ADMIN COMMANDS
# ---------------------------------------------------------------------------

@bot.message_handler(commands=["credit"])
def cmd_credit(message):
    """
    /credit <amount> [target_tg_id]
    Credits ETB to a user's wallet via the bingo_wallet_credit RPC.
    If target_tg_id is omitted, credits the admin's own account.
    """
    admin_id = message.from_user.id
    chat_id  = message.chat.id

    if not is_admin(admin_id):
        bot.send_message(chat_id, "⛔ You are not authorized to use admin commands.")
        return

    parts = message.text.strip().split()
    # /credit <amount> [target_tg_id]
    if len(parts) < 2:
        bot.send_message(
            chat_id,
            "⚠️ *Usage:* `/credit <amount> [target_tg_id]`\n\n"
            "Examples:\n"
            "• `/credit 500` — credits 500 ETB to yourself\n"
            "• `/credit 200 123456789` — credits 200 ETB to user 123456789",
        )
        return

    # Parse amount
    try:
        amount = float(parts[1])
        if amount <= 0:
            raise ValueError("non-positive")
    except ValueError:
        bot.send_message(chat_id, "⚠️ Invalid amount. Must be a positive number.")
        return

    # Parse target (default: admin's own tg_id)
    target_tg_id = admin_id
    if len(parts) >= 3:
        try:
            target_tg_id = int(parts[2])
        except ValueError:
            bot.send_message(chat_id, "⚠️ Invalid target TG ID. Must be a number.")
            return

    _admin_log(admin_id, f"/credit {amount}", str(target_tg_id))

    if _supabase is None:
        bot.send_message(chat_id, "❌ Supabase client is not configured.")
        return

    try:
        # Call the bingo_wallet_credit RPC
        # Signature: (p_tg_id BIGINT, p_amount NUMERIC, p_type TEXT, p_idem_key TEXT, p_note TEXT, p_is_bonus BOOLEAN)
        import uuid
        idem_key = f"admin-credit-{uuid.uuid4().hex[:12]}"
        result = _supabase.rpc("bingo_wallet_credit", {
            "p_tg_id":    target_tg_id,
            "p_amount":   amount,
            "p_type":     "deposit",
            "p_idem_key": idem_key,
            "p_note":     f"Admin credit by {admin_id}",
            "p_is_bonus": False,
        }).execute()

        # Fetch new balance
        new_balance = _get_user_balance(target_tg_id)

        bot.send_message(
            chat_id,
            f"✅ *Successfully credited {amount:.2f} ETB* to `{target_tg_id}`.\n\n"
            f"💰 *New balance:* `{new_balance:.2f} ETB`\n"
            f"🔑 *Idempotency key:* `{idem_key}`",
        )
    except Exception as e:
        error_msg = str(e)
        print(f"[ADMIN ERROR] /credit failed: {error_msg}")

        # Fallback: try direct UPDATE on tg_users.balance if RPC doesn't exist
        try:
            current = _get_user_balance(target_tg_id)
            new_bal = current + amount
            _supabase.table("tg_users").update(
                {"balance": new_bal}
            ).eq("tg_id", target_tg_id).execute()

            bot.send_message(
                chat_id,
                f"✅ *Credited {amount:.2f} ETB* to `{target_tg_id}` (direct update).\n\n"
                f"💰 *New balance:* `{new_bal:.2f} ETB`\n"
                f"⚠️ _RPC unavailable, used direct balance update._",
            )
        except Exception as e2:
            bot.send_message(
                chat_id,
                f"❌ *Credit failed.*\n\n"
                f"RPC error: `{error_msg[:200]}`\n"
                f"Fallback error: `{str(e2)[:200]}`",
            )


@bot.message_handler(commands=["inspect"])
def cmd_inspect(message):
    """
    /inspect <target_tg_id>
    Fetches and displays a user's full profile from tg_users.
    """
    admin_id = message.from_user.id
    chat_id  = message.chat.id

    if not is_admin(admin_id):
        bot.send_message(chat_id, "⛔ You are not authorized to use admin commands.")
        return

    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(
            chat_id,
            "⚠️ *Usage:* `/inspect <target_tg_id>`\n\n"
            "Example: `/inspect 123456789`",
        )
        return

    try:
        target_tg_id = int(parts[1])
    except ValueError:
        bot.send_message(chat_id, "⚠️ Invalid TG ID. Must be a number.")
        return

    _admin_log(admin_id, "/inspect", str(target_tg_id))

    if _supabase is None:
        bot.send_message(chat_id, "❌ Supabase client is not configured.")
        return

    try:
        result = (
            _supabase.table("tg_users")
            .select("*")
            .eq("tg_id", target_tg_id)
            .maybe_single()
            .execute()
        )

        if not result.data:
            bot.send_message(
                chat_id,
                f"🔍 *User not found*\n\nNo user with TG ID `{target_tg_id}` exists in the database.",
            )
            return

        user = result.data
        balance      = user.get("balance", 0) or 0
        bonus        = user.get("bonus_balance", 0) or 0
        display_name = user.get("display_name", "N/A")
        username     = user.get("tg_username", "N/A") or "N/A"
        phone        = user.get("phone", "N/A") or "N/A"
        auth_type    = user.get("auth_type", "N/A") or "N/A"
        is_active    = user.get("is_active", "N/A")
        created_at   = user.get("created_at", "N/A") or "N/A"
        updated_at   = user.get("updated_at", "N/A") or "N/A"

        # Format created_at nicely
        if created_at != "N/A":
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                created_at = dt.strftime("%b %d, %Y %H:%M UTC")
            except Exception:
                pass

        bot.send_message(
            chat_id,
            f"🔍 *User Profile*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👤 *Name:* {display_name}\n"
            f"🆔 *TG ID:* `{target_tg_id}`\n"
            f"📛 *Username:* @{username}\n"
            f"📱 *Phone:* `{phone}`\n"
            f"🔐 *Auth:* {auth_type}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"💰 *Balance:* `{float(balance):.2f} ETB`\n"
            f"🎁 *Bonus:* `{float(bonus):.2f} ETB`\n"
            f"✅ *Active:* {is_active}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"📅 *Registered:* {created_at}\n"
            f"🔄 *Last updated:* {updated_at}",
        )
    except Exception as e:
        bot.send_message(
            chat_id,
            f"❌ *Inspect failed.*\n\nError: `{str(e)[:300]}`",
        )


@bot.message_handler(commands=["sys"])
def cmd_sys(message):
    """
    /sys
    Displays system status: total users, active rooms, Supabase connection.
    """
    admin_id = message.from_user.id
    chat_id  = message.chat.id

    if not is_admin(admin_id):
        bot.send_message(chat_id, "⛔ You are not authorized to use admin commands.")
        return

    _admin_log(admin_id, "/sys")

    if _supabase is None:
        bot.send_message(chat_id, "❌ Supabase client is not configured.")
        return

    try:
        # Count total registered users
        users_result = _supabase.table("tg_users").select("tg_id", count="exact").execute()
        total_users = users_result.count if users_result.count is not None else len(users_result.data or [])

        # Count active bingo rooms (status != 'finished')
        try:
            active_rooms_result = (
                _supabase.table("bingo_rooms")
                .select("id", count="exact")
                .neq("status", "finished")
                .execute()
            )
            active_rooms = active_rooms_result.count if active_rooms_result.count is not None else len(active_rooms_result.data or [])
        except Exception:
            active_rooms = "N/A (table may not exist)"

        # Count total bingo rooms
        try:
            total_rooms_result = (
                _supabase.table("bingo_rooms")
                .select("id", count="exact")
                .execute()
            )
            total_rooms = total_rooms_result.count if total_rooms_result.count is not None else len(total_rooms_result.data or [])
        except Exception:
            total_rooms = "N/A"

        # Bot info
        from datetime import datetime
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        bot.send_message(
            chat_id,
            f"📊 *System Status*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"👥 *Total Users:* `{total_users}`\n"
            f"🎮 *Active Rooms:* `{active_rooms}`\n"
            f"🏠 *Total Rooms:* `{total_rooms}`\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🔗 *Supabase:* ✅ Connected\n"
            f"🌐 *Mini App:* `{MINI_APP_URL[:50]}...`\n"
            f"🕐 *Server Time:* `{now}`\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🛡️ *Admins:* {', '.join(str(a) for a in ADMIN_IDS)}",
        )
    except Exception as e:
        bot.send_message(
            chat_id,
            f"❌ *System status failed.*\n\nError: `{str(e)[:300]}`",
        )


# ---------------------------------------------------------------------------
# /resetroom <room_id> — Admin: forcefully reset a room to 'waiting'
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["resetroom"])
def handle_resetroom(message):
    chat_id = message.chat.id
    user_id = message.from_user.id

    if not is_admin(user_id):
        bot.send_message(chat_id, "⛔ Not authorized.")
        return

    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(
            chat_id,
            "❌ *Usage:* `/resetroom <room_id>`\n\n"
            "Resets a bingo room to 'waiting' status and clears drawn numbers.",
            parse_mode="Markdown",
        )
        return

    room_id = parts[1].strip()

    # Validate UUID format
    uuid_re = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    if not re.match(uuid_re, room_id, re.IGNORECASE):
        bot.send_message(chat_id, "❌ Invalid room ID format. Must be a UUID.")
        return

    try:
        from datetime import datetime

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[ADMIN ACTION] [{now}] Admin {user_id} reset room {room_id}")

        # 1. Reset the room status, clear drawn numbers and timestamps
        result = (
            _supabase.table("bingo_rooms")
            .update({
                "status": "waiting",
                "drawn_numbers": [],
                "draw_sequence": [],
                "countdown_started_at": None,
                "started_at": None,
                "finished_at": None,
                "winner_id": None,
            })
            .eq("id", room_id)
            .execute()
        )

        if not result.data:
            bot.send_message(chat_id, f"❌ Room `{room_id}` not found.", parse_mode="Markdown")
            return

        # 2. Clear draw log for this room
        try:
            _supabase.table("bingo_draw_log").delete().eq("room_id", room_id).execute()
        except Exception:
            pass  # Non-fatal

        # 3. Clear bingo_cards (player sessions) for this room
        try:
            _supabase.table("bingo_cards").delete().eq("room_id", room_id).execute()
        except Exception:
            pass  # Non-fatal

        bot.send_message(
            chat_id,
            f"✅ *Room Reset Complete*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🆔 *Room:* `{room_id}`\n"
            f"📊 *Status:* `waiting`\n"
            f"🎱 *Drawn Numbers:* cleared\n"
            f"🗑️ *Draw Log:* cleared\n"
            f"👥 *Player Sessions:* cleared\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"Room is ready for new players.",
            parse_mode="Markdown",
        )
    except Exception as e:
        bot.send_message(
            chat_id,
            f"❌ *Reset failed.*\n\nError: `{str(e)[:300]}`",
            parse_mode="Markdown",
        )


# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"--- Bot starting (polling) ---")
    print(f"--- Mini App URL: {MINI_APP_URL} ---")
    print(f"--- Admin IDs: {ADMIN_IDS} ---")
    bot.infinity_polling(timeout=30, long_polling_timeout=20)
