"""
CHELA Bingo - Telegram Bot
==========================
Handles: /start → Language Selection → Contact Registration → Play, Deposit, Withdraw, Balance.
Bilingual Support: English & Amharic (አማርኛ)
Automated Verification: Integrated with verify.leul.et API
"""

import os
import re
import subprocess
import threading
import telebot
import requests  # Added for live API verification
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
VERIFIER_API_KEY      = os.getenv("VERIFIER_API_KEY", "")  # Your verify.leul.et key

# ---------------------------------------------------------------------------
# ADMIN AUTHORIZATION
# ---------------------------------------------------------------------------
ADMIN_IDS = [5681654051]  # Henok

def is_admin(user_id: int) -> bool:
    return user_id in ADMIN_IDS[cite: 2]

def _admin_log(admin_id: int, command: str, target: str = "N/A") -> None:
    from datetime import datetime
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[ADMIN ACTION] [{ts}] Admin {admin_id} performed {command} on User {target}")[cite: 2]

if not BOT_TOKEN or BOT_TOKEN == "your_bot_token_here":
    raise RuntimeError("TELEGRAM_BOT_TOKEN is not set in .env")[cite: 2]

# ---------------------------------------------------------------------------
# SUPABASE CLIENT
# ---------------------------------------------------------------------------
_supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("--- Supabase client created successfully ---")[cite: 2]
    except Exception as e:
        print(f"--- ERROR creating Supabase client: {e} ---")[cite: 2]
        _supabase = None[cite: 2]

def _get_user_balance(tg_id: int) -> float:
    if _supabase is None: return 0.00[cite: 2]
    try:
        result = _supabase.table("tg_users").select("balance").eq("tg_id", tg_id).maybe_single().execute()[cite: 2]
        if result.data and result.data.get("balance") is not None:[cite: 2]
            return float(result.data["balance"])[cite: 2]
    except Exception as e:
        print(f"[balance lookup error] {e}")[cite: 2]
    return 0.00[cite: 2]

def _is_user_registered(tg_id: int) -> bool:
    if _supabase is None: return False[cite: 2]
    try:
        result = _supabase.table("tg_users").select("tg_id").eq("tg_id", tg_id).maybe_single().execute()[cite: 2]
        if result and hasattr(result, 'data') and result.data is not None:[cite: 2]
            return True[cite: 2]
        return False[cite: 2]
    except Exception: return False[cite: 2]

# ---------------------------------------------------------------------------
# AUTO-TUNNEL (For Local Testing Only)
# ---------------------------------------------------------------------------
_tunnel_proc = None

def _start_tunnel(port: int = 3000) -> str:
    global _tunnel_proc
    print(f"--- Starting localtunnel on port {port} ---")[cite: 2]
    _tunnel_proc = subprocess.Popen(["npx", "localtunnel", "--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, shell=True)[cite: 2]
    url = None[cite: 2]
    for line in _tunnel_proc.stdout:[cite: 2]
        match = re.search(r"your url is:\s*(https://S+)", line)[cite: 2]
        if match:[cite: 2]
            url = match.group(1).strip()[cite: 2]
            break[cite: 2]
    threading.Thread(target=lambda: _tunnel_proc.stdout.read(), daemon=True).start()[cite: 2]
    return url[cite: 2]

if not MINI_APP_URL or "your-deployed-url" in MINI_APP_URL:
    try:
        raw_url = _start_tunnel(3000)[cite: 2]
        MINI_APP_URL = raw_url.rstrip("/") + "/bingo"[cite: 2]
        set_key(ENV_FILE, "MINI_APP_URL", MINI_APP_URL)[cite: 2]
        print(f"--- Tunnel URL saved to .env: {MINI_APP_URL} ---")[cite: 2]
    except Exception: pass[cite: 2]

# ---------------------------------------------------------------------------
# BOT INIT & MULTI-LANGUAGE STATE
# ---------------------------------------------------------------------------
bot = telebot.TeleBot(BOT_TOKEN, parse_mode="Markdown")[cite: 2]
bot.delete_webhook(drop_pending_updates=True)[cite: 2]

user_state: dict[int, str] = {}[cite: 2]
user_lang: dict[int, str] = {}  
user_deposit_data: dict[int, dict] = {} 

STATE_IDLE              = "IDLE"[cite: 2]
STATE_AWAITING_DEPOSIT  = "AWAITING_DEPOSIT"[cite: 2]
STATE_AWAITING_TXN_SMS  = "AWAITING_TXN_SMS"[cite: 2]
STATE_AWAITING_WITHDRAW = "AWAITING_WITHDRAW"[cite: 2]

def get_state(chat_id: int) -> str: return user_state.get(chat_id, STATE_IDLE)[cite: 2]
def set_state(chat_id: int, state: str) -> None: user_state[chat_id] = state[cite: 2]

def get_lang(chat_id: int) -> str: return user_lang.get(chat_id, "en")
def set_lang(chat_id: int, lang: str) -> None: user_lang[chat_id] = lang

# ---------------------------------------------------------------------------
# DICTIONARY FOR STRINGS (BILINGUAL)
# ---------------------------------------------------------------------------
STRINGS = {
    "en": {
        "welcome_back": "🎱 *CHELA Bingo*\n\nWelcome back to the lobby! You're fully registered and ready to go.\n\n• Click *PLAY CHELA BINGO* to launch multiplayer app.\n• Manage funds securely below.",
        "welcome_new": "🎱 *CHELA Bingo*\n\nWelcome to the most exciting 100-Player Bingo platform in Ethiopia!\n\nTo get started, tap the button below to link your Telegram account securely.",
        "reg_btn": "📱 Register to Play",
        "play_btn": "🎮 PLAY CHELA BINGO",
        "dep_btn": "Deposit ➕",
        "with_btn": "Withdraw ➖",
        "bal_btn": "💰 My Balance",
        "lang_btn": "🌐 Language / ቋንቋ",
        "cancel_btn": "❌ Cancel",
        "invalid_contact": "⚠️ Please share *your own* contact.",
        "reg_success": "✅ *Registration Complete!*\n\nWelcome aboard! Your account is verified.\nUse the menu below to manage your wallet.",
        "curr_bal": "💰 *Current Balance:* `{:.2f} ETB`",
        "enter_amount": "📥 *Deposit Amount*\n\nPlease enter or select the exact amount of ETB you want to deposit:",
        "enter_with_amount": "📤 *Withdraw Funds*\n\nPlease enter the amount you want to withdraw:",
        "invalid_amount": "⚠️ Please enter a valid positive number.",
        "insufficient": "❌ Insufficient Balance. You only have `{:.2f} ETB`.",
        "with_submitted": "✅ Withdrawal request of `{:.0f} ETB` submitted! Our team will process it shortly.",
        "action_cancelled": "Action cancelled.",
        "choose_provider": "💳 *Select Deposit Provider*\n\nPlease select the preferred banking platform for payment verification:",
        "checking_api": "⏳ *Verifying transaction with the bank backend, please wait...*",
        "api_success": "🎉 *Deposit Automated Successfully!*\nYour account has been credited with `{:.2f} ETB`.",
        "api_wrong_amount": "⚠️ *Verification Alert:*\nTransaction found, but the amount paid does not match your initiated request.",
        "api_fail": "❌ *Verification Failed:*\nInvalid Transaction ID or the reference has expired/already been processed.",
        "api_error": "🚨 *System Error:*\nBank verification services are currently experiencing delays. Please try again later.",
        "inst_telebirr": "📱 *TELEBIRR PAYMENT INSTRUCTIONS*\n\n1️⃣ Open your Telebirr App or dial `*127#`.\n2️⃣ Send the amount of *{} ETB* to Merchant/Agent Number: *894921*\n3️⃣ Once completed, copy the **Transaction ID** (e.g. `4HF89SDF93`) or paste the full confirmation SMS text here:",
        "inst_cbe": "🏦 *CBE PAYMENT INSTRUCTIONS*\n\n1️⃣ Use CBE Birr, CBE Mobile Banking App or ATM.\n2️⃣ Transfer *{} ETB* to Account Number: *1000481948212* (CHELA ENT.)\n3️⃣ Copy the **Transaction Ref** (e.g. `FT26XXXXXXXX`) or paste the full credit SMS confirmation directly here:"
    },
    "am": {
        "welcome_back": "🎱 *ቼላ ቢንጎ (CHELA Bingo)*\n\nወደ መጫወቻው አዳራሽ በደህና መጡ! ምዝገባዎ ተጠናቋል።\n\n• የቢንጎ መተግበሪያውን ለመክፈት *PLAY CHELA BINGO* የሚለውን ይጫኑ።\n• ሂሳብዎን ከታች ባለው መቆጣጠሪያ ማስተዳደር ይችላሉ።",
        "welcome_new": "🎱 *ቼላ ቢንጎ (CHELA Bingo)*\n\nበኢትዮጵያ ውስጥ ወደሚገኘው እጅግ አስደሳች የ100 ተጫዋቾች የቢንጎ መድረክ እንኳን በደህና መጡ!\n\nለመጀመር የቴሌግራም አካውንትዎን ደህንነቱ በተጠበቀ ሁኔታ ለማገናኘት ከታች ያለውን ቁልፍ ይጫኑ።",
        "reg_btn": "📱 ለመጫወት ይመዝገቡ",
        "play_btn": "🎮 ቼላ ቢንጎ ይጫወቱ (PLAY)",
        "dep_btn": "ብር አስገባ ➕",
        "with_btn": "ብር አውጣ ➖",
        "bal_btn": "💰 የኔ ቀሪ ሂሳብ",
        "lang_btn": "🌐 Language / ቋንቋ",
        "cancel_btn": "❌ ሰርዝ",
        "invalid_contact": "⚠️ እባክዎን *የራስዎን* ስልክ ያጋሩ።",
        "reg_success": "✅ *ምዝገባው ተጠናቋል!*\n\nእንኳን ደህና መጡ! መለያዎ ተረጋግጧል።\nየኪስ ቦርሳዎን ለማስተዳደር ከታች ያለውን ምናሌ ይጠቀሙ።",
        "curr_bal": "💰 *የአሁኑ ቀሪ ሂሳብ:* `{:.2f} ETB`",
        "enter_amount": "📥 *የማስቀመጫ መጠን*\n\nእባክዎ ማስገባት የሚፈልጉትን የገንዘብ መጠን በETB ያስገቡ ወይም ይምረጡ:",
        "enter_with_amount": "📤 *ገንዘብ ማውጫ*\n\nእባክዎ ማውጣት የሚፈልጉትን የገንዘብ መጠን ያስገቡ:",
        "invalid_amount": "⚠️ እባክዎን ትክክለኛ ቁጥር ያስገቡ።",
        "insufficient": "❌ በቂ ቀሪ ሂሳብ የለዎትም። ያለዎት `{:.2f} ETB` ብቻ ነው።",
        "with_submitted": "✅ የ `{:.0f} ETB` ማውጫ ጥያቄዎ ቀርቧል! በቅርቡ እናስተናግዳለን።",
        "action_cancelled": "ድርጊቱ ተሰርዟል።",
        "choose_provider": "💳 *የክፍያ መንገድ ይምረጡ*\n\nእባክዎ ለማረጋገጫ የሚጠቀሙበትን የባንክ ወይም የክፍያ አማራጭ ይምረጡ:",
        "checking_api": "⏳ *ግብይቱን ከባንክ ጋር እያረጋገጥን ነው፣ እባክዎ ይጠብቁ...*",
        "api_success": "🎉 *ክፍያዎ በራስ-ሰር ተረጋግጧል!*\nወደ መለያዎ `{:.2f} ETB` ገቢ ሆኗል።",
        "api_wrong_amount": "⚠️ *የማረጋገጫ ስህተት:*\nግብይቱ ተገኝቷል ነገር ግን የከፈሉት መጠን መጀመሪያ ካስገቡት መጠን ጋር አይዛመድም።",
        "api_fail": "❌ *ማረጋገጫው አልተሳካም:*\nየግብይት መለያ ቁጥሩ የተሳሳተ ነው ወይም ከዚህ በፊት ጥቅም ላይ ውሏል።",
        "api_error": "🚨 *የስርዓት መቆራረጥ:*\nየባንክ ማረጋገጫ መስመሮች ስራ በዝቶባቸዋል። እባክዎ ከጥቂት ደቂቃዎች በኋላ እንደገና ይሞክሩ።",
        "inst_telebirr": "📱 *የቴሌብር ክፍያ መመሪያ*\n\n1️⃣ የቴሌብር መተግበሪያዎን ይክፈቱ ወይም `*127#` ይደውሉ።\n2️⃣ የክፍያ መጠን *{} ETB* ወደ መለያ ቁጥር (Merchant/Agent): *894921* ይላኩ።\n3️⃣ ክፍያውን ሲያጠናቅቁ የነጋዴውን **የግብይት መለያ ቁጥር (Transaction ID)** (ምሳሌ፦ `4HF89SDF93`) ይቅዱ ወይም ሙሉውን የኤስኤምኤስ (SMS) መልእክት እዚህ ይላኩ፦",
        "inst_cbe": "🏦 *የኢትዮጵያ ንግድ ባንክ (CBE) ክፍያ መመሪያ*\n\n1️⃣ የCBE Birr፣ የCBE ሞባይል ባንኪንግ መተግበሪያን ወይም ኤቲኤምን ይጠቀሙ።\n2️⃣ የክፍያ መጠን *{} ETB* ወደ ሂሳብ ቁጥር: *1000481948212* (CHELA ENT.) ያስተላልፉ።\n3️⃣ የክፍያ ማረጋገጫ **የግብይት መለያ ቁጥር (Transaction Ref)** (ምሳሌ፦ `FT26XXXXXXXX`) ይቅዱ ወይም ሙሉውን የደረሰኝ ኤስኤምኤስ በቀጥታ እዚህ ይላኩ፦"
    }
}

# ---------------------------------------------------------------------------
# MARKUPS WITH BILINGUAL FACTORY
# ---------------------------------------------------------------------------
def lang_selection_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(
        InlineKeyboardButton("English 🇬🇧", callback_data="set_lang|en"),
        InlineKeyboardButton("አማርኛ 🇪🇹", callback_data="set_lang|am")
    )
    return kb

def registration_markup(lang: str) -> ReplyKeyboardMarkup:
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=True)
    kb.add(KeyboardButton(STRINGS[lang]["reg_btn"], request_contact=True))[cite: 2]
    return kb

def main_menu_markup(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(InlineKeyboardButton(STRINGS[lang]["play_btn"], web_app=WebAppInfo(url=MINI_APP_URL)))[cite: 2]
    kb.add(
        InlineKeyboardButton(STRINGS[lang]["dep_btn"],  callback_data="action_deposit"),[cite: 2]
        InlineKeyboardButton(STRINGS[lang]["with_btn"], callback_data="action_withdraw"),[cite: 2]
    )
    kb.add(
        InlineKeyboardButton(STRINGS[lang]["bal_btn"], callback_data="action_balance"),[cite: 2]
        InlineKeyboardButton(STRINGS[lang]["lang_btn"], callback_data="action_change_lang")
    )
    return kb

def cancel_reply_keyboard(lang: str) -> ReplyKeyboardMarkup:
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False)
    kb.add(KeyboardButton(STRINGS[lang]["cancel_btn"]))[cite: 2]
    return kb

def payment_methods_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(
        InlineKeyboardButton("Telebirr 📱", callback_data="dep_prov|telebirr"),[cite: 2]
        InlineKeyboardButton("CBE 🏦", callback_data="dep_prov|cbe"),[cite: 2]
        InlineKeyboardButton("Dashen Bank 🏛️", callback_data="dep_prov|dashen"),[cite: 2]
        InlineKeyboardButton("Bank of Abyssinia 🦁", callback_data="dep_prov|abyssinia"),[cite: 2]
        InlineKeyboardButton("CBE Birr 💵", callback_data="dep_prov|cbe_birr"),[cite: 2]
        InlineKeyboardButton("M-Pesa 💸", callback_data="dep_prov|mpesa")[cite: 2]
    )
    return kb

def quick_amount_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=3)
    kb.add(
        InlineKeyboardButton("50 ETB", callback_data="dep_amt|50"),
        InlineKeyboardButton("100 ETB", callback_data="dep_amt|100"),
        InlineKeyboardButton("200 ETB", callback_data="dep_amt|200")
    )
    kb.add(
        InlineKeyboardButton("500 ETB", callback_data="dep_amt|500"),
        InlineKeyboardButton("1000 ETB", callback_data="dep_amt|1000"),
        InlineKeyboardButton("2000 ETB", callback_data="dep_amt|2000")
    )
    return kb

def remove_keyboard() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()[cite: 2]

# ---------------------------------------------------------------------------
# REUSABLE TRANSACTION PARSER
# ---------------------------------------------------------------------------
def _extract_transaction_id(text: str) -> str:
    text_clean = text.strip().upper()
    
    # Check for raw string components split by space (e.g. Reference + Suffix combo)
    parts = text_clean.split()
    
    # Standard CBE Reference structure check matching
    cbe_match = re.search(r'\b(FT[A-Z0-9]{10,20})\b', text_clean)
    if cbe_match:
        return cbe_match.group(1)
        
    # Telebirr pattern (10-digit Alphanumeric string)
    telebirr_match = re.search(r'\b([A-Z0-9]{10})\b', text_clean)
    if telebirr_match:
        return telebirr_match.group(1)
        
    return parts[0] if parts else text_clean

# ---------------------------------------------------------------------------
# COMMANDS
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["start"])
def cmd_start(message):
    set_state(message.chat.id, STATE_IDLE)[cite: 2]
    bot.send_message(
        message.chat.id,
        "🌐 Choose Language / እባክዎ ቋንቋ ይምረጡ፡",
        reply_markup=lang_selection_markup()
    )

@bot.message_handler(content_types=["contact"])
def handle_contact(message):
    chat_id = message.chat.id[cite: 2]
    contact = message.contact[cite: 2]
    lang    = get_lang(chat_id)

    if contact.user_id != message.from_user.id:[cite: 2]
        bot.send_message(chat_id, STRINGS[lang]["invalid_contact"], reply_markup=registration_markup(lang))[cite: 2]
        return[cite: 2]

    tg_id       = contact.user_id[cite: 2]
    first_name  = message.from_user.first_name or ""[cite: 2]
    last_name   = message.from_user.last_name or ""[cite: 2]
    username    = message.from_user.username[cite: 2]
    phone       = contact.phone_number   [cite: 2]
    display     = f"{first_name} {last_name}".strip() or f"Player_{tg_id}"[cite: 2]

    if _supabase is not None:[cite: 2]
        try:[cite: 2]
            _supabase.table("tg_users").upsert({[cite: 2]
                "tg_id": tg_id, "display_name": display, "tg_username": username,[cite: 2]
                "phone": phone, "password_hash": "telegram_native_auth",[cite: 2]
            }, on_conflict="tg_id").execute()[cite: 2]
        except Exception:[cite: 2]
            bot.send_message(chat_id, "❌ Server error. Try /start again.", reply_markup=remove_keyboard())[cite: 2]
            return[cite: 2]

    bot.send_message(chat_id, STRINGS[lang]["reg_success"], reply_markup=remove_keyboard())[cite: 2]
    bot.send_message(chat_id, "🎮 *Main Menu*", reply_markup=main_menu_markup(lang))[cite: 2]

# ---------------------------------------------------------------------------
# CALLBACKS
# ---------------------------------------------------------------------------
@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    chat_id = call.message.chat.id[cite: 2]
    data    = call.data[cite: 2]
    lang    = get_lang(chat_id)

    if data.startswith("set_lang|"):
        bot.answer_callback_query(call.id)[cite: 2]
        selected_lang = data.split("|")[1]
        set_lang(chat_id, selected_lang)
        
        if _is_user_registered(call.from_user.id):[cite: 2]
            bot.send_message(chat_id, STRINGS[selected_lang]["welcome_back"], reply_markup=main_menu_markup(selected_lang))[cite: 2]
        else:[cite: 2]
            bot.send_message(chat_id, STRINGS[selected_lang]["welcome_new"], reply_markup=registration_markup(selected_lang))[cite: 2]

    elif data == "action_change_lang":
        bot.answer_callback_query(call.id)[cite: 2]
        bot.send_message(chat_id, "🌐 Choose Language / እባክዎ ቋንቋ ይምረጡ፡", reply_markup=lang_selection_markup())

    elif data == "action_balance":
        bot.answer_callback_query(call.id)[cite: 2]
        balance = _get_user_balance(call.from_user.id)[cite: 2]
        bot.send_message(chat_id, STRINGS[lang]["curr_bal"].format(balance))[cite: 2]
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))[cite: 2]

    elif data == "action_deposit":
        bot.answer_callback_query(call.id)[cite: 2]
        bot.send_message(chat_id, STRINGS[lang]["choose_provider"], reply_markup=payment_methods_markup())[cite: 2]

    elif data.startswith("dep_prov|"):
        bot.answer_callback_query(call.id)[cite: 2]
        provider = data.split("|")[1][cite: 2]
        user_deposit_data[chat_id] = {"provider": provider}[cite: 2]
        
        set_state(chat_id, STATE_AWAITING_DEPOSIT)[cite: 2]
        bot.send_message(chat_id, STRINGS[lang]["enter_amount"], reply_markup=cancel_reply_keyboard(lang))[cite: 2]
        bot.send_message(chat_id, "💡 Quick Options:", reply_markup=quick_amount_markup())

    elif data.startswith("dep_amt|"):
        bot.answer_callback_query(call.id)[cite: 2]
        if chat_id not in user_deposit_data:[cite: 2]
            user_deposit_data[chat_id] = {"provider": "telebirr"}[cite: 2]
        
        amount = float(data.split("|")[1])[cite: 2]
        user_deposit_data[chat_id]["amount"] = amount[cite: 2]
        provider = user_deposit_data[chat_id]["provider"][cite: 2]
        
        set_state(chat_id, STATE_AWAITING_TXN_SMS)[cite: 2]
        
        if provider == "telebirr":
            inst_txt = STRINGS[lang]["inst_telebirr"].format(amount)[cite: 2]
        elif provider == "cbe":
            inst_txt = STRINGS[lang]["inst_cbe"].format(amount)[cite: 2]
        else:
            inst_txt = f"⚙️ *{provider.upper()} DEPOSIT INSTRUCTION*\n\nPlease transfer *{amount} ETB* to our verified account system and paste the receipt details directly below:"[cite: 2]

        bot.send_message(chat_id, inst_txt, reply_markup=cancel_reply_keyboard(lang))[cite: 2]

    elif data == "action_withdraw":
        bot.answer_callback_query(call.id)[cite: 2]
        set_state(chat_id, STATE_AWAITING_WITHDRAW)[cite: 2]
        bot.send_message(chat_id, STRINGS[lang]["enter_with_amount"], reply_markup=cancel_reply_keyboard(lang))[cite: 2]

    else:
        bot.answer_callback_query(call.id)[cite: 2]

# ---------------------------------------------------------------------------
# STATE MACHINE (TEXT HANDLER & LIVE VERIFICATION)
# ---------------------------------------------------------------------------
@bot.message_handler(func=lambda m: m.content_type == "text" and not m.text.startswith("/"))
def handle_text(message):
    chat_id = message.chat.id[cite: 2]
    text    = message.text.strip()[cite: 2]
    state   = get_state(chat_id)[cite: 2]
    lang    = get_lang(chat_id)

    if text in (STRINGS["en"]["cancel_btn"], STRINGS["am"]["cancel_btn"]):[cite: 2]
        set_state(chat_id, STATE_IDLE)[cite: 2]
        bot.send_message(chat_id, STRINGS[lang]["action_cancelled"], reply_markup=remove_keyboard())[cite: 2]
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))[cite: 2]
        return

    # 🚀 AUTOMATED BANK VERIFICATION ENGINE ENGINE
    if state == STATE_AWAITING_TXN_SMS:
        set_state(chat_id, STATE_IDLE)[cite: 2]
        
        clean_txn_id = _extract_transaction_id(text)
        dep_info = user_deposit_data.get(chat_id, {"provider": "telebirr", "amount": 0.0})[cite: 2]
        expected_amount = float(dep_info.get("amount", 0.0))

        # Check for CBE account suffix formatting parameter
        suffix_val = None
        text_parts = text.split()
        if len(text_parts) > 1 and dep_info.get("provider") == "cbe":
            suffix_val = text_parts[1]

        wait_msg = bot.send_message(chat_id, STRINGS[lang]["checking_api"])

        # Send request to the Hosted Verification Routing Backend
        url = "https://verifyapi.leulzenebe.pro/verify"
        headers = {
            "x-api-key": VERIFIER_API_KEY,
            "Content-Type": "application/json"
        }
        payload = {"reference": clean_txn_id}
        if suffix_val:
            payload["suffix"] = suffix_val

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=25)
            api_data = response.json()

            if api_data.get("success"):
                # Get actual confirmed value from payload schema keys
                verified_amount = float(api_data.get("transactionAmount", api_data.get("total", 0.0)))

                if verified_amount >= expected_amount:
                    # SUCCESS: Credit their balance directly in Supabase
                    current_balance = _get_user_balance(message.from_user.id)
                    new_balance = current_balance + verified_amount
                    
                    if _supabase is not None:
                        _supabase.table("tg_users").update({"balance": new_balance}).eq("tg_id", message.from_user.id).execute()

                    bot.delete_message(chat_id, wait_msg.message_id)
                    bot.send_message(chat_id, STRINGS[lang]["api_success"].format(verified_amount), reply_markup=remove_keyboard())
                    
                    # Notify Admin profile about successful automation event
                    try:
                        bot.send_message(ADMIN_IDS[0], f"🟢 *AUTOMATED DEPOSIT SUCCESS*\nUser: `{message.from_user.id}`\nProvider: {dep_info.get('provider').upper()}\nRef: `{clean_txn_id}`\nAmount: `{verified_amount} ETB`")
                    except Exception: pass
                else:
                    bot.delete_message(chat_id, wait_msg.message_id)
                    bot.send_message(chat_id, STRINGS[lang]["api_wrong_amount"], reply_markup=remove_keyboard())
            else:
                # Bank verification rejected
                bot.delete_message(chat_id, wait_msg.message_id)
                bot.send_message(chat_id, STRINGS[lang]["api_fail"], reply_markup=remove_keyboard())

        except Exception as e:
            # Server timeout or network drop issues
            print(f"API Error: {e}")
            bot.delete_message(chat_id, wait_msg.message_id)
            bot.send_message(chat_id, STRINGS[lang]["api_error"], reply_markup=remove_keyboard())

        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))[cite: 2]
        return[cite: 2]

    if state in (STATE_AWAITING_DEPOSIT, STATE_AWAITING_WITHDRAW):[cite: 2]
        try:[cite: 2]
            amount = float(text)[cite: 2]
            if amount <= 0: raise ValueError[cite: 2]
        except ValueError:[cite: 2]
            bot.send_message(chat_id, STRINGS[lang]["invalid_amount"])[cite: 2]
            return[cite: 2]

        if state == STATE_AWAITING_DEPOSIT:[cite: 2]
            if chat_id not in user_deposit_data:[cite: 2]
                user_deposit_data[chat_id] = {"provider": "telebirr"}[cite: 2]
            
            user_deposit_data[chat_id]["amount"] = amount[cite: 2]
            provider = user_deposit_data[chat_id]["provider"][cite: 2]
            
            set_state(chat_id, STATE_AWAITING_TXN_SMS)[cite: 2]
            
            if provider == "telebirr":
                inst_txt = STRINGS[lang]["inst_telebirr"].format(amount)[cite: 2]
            elif provider == "cbe":
                inst_txt = STRINGS[lang]["inst_cbe"].format(amount)[cite: 2]
            else:
                inst_txt = f"⚙️ *{provider.upper()} DEPOSIT INSTRUCTION*\n\nPlease transfer *{amount} ETB* to our verified account system and paste the receipt details directly below:"[cite: 2]

            bot.send_message(chat_id, inst_txt, reply_markup=cancel_reply_keyboard(lang))[cite: 2]

        elif state == STATE_AWAITING_WITHDRAW:[cite: 2]
            user_balance = _get_user_balance(message.from_user.id)[cite: 2]
            set_state(chat_id, STATE_IDLE)[cite: 2]
            
            if amount > user_balance:[cite: 2]
                bot.send_message(chat_id, STRINGS[lang]["insufficient"].format(user_balance), reply_markup=remove_keyboard())[cite: 2]
            else:[cite: 2]
                bot.send_message(chat_id, STRINGS[lang]["with_submitted"].format(amount), reply_markup=remove_keyboard())[cite: 2]
                
                try:[cite: 2]
                    bot.send_message(ADMIN_IDS[0], f"💸 *NEW WITHDRAW REQUEST*\nUser ID: `{message.from_user.id}`\nAmount: `{amount:.2f} ETB`")[cite: 2]
                except Exception: pass[cite: 2]

            bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))[cite: 2]
        return[cite: 2]

    if state == STATE_IDLE:[cite: 2]
        bot.send_message(chat_id, "Please use the menu below:", reply_markup=main_menu_markup(lang))[cite: 2]

# ---------------------------------------------------------------------------
# ADMIN COMMANDS
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["credit"])
def cmd_credit(message):
    admin_id = message.from_user.id[cite: 2]
    chat_id  = message.chat.id[cite: 2]

    if not is_admin(admin_id): return[cite: 2]

    parts = message.text.strip().split()[cite: 2]
    if len(parts) < 2:[cite: 2]
        bot.send_message(chat_id, "⚠️ *Usage:* `/credit <amount> [target_tg_id]`")[cite: 2]
        return[cite: 2]

    try: amount = float(parts[1])[cite: 2]
    except ValueError: return bot.send_message(chat_id, "⚠️ Invalid amount.")[cite: 2]

    target_tg_id = admin_id[cite: 2]
    if len(parts) >= 3:[cite: 2]
        try: target_tg_id = int(parts[2])[cite: 2]
        except ValueError: return bot.send_message(chat_id, "⚠️ Invalid target ID.")[cite: 2]

    if _supabase is None: return[cite: 2]

    try:
        current = _get_user_balance(target_tg_id)[cite: 2]
        new_bal = current + amount[cite: 2]
        _supabase.table("tg_users").update({"balance": new_bal}).eq("tg_id", target_tg_id).execute()[cite: 2]

        bot.send_message([cite: 2]
            chat_id,[cite: 2]
            f"✅ *Credited {amount:.2f} ETB* to `{target_tg_id}`.\n\n"[cite: 2]
            f"💰 *New balance:* `{new_bal:.2f} ETB`"[cite: 2]
        )
        
        try:[cite: 2]
            bot.send_message(target_tg_id, f"🎉 *Deposit Successful!*\n\nYour account has been credited with `{amount:.2f} ETB`. Good luck playing CHELA Bingo!")[cite: 2]
        except Exception: pass[cite: 2]
        
    except Exception as e:
        bot.send_message(chat_id, f"❌ *Credit failed.*\n\nError: `{str(e)[:200]}`")[cite: 2]

if __name__ == "__main__":
    print(f"--- CHELA Bingo Bot Starting ---")[cite: 2]
    bot.infinity_polling(timeout=30, long_polling_timeout=20)[cite: 2]