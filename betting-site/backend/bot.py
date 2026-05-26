"""
CHELA Bingo - Telegram Bot
==========================
Handles: /start → Contact Registration → Play, Deposit, Withdraw, Balance.
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

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
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
    return user_id in ADMIN_IDS

def _admin_log(admin_id: int, command: str, target: str = "N/A") -> None:
    from datetime import datetime
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[ADMIN ACTION] [{ts}] Admin {admin_id} performed {command} on User {target}")

if not BOT_TOKEN or BOT_TOKEN == "your_bot_token_here":
    raise RuntimeError("TELEGRAM_BOT_TOKEN is not set in .env")

# ---------------------------------------------------------------------------
# SUPABASE CLIENT
# ---------------------------------------------------------------------------
_supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("--- Supabase client created successfully ---")
    except Exception as e:
        print(f"--- ERROR creating Supabase client: {e} ---")
        _supabase = None

def _get_user_balance(tg_id: int) -> float:
    if _supabase is None: return 0.00
    try:
        result = _supabase.table("tg_users").select("balance").eq("tg_id", tg_id).maybe_single().execute()
        if result.data and result.data.get("balance") is not None:
            return float(result.data["balance"])
    except Exception as e:
        print(f"[balance lookup error] {e}")
    return 0.00

def _is_user_registered(tg_id: int) -> bool:
    if _supabase is None: return False
    try:
        result = _supabase.table("tg_users").select("tg_id").eq("tg_id", tg_id).maybe_single().execute()
        if result and hasattr(result, 'data') and result.data is not None:
            return True
        return False
    except Exception: return False

# ---------------------------------------------------------------------------
# AUTO-TUNNEL (For Local Testing Only)
# ---------------------------------------------------------------------------
_tunnel_proc = None

def _start_tunnel(port: int = 3000) -> str:
    global _tunnel_proc
    print(f"--- Starting localtunnel on port {port} ---")
    _tunnel_proc = subprocess.Popen(["npx", "localtunnel", "--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, shell=True)
    url = None
    for line in _tunnel_proc.stdout:
        match = re.search(r"your url is:\s*(https://\S+)", line)
        if match:
            url = match.group(1).strip()
            break
    threading.Thread(target=lambda: _tunnel_proc.stdout.read(), daemon=True).start()
    return url

if not MINI_APP_URL or "your-deployed-url" in MINI_APP_URL:
    try:
        raw_url = _start_tunnel(3000)
        MINI_APP_URL = raw_url.rstrip("/") + "/bingo"
        set_key(ENV_FILE, "MINI_APP_URL", MINI_APP_URL)
        print(f"--- Tunnel URL saved to .env: {MINI_APP_URL} ---")
    except Exception: pass

# ---------------------------------------------------------------------------
# BOT INIT
# ---------------------------------------------------------------------------
bot = telebot.TeleBot(BOT_TOKEN, parse_mode="Markdown")
bot.delete_webhook(drop_pending_updates=True)

# ---------------------------------------------------------------------------
# STATE MANAGEMENT
# ---------------------------------------------------------------------------
user_state: dict[int, str] = {}
STATE_IDLE              = "IDLE"
STATE_AWAITING_DEPOSIT  = "AWAITING_DEPOSIT"
STATE_AWAITING_TXN_SMS  = "AWAITING_TXN_SMS"
STATE_AWAITING_WITHDRAW = "AWAITING_WITHDRAW"

def get_state(chat_id: int) -> str: return user_state.get(chat_id, STATE_IDLE)
def set_state(chat_id: int, state: str) -> None: user_state[chat_id] = state

# ---------------------------------------------------------------------------
# MARKUPS
# ---------------------------------------------------------------------------
def registration_markup() -> ReplyKeyboardMarkup:
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    kb.add(KeyboardButton("📱 Register to Play", request_contact=True))
    return kb

def main_menu_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(InlineKeyboardButton("🎮 PLAY CHELA BINGO", web_app=WebAppInfo(url=MINI_APP_URL)))
    kb.add(
        InlineKeyboardButton("Deposit ➕",  callback_data="action_deposit"),
        InlineKeyboardButton("Withdraw ➖", callback_data="action_withdraw"),
    )
    kb.add(InlineKeyboardButton("💰 My Balance", callback_data="action_balance"))
    return kb

def cancel_reply_keyboard() -> ReplyKeyboardMarkup:
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False)
    kb.add(KeyboardButton("❌ Cancel"))
    return kb

def remove_keyboard() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()

# ---------------------------------------------------------------------------
# COMMANDS
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["start"])
def cmd_start(message):
    set_state(message.chat.id, STATE_IDLE)
    tg_id = message.from_user.id

    if _is_user_registered(tg_id):
        bot.send_message(
            message.chat.id,
            "🎱 *CHELA Bingo*\n\n"
            "Welcome back to the lobby! You're fully registered and ready to go.\n\n"
            "• Click *PLAY CHELA BINGO* to launch the massive multiplayer app.\n"
            "• Manage your funds securely using the menu below.",
            reply_markup=main_menu_markup(),
        )
        return

    bot.send_message(
        message.chat.id,
        "🎱 *CHELA Bingo*\n\n"
        "Welcome to the most exciting 100-Player Bingo platform in Ethiopia!\n\n"
        "To get started, tap the button below to link your Telegram account securely.",
        reply_markup=registration_markup(),
    )

@bot.message_handler(content_types=["contact"])
def handle_contact(message):
    chat_id = message.chat.id
    contact = message.contact

    if contact.user_id != message.from_user.id:
        bot.send_message(chat_id, "⚠️ Please share *your own* contact.", reply_markup=registration_markup())
        return

    tg_id       = contact.user_id
    first_name  = message.from_user.first_name or ""
    last_name   = message.from_user.last_name or ""
    username    = message.from_user.username
    phone       = contact.phone_number  
    display     = f"{first_name} {last_name}".strip() or f"Player_{tg_id}"

    if _supabase is not None:
        try:
            _supabase.table("tg_users").upsert({
                "tg_id": tg_id, "display_name": display, "tg_username": username,
                "phone": phone, "password_hash": "telegram_native_auth",
            }, on_conflict="tg_id").execute()
        except Exception:
            bot.send_message(chat_id, "❌ Server error. Try /start again.", reply_markup=remove_keyboard())
            return

    bot.send_message(
        chat_id,
        f"✅ *Registration Complete!*\n\n"
        f"Welcome aboard, {display}! Your account is verified.\n\n"
        f"Use the menu below to manage your wallet and launch the game.",
        reply_markup=remove_keyboard(),
    )
    bot.send_message(chat_id, "🎮 *Main Menu*", reply_markup=main_menu_markup())

# ---------------------------------------------------------------------------
# CALLBACKS
# ---------------------------------------------------------------------------
@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    chat_id = call.message.chat.id
    data    = call.data

    if data == "action_balance":
        bot.answer_callback_query(call.id)
        balance = _get_user_balance(call.from_user.id)
        bot.send_message(chat_id, f"💰 *Current Balance:* `{balance:.2f} ETB`")
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup())

    elif data == "action_deposit":
        bot.answer_callback_query(call.id)
        set_state(chat_id, STATE_AWAITING_DEPOSIT)
        bot.send_message(
            chat_id,
            "📥 *Deposit Funds*\n\n"
            "Please enter the exact amount of ETB you want to deposit (e.g. 100):",
            reply_markup=cancel_reply_keyboard(),
        )

    elif data == "action_withdraw":
        bot.answer_callback_query(call.id)
        set_state(chat_id, STATE_AWAITING_WITHDRAW)
        bot.send_message(chat_id, "📤 *Withdraw Funds*\n\nPlease enter the amount you want to withdraw:", reply_markup=cancel_reply_keyboard())

    else:
        bot.answer_callback_query(call.id)

# ---------------------------------------------------------------------------
# STATE MACHINE (TEXT HANDLER)
# ---------------------------------------------------------------------------
@bot.message_handler(func=lambda m: m.content_type == "text" and not m.text.startswith("/"))
def handle_text(message):
    chat_id = message.chat.id
    text    = message.text.strip()
    state   = get_state(chat_id)

    if text == "❌ Cancel":
        set_state(chat_id, STATE_IDLE)
        bot.send_message(chat_id, "Action cancelled.", reply_markup=remove_keyboard())
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup())
        return

    # 🚀 FIX: The new Manual Verification flow
    if state == STATE_AWAITING_TXN_SMS:
        set_state(chat_id, STATE_IDLE)
        
        # Forward to Admin
        admin_msg = (
            f"🔔 *NEW DEPOSIT REQUEST*\n"
            f"User ID: `{message.from_user.id}`\n"
            f"Username: @{message.from_user.username or 'N/A'}\n\n"
            f"*SMS Provided:*\n`{text}`\n\n"
            f"To approve, copy their ID and use:\n`/credit <amount> {message.from_user.id}`"
        )
        try:
            bot.send_message(ADMIN_IDS[0], admin_msg)
        except Exception: pass

        bot.send_message(
            chat_id, 
            "✅ *Transaction Received!*\n\nOur team is verifying your payment. Your balance will be updated shortly.", 
            reply_markup=remove_keyboard()
        )
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup())
        return

    if state in (STATE_AWAITING_DEPOSIT, STATE_AWAITING_WITHDRAW):
        try:
            amount = float(text)
            if amount <= 0: raise ValueError
        except ValueError:
            bot.send_message(chat_id, "⚠️ Please enter a valid positive number.")
            return

        if state == STATE_AWAITING_DEPOSIT:
            set_state(chat_id, STATE_AWAITING_TXN_SMS)
            bot.send_message(
                chat_id,
                f"🏦 *Telebirr Payment Instructions*\n\n"
                f"1️⃣ Open Telebirr and send exactly *{amount:.0f} ETB* to:\n"
                f"`0966617175`\n\n"
                f"2️⃣ Once you send the money, Telebirr will send you a confirmation SMS.\n\n"
                f"3️⃣ *Copy that full SMS and paste it right here* to verify your deposit.",
                reply_markup=cancel_reply_keyboard(),
            )

        elif state == STATE_AWAITING_WITHDRAW:
            user_balance = _get_user_balance(message.from_user.id)
            set_state(chat_id, STATE_IDLE)
            
            if amount > user_balance:
                bot.send_message(chat_id, f"❌ Insufficient Balance. You only have `{user_balance:.2f} ETB`.", reply_markup=remove_keyboard())
            else:
                bot.send_message(chat_id, f"✅ Withdrawal request of `{amount:.0f} ETB` submitted! Our team will process it shortly.", reply_markup=remove_keyboard())
                
                # Notify Admin of withdraw
                try:
                    bot.send_message(ADMIN_IDS[0], f"💸 *NEW WITHDRAW REQUEST*\nUser ID: `{message.from_user.id}`\nAmount: `{amount:.2f} ETB`")
                except Exception: pass

            bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup())
        return

    if state == STATE_IDLE:
        bot.send_message(chat_id, "Please use the menu below:", reply_markup=main_menu_markup())

# ---------------------------------------------------------------------------
# ADMIN COMMANDS
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["credit"])
def cmd_credit(message):
    admin_id = message.from_user.id
    chat_id  = message.chat.id

    if not is_admin(admin_id): return

    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(chat_id, "⚠️ *Usage:* `/credit <amount> [target_tg_id]`")
        return

    try: amount = float(parts[1])
    except ValueError: return bot.send_message(chat_id, "⚠️ Invalid amount.")

    target_tg_id = admin_id
    if len(parts) >= 3:
        try: target_tg_id = int(parts[2])
        except ValueError: return bot.send_message(chat_id, "⚠️ Invalid target ID.")

    if _supabase is None: return

    try:
        current = _get_user_balance(target_tg_id)
        new_bal = current + amount
        _supabase.table("tg_users").update({"balance": new_bal}).eq("tg_id", target_tg_id).execute()

        bot.send_message(
            chat_id,
            f"✅ *Credited {amount:.2f} ETB* to `{target_tg_id}`.\n\n"
            f"💰 *New balance:* `{new_bal:.2f} ETB`"
        )
        
        # Notify the user they got money!
        try:
            bot.send_message(target_tg_id, f"🎉 *Deposit Successful!*\n\nYour account has been credited with `{amount:.2f} ETB`. Good luck playing CHELA Bingo!")
        except Exception: pass
        
    except Exception as e:
        bot.send_message(chat_id, f"❌ *Credit failed.*\n\nError: `{str(e)[:200]}`")

if __name__ == "__main__":
    print(f"--- CHELA Bingo Bot Starting ---")
    bot.infinity_polling(timeout=30, long_polling_timeout=20)