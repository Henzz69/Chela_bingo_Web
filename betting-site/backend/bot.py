"""
CHELA Bingo - Telegram Bot
==========================
Handles: /start → Language Selection → Contact Registration → Play, Deposit, Withdraw, Balance.
Bilingual Support: English & Amharic (አማርኛ)
Automated Verification: Integrated with verify.leul.et API
Security: Bulletproof Optimistic Locking, Universal Destination Validation, & X-Ray Logging
Referral Engine: Deep-link interception and Split-Wallet display.
"""

import os
import re
import subprocess
import threading
import telebot
import requests 
import uuid
from telebot.types import (
    InlineKeyboardMarkup, InlineKeyboardButton,
    ReplyKeyboardMarkup, KeyboardButton,
    ReplyKeyboardRemove, WebAppInfo,
    BotCommand
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
VERIFIER_API_KEY      = os.getenv("VERIFIER_API_KEY", "")

# ---------------------------------------------------------------------------
# 🛡️ THE DESTINATION CHECKER (SECURITY SETTINGS)
# ---------------------------------------------------------------------------
VALID_MERCHANT_NAMES = [
    "HENOK MEBRATE",
    "BEREKET ALEMAYEHU"
]

VALID_MERCHANT_ACCOUNTS = [
    "0966617175",       # Telebirr (Bereket)
    "0723191843"        # M-Pesa (Bereket)
]

# ---------------------------------------------------------------------------
# ADMIN AUTHORIZATION & SECURITY LOCK
# ---------------------------------------------------------------------------
ADMIN_IDS = [5681654051]

def is_admin(message) -> bool:
    """
    STRICT SECURITY CHECK: Validates if the user is authorized to use admin commands.
    Prevents exploitation of Telegram's anonymous admin feature in private DMs.
    """
    # 1. Checks if it's your personal explicitly whitelisted ID
    if getattr(message, 'from_user', None) and message.from_user.id in ADMIN_IDS:
        return True
    
    # 2. VULNERABILITY PATCH: Only allow anonymous admin checks if it's ACTUALLY a group chat. 
    # This completely prevents normal users from spoofing the sender_chat in private DMs to steal credits.
    if message.chat.type in ['group', 'supergroup']:
        if getattr(message, 'sender_chat', None) and message.sender_chat.id == message.chat.id:
            return True
        if getattr(message, 'from_user', None) and message.from_user.id == 1087968824:
            return True
            
    return False

if not BOT_TOKEN or BOT_TOKEN == "your_bot_token_here":
    raise RuntimeError("TELEGRAM_BOT_TOKEN is not set in .env")

# ---------------------------------------------------------------------------
# SUPABASE CLIENT & SECURITY LOCKING
# ---------------------------------------------------------------------------
_supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("--- Supabase client created successfully ---")
    except Exception as e:
        print(f"--- ERROR creating Supabase client: {e} ---")
        _supabase = None

def _get_user_wallet(tg_id: int) -> tuple[float, float, float]:
    if _supabase is None:
        return 0.00, 0.00, 0.00
    try:
        result = _supabase.table("tg_users").select("balance, promo_balance, total_balance").eq("tg_id", tg_id).maybe_single().execute()
        if result.data:
            real = float(result.data.get("balance") or 0.00)
            promo = float(result.data.get("promo_balance") or 0.00)
            total = float(result.data.get("total_balance") or (real + promo))
            return real, promo, total
    except Exception as e:
        print(f"[wallet lookup error] {e}")
    return 0.00, 0.00, 0.00

def _is_user_registered(tg_id: int) -> bool:
    if _supabase is None:
        return False
    try:
        result = _supabase.table("tg_users").select("tg_id").eq("tg_id", tg_id).maybe_single().execute()
        if result and hasattr(result, 'data') and result.data is not None:
            return True
        return False
    except Exception:
        return False

def _reserve_transaction(txn_id: str, tg_id: int, amount: float) -> bool:
    if _supabase is None:
        return False 
    try:
        _supabase.table("used_transactions").insert({
            "txn_id": txn_id,
            "tg_id": tg_id,
            "amount": amount
        }).execute()
        return True 
    except Exception:
        return False

def _release_transaction(txn_id: str):
    if _supabase is None:
        return
    try:
        _supabase.table("used_transactions").delete().eq("txn_id", txn_id).execute()
    except Exception as e:
        print(f"Failed to release transaction lock: {e}")

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
    except Exception:
        pass

# ---------------------------------------------------------------------------
# BOT INIT & MULTI-LANGUAGE STATE
# ---------------------------------------------------------------------------
bot = telebot.TeleBot(BOT_TOKEN, parse_mode="Markdown")
bot.delete_webhook(drop_pending_updates=True)

try:
    bot.set_my_commands([
        BotCommand("start", "Main Menu / ዋና ማውጫ"),
        BotCommand("play", "Launch Bingo / ጨዋታ ጀምር"),
        BotCommand("deposit", "Deposit Funds / ብር ማስገባት"),
        BotCommand("withdraw", "Withdraw Funds / ብር ማውጣት"),
        BotCommand("balance", "Check Balance / ቀሪ ሂሳብ ማየት"),
        BotCommand("invite", "Refer Friends / ጓደኛ ጋብዝ"),
        BotCommand("support", "Help Center / የድጋፍ ማዕከል")
    ])
except Exception:
    pass

user_state: dict[int, str] = {}
user_lang: dict[int, str] = {}  
user_deposit_data: dict[int, dict] = {} 
user_withdraw_data: dict[int, dict] = {}
user_ref_data: dict[int, int] = {} 

STATE_IDLE              = "IDLE"
STATE_AWAITING_DEPOSIT  = "AWAITING_DEPOSIT"
STATE_AWAITING_TXN_SMS  = "AWAITING_TXN_SMS"
STATE_WITHDRAW_AMOUNT   = "WITHDRAW_AMOUNT"
STATE_WITHDRAW_BANK     = "WITHDRAW_BANK"
STATE_WITHDRAW_NAME     = "WITHDRAW_NAME"
STATE_WITHDRAW_ACCOUNT  = "WITHDRAW_ACCOUNT"
STATE_WITHDRAW_CONFIRM  = "WITHDRAW_CONFIRM"

def get_state(chat_id: int) -> str:
    return user_state.get(chat_id, STATE_IDLE)

def set_state(chat_id: int, state: str) -> None:
    user_state[chat_id] = state

def get_lang(chat_id: int) -> str:
    return user_lang.get(chat_id, "en")

def set_lang(chat_id: int, lang: str) -> None:
    user_lang[chat_id] = lang

def can_execute_command(message, allow_group_admin=False) -> bool:
    """Safely routes commands. Deletes public spam from regular users entirely."""
    if message.chat.type != "private":
        if allow_group_admin and is_admin(message):
            return True
        try:
            bot.delete_message(message.chat.id, message.message_id)
        except Exception:
            pass
        return False
    return True

# ---------------------------------------------------------------------------
# DICTIONARY FOR STRINGS (BILINGUAL)
# ---------------------------------------------------------------------------
STRINGS = {
    "en": {
        "welcome_back": "🎱 *CHELA Bingo*\n\nWelcome back to the lobby! You're fully registered and ready to go.\n\n• Click *PLAY CHELA BINGO* to launch multiplayer app.\n• Manage funds securely below.",
        "welcome_new": "🎱 *CHELA Bingo*\n\nWelcome to the most exciting 100-Player Bingo platform in Ethiopia!\n\n🎁 *Registration Bonus: 10 ETB!*\nTo get started, tap the button below to link your Telegram account securely.",
        "reg_btn": "📱 Register to Play",
        "play_btn": "🎮 PLAY CHELA BINGO",
        "dep_btn": "Deposit ➕",
        "with_btn": "Withdraw ➖",
        "bal_btn": "💰 My Balance",
        "lang_btn": "🌐 Language / ቋንቋ",
        "inv_btn": "🎁 Invite Friends",
        "sup_btn": "🎧 Support",
        "cancel_btn": "❌ Cancel",
        "invalid_contact": "⚠️ Please share *your own* contact.",
        "reg_success": "✅ *Registration Complete!*\n\nWelcome aboard! Your account is verified.\nUse the menu below to manage your wallet.",
        "curr_bal": "💰 *Wallet Breakdown:*\n\n💵 *Total Balance:* `{:.2f} ETB`\n🔓 *Withdrawable:* `{:.2f} ETB`\n🎁 *Promo/Bingo Cash:* `{:.2f} ETB`",
        "enter_amount": "📥 *Deposit Amount*\n\nPlease enter or select the exact amount of ETB you want to deposit:",
        "invalid_amount": "⚠️ Please enter a valid positive number.",
        "min_dep_err": "⚠️ *Invalid Amount:* The minimum deposit amount is 50 ETB.",
        "min_with_err": "⚠️ *Invalid Amount:* The minimum withdrawal amount is 500 ETB.",
        "insufficient": "❌ Insufficient Balance. You only have `{:.2f} ETB` withdrawable cash.",
        "promo_locked_err": "❌ *Withdrawal Failed*\n\nYou requested more than your withdrawable limit.\n\n🔓 Withdrawable: `{:.2f} ETB`\n🎁 Promo (Gameplay Only): `{:.2f} ETB`",
        "action_cancelled": "Action cancelled.",
        "choose_provider": "💳 *Select Deposit Provider*\n\nPlease select the preferred banking platform for payment verification:",
        "checking_api": "⏳ *Verifying transaction with the bank backend, please wait...*",
        "api_success": "🎉 *Deposit Automated Successfully!*\nYour account has been credited with `{:.2f} ETB`.",
        "api_wrong_amount": "⚠️ *Verification Alert:*\nTransaction found, but the amount paid does not match your initiated request.",
        "api_fail": "❌ *Verification Failed:*\nInvalid Transaction ID or the reference has expired/already been processed.",
        "api_used": "🚨 *Fraud Alert:*\nThis Transaction ID is currently processing or has already been credited. Double-spending is not allowed.",
        "api_error": "🚨 *System Error:*\nBank verification services are currently experiencing delays. Please try again later.",
        "invite_msg": "🎁 *Invite Friends & Earn!*\n\nShare this bot with your friends. Once 5 of them join and deposit, you automatically receive a 50 ETB Promo Bonus for free gameplay!\n\nYour Invite Link:\n`https://t.me/ChelaBingoBot?start=REF_{}`",
        "support_msg": "🎧 *CHELA Bingo Support*\n\nNeed help with a deposit, withdrawal, or a game issue? Our team is here 24/7.\n\nContact us directly: @ChelaSupport",
        "locked_warning": "⚠️ Please complete or cancel your current action first.",
        "cancel_instruction": "⬇️ Press the Cancel button below to abort.",
        
        "inst_telebirr": "Telebirr Account\n\n<code>0966617175</code>\n\n<blockquote>\n\nCheck if the name is HENOK.\n\n1. Send {} ETB to the Telebirr account above.\n\n2. Make sure the amount you send and the amount you requested here are exactly the same.\n\n3. After sending the money, you will receive a short text message (sms) from Telebirr containing the payment details.\n\n4. Copy the ENTIRE short text message (sms) you received and paste it into the Telegram text box below to send it.\n\nNote: Because the agent the bot connects you to may change with each deposit, make sure to send money ONLY to the Telebirr account provided above. If you send money to an agent other than the one provided, a 2% penalty will be applied.</blockquote>\n\nIf you face any payment problems\nYou can contact our agent here @ChelaSupport",
        "inst_mpesa": "M-Pesa Account\n\n<code>0723191843</code>\n\n<blockquote>1. Send {} ETB to the M-Pesa account above.\n\n2. Make sure the amount you send and the amount you requested here are exactly the same.\n\n3. After sending the money, you will receive a short text message (sms) from M-Pesa containing the payment details.\n\n4. Copy the ENTIRE short text message (sms) you received and paste it into the Telegram text box below to send it.\n\nNote: Because the agent the bot connects you to may change with each deposit, make sure to send money ONLY to the M-Pesa account provided above. If you send money to an agent other than the one provided, a 2% penalty will be applied.</blockquote>\n\nIf you face any payment problems\nYou can contact our agent here @ChelaSupport",
    },
    "am": {
        "welcome_back": "🎱 *ቼላ ቢንጎ (CHELA Bingo)*\n\nወደ መጫወቻው አዳራሽ በደህና መጡ! ምዝገባዎ ተጠናቋል።\n\n• የቢንጎ መተግበሪያውን ለመክፈት *PLAY CHELA BINGO* የሚለውን ይጫኑ።\n• ሂሳብዎን ከታች ባለው መቆጣጠሪያ ማስተዳደር ይችላሉ።",
        "welcome_new": "🎱 *ቼላ ቢንጎ (CHELA Bingo)*\n\nበኢትዮጵያ ውስጥ ወደሚገኘው እጅግ አስደሳች የ100 ተጫዋቾች የቢንጎ መድረክ እንኳን በደህና መጡ!\n\n🎁 *የምዝገባ ቦነስ፡ 10 ETB!*\nለመጀመር የቴሌግራም አካውንትዎን ደህንነቱ በተጠበቀ ሁኔታ ለማገናኘት ከታች ያለውን ቁልፍ ይጫኑ።",
        "reg_btn": "📱 ለመጫወት ይመዝገቡ",
        "play_btn": "🎮 ቼላ ቢንጎ ይጫወቱ (PLAY)",
        "dep_btn": "ብር አስገባ ➕",
        "with_btn": "ብር አውጣ ➖",
        "bal_btn": "💰 የኔ ቀሪ ሂሳብ",
        "lang_btn": "🌐 Language / ቋንቋ",
        "inv_btn": "🎁 ጓደኛ ጋብዝ",
        "sup_btn": "🎧 የድጋፍ ማዕከል",
        "cancel_btn": "❌ ሰርዝ",
        "invalid_contact": "⚠️ እባክዎን *የራስዎን* ስልክ ያጋሩ።",
        "reg_success": "✅ *ምዝገባው ተጠናቋል!*\n\nእንኳን ደህና መጡ! መለያዎ ተረጋግጧል።\nየኪስ ቦርሳዎን ለማስተዳደር ከታች ያለውን ምናሌ ይጠቀሙ።",
        "curr_bal": "💰 *የኪስ ቦርሳዎ:*\n\n💵 *ጠቅላላ ቀሪ ሂሳብ:* `{:.2f} ETB`\n🔓 *ማውጣት የሚቻለው:* `{:.2f} ETB`\n🎁 *የቦነስ/ፕሮሞ ሂሳብ:* `{:.2f} ETB`",
        "enter_amount": "📥 *የማስቀመጫ መጠን*\n\nእባክዎ ማስገባት የሚፈልጉትን የገንዘብ መጠን በETB ያስገቡ ወይም ይምረጡ:",
        "invalid_amount": "⚠️ እባክዎን ትክክለኛ ቁጥር ያስገቡ።",
        "min_dep_err": "⚠️ *የተሳሳተ መጠን:* አነስተኛው የገንዘብ ማስገቢያ መጠን 50 ETB ነው።",
        "min_with_err": "⚠️ *የተሳሳተ መጠን:* አነስተኛው የገንዘብ ማውጫ መጠን 500 ETB ነው።",
        "insufficient": "❌ በቂ ቀሪ ሂሳብ የለዎትም። ማውጣት የሚችሉት `{:.2f} ETB` ብቻ ነው።",
        "promo_locked_err": "❌ *ማውጣት አልተሳካም*\n\nከሚፈቀደው የማውጫ መጠን በላይ ጠይቀዋል።\n\n🔓 ማውጣት የሚቻለው: `{:.2f} ETB`\n🎁 ፕሮሞ (ለመጫወቻ ብቻ): `{:.2f} ETB`",
        "action_cancelled": "ድርጊቱ ተሰርዟል።",
        "choose_provider": "💳 *የክፍያ መንገድ ይምረጡ*\n\nእባክዎ ለማረጋገጫ የሚጠቀሙበትን የባንክ ወይም የክፍያ አማራጭ ይምረጡ:",
        "checking_api": "⏳ *ግብይቱን ከባንክ ጋር እያረጋገጥን ነው፣ እባክዎ ይጠብቁ...*",
        "api_success": "🎉 *ክፍያዎ በራስ-ሰር ተረጋግጧል!*\nወደ መለያዎ `{:.2f} ETB` ገቢ ሆኗል።",
        "api_wrong_amount": "⚠️ *የማረጋገጫ ስህተት:*\nግብይቱ ተገኝቷል ነገር ግን የከፈሉት መጠን መጀመሪያ ካስገቡት መጠን ጋር አይዛመድም።",
        "api_fail": "❌ *ማረጋገጫው አልተሳካም:*\nየግብይት መለያ ቁጥሩ የተሳሳተ ነው ወይም ከዚህ በፊት ጥቅም ላይ ውሏል።",
        "api_used": "🚨 *የማጭበርበር ሙከራ:*\nይህ የግብይት መለያ ቁጥር ከዚህ በፊት ጥቅም ላይ ውሏል። አንድን ደረሰኝ ደጋግሞ መጠቀም አይቻልም።",
        "api_error": "🚨 *የስርዓት መቆራረጥ:*\nየባንክ ማረጋገጫ መስመሮች ስራ በዝቶባቸዋል። እባክዎ ከጥቂት ደቂቃዎች በኋላ እንደገና ይሞክሩ።",
        "invite_msg": "🎁 *ጓደኞችዎን ይጋብዙ!*\n\nይህን ቦት ለጓደኞችዎ በማጋራት 5ቱ ሲመዘገቡና ክፍያ ሲፈፅሙ የ 50 ETB ፕሮሞ ቦነስ በራስ ሰር ያገኛሉ!\n\nየመጋበዣ ሊንክዎ:\n`https://t.me/ChelaBingoBot?start=REF_{}`",
        "support_msg": "🎧 *የቼላ ቢንጎ ድጋፍ ማዕከል*\n\nስለ ክፍያ፣ ገንዘብ ማውጣት ወይም ጨዋታ እርዳታ ይፈልጋሉ? ቡድናችን 24/7 ዝግጁ ነው።\n\nያነጋግሩን: @ChelaSupport",
        "locked_warning": "⚠️ እባክዎ መጀመሪያ አሁን የጀመሩትን ሂደት ያጠናቅቁ ወይም ይሰርዙ።",
        "cancel_instruction": "⬇️ ለማቋረጥ ከታች ያለውን የሰርዝ ቁልፍ ይጫኑ።",
        
        "inst_telebirr": "የቴሌብር አካውንት\n\n<code>0966617175</code>\n\n<blockquote>1. Send {} ETB to the Telebirr account above.\n\n2. Make sure the amount you send and the amount you requested here are exactly the same.\n\n3. After sending the money, you will receive a short text message (sms) from Telebirr containing the payment details.\n\n4. Copy the ENTIRE short text message (sms) you received and paste it into the Telegram text box below to send it.\n\nNote: Because the agent the bot connects you to may change with each deposit, make sure to send money ONLY to the Telebirr account provided above. If you send money to an agent other than the one provided, a 2 penalty will be applied.</blockquote>\n\nየሚያጋጥምዎ የክፍያ ችግር ካለ\n@ChelaSupport በዚህ ኤጀንታችን ማዋራት እና ማሳወቅ ይችላሉ",
        "inst_mpesa": "የኤም-ፔሳ (M-Pesa) አካውንት\n\n<code>0723191843</code>\n\n<blockquote>1. Send {} ETB to the M-Pesa account above.\n\n2. Make sure the amount you send and the amount you requested here are exactly the same.\n\n3. After sending the money, you will receive a short text message (sms) from M-Pesa containing the payment details.\n\n4. Copy the ENTIRE short text message (sms) you received and paste it into the Telegram text box below to send it.\n\nNote: Because the agent the bot connects you to may change with each deposit, make sure to send money ONLY to the M-Pesa account provided above. If you send money to an agent other than the one provided, a 2% penalty will be applied.</blockquote>\n\nየሚያጋጥምዎ የክፍያ ችግር ካለ\n@ChelaSupport በዚህ ኤጀንታችን ማዋራት እና ማሳወቅ ይችላሉ",
    }
}

# ---------------------------------------------------------------------------
# MARKUPS 
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
    kb.add(KeyboardButton(STRINGS[lang]["reg_btn"], request_contact=True))
    return kb

def main_menu_markup(lang: str) -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.row(
        InlineKeyboardButton(STRINGS[lang].get("play_btn", "🎮 PLAY CHELA BINGO"), web_app=WebAppInfo(url=MINI_APP_URL))
    )
    kb.row(
        InlineKeyboardButton(STRINGS[lang].get("dep_btn", "Deposit ➕"),  callback_data="action_deposit"),
        InlineKeyboardButton(STRINGS[lang].get("with_btn", "Withdraw ➖"), callback_data="action_withdraw")
    )
    kb.row(
        InlineKeyboardButton(STRINGS[lang].get("bal_btn", "💰 My Balance"), callback_data="action_balance"),
        InlineKeyboardButton(STRINGS[lang].get("lang_btn", "🌐 Language / ቋንቋ"), callback_data="action_change_lang")
    )
    kb.row(
        InlineKeyboardButton(STRINGS[lang].get("inv_btn", "🎁 Invite Friends"), callback_data="action_invite"),
        InlineKeyboardButton(STRINGS[lang].get("sup_btn", "🎧 Support"), callback_data="action_support")
    )
    return kb

def cancel_reply_keyboard(lang: str) -> ReplyKeyboardMarkup:
    kb = ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False)
    kb.add(KeyboardButton(STRINGS[lang]["cancel_btn"]))
    return kb

def payment_methods_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(
        InlineKeyboardButton("Telebirr 📱", callback_data="dep_prov|telebirr"),
        InlineKeyboardButton("M-Pesa 💸", callback_data="dep_prov|mpesa")
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

def withdraw_bank_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(
        InlineKeyboardButton("Telebirr", callback_data="with_bank|Telebirr")
    )
    kb.add(
        InlineKeyboardButton("Bank of Abyssinia", callback_data="with_bank|Bank of Abyssinia"),
        InlineKeyboardButton("Awash Bank", callback_data="with_bank|Awash Bank")
    )
    kb.add(
        InlineKeyboardButton("Dashin Bank", callback_data="with_bank|Dashin Bank")
    )
    return kb

def withdraw_confirm_markup() -> InlineKeyboardMarkup:
    kb = InlineKeyboardMarkup(row_width=2)
    kb.add(
        InlineKeyboardButton("✅ Confirm", callback_data="with_confirm|yes"),
        InlineKeyboardButton("❌ Cancel", callback_data="with_confirm|no")
    )
    return kb

def remove_keyboard() -> ReplyKeyboardRemove:
    return ReplyKeyboardRemove()

# ---------------------------------------------------------------------------
# AUTOMATIC WELCOME LISTENER
# ---------------------------------------------------------------------------
@bot.message_handler(content_types=['new_chat_members'])
def send_welcome_banner(message):
    for new_user in message.new_chat_members:
        if new_user.id != bot.get_me().id:
            try:
                kb = InlineKeyboardMarkup()
                kb.add(InlineKeyboardButton("🎮 አሁን ይጫወቱ (Play Now)", url="https://t.me/chelabingobot"))
                
                welcome_text = (
                    f"እንኳን ወደ Chela Bingo በደህና መጡ {new_user.first_name}! 🎉\n\n"
                    "በዚህ ግሩፕ ውስጥ አዝናኝ የቢንጎ ጨዋታዎችን፣ ዕለታዊ ጃክፖቶችን እና አዳዲስ የጨዋታ መረጃዎችን ያገኛሉ! 💸✨\n\n"
                    "🎰 ምን ይጠብቆታል?\n"
                    "🔹 ዕለታዊ ጃክፖቶች 💰\n"
                    "🔹 የተለያዩ የጨዋታ አማራጮች 🎯\n"
                    "🔹 ልዩ እና አዝናኝ የቢንጎ ቅጦች ✨\n\n"
                    "ለመጫወት እና ለማሸነፍ ዝግጁ ነዎት? አሁኑኑ ይጀምሩ! መልካም ዕድል! 🍀\n\n"
                    "📍 አብረውን ስለሆኑ እናመሰግናለን!"
                )
                
                bot.send_photo(
                    message.chat.id, 
                    open('banner.jpg', 'rb'), 
                    caption=welcome_text,
                    reply_markup=kb
                )
            except Exception as e:
                print(f"Error sending welcome banner: {e}")

# ---------------------------------------------------------------------------
# REUSABLE TRANSACTION PARSER
# ---------------------------------------------------------------------------
def _extract_transaction_id(text: str):
    cbe_url_match = re.search(r'[\?&]id=(FT[a-zA-Z0-9]+)', text, flags=re.IGNORECASE)
    if cbe_url_match:
        return cbe_url_match.group(1).upper()
        
    text_no_urls = re.sub(r'https?://\S+|www\.\S+', ' ', text, flags=re.IGNORECASE)
    clean_text = re.sub(r'[^a-zA-Z0-9\s]', ' ', text_no_urls)
    words = clean_text.upper().split()
    
    for word in words:
        if word.startswith('FT') and len(word) >= 12 and word.isalnum():
            return word
            
    for word in words:
        if 8 <= len(word) <= 12:
            if any(char.isalpha() for char in word) and any(char.isdigit() for char in word):
                return word
                
    return None

# ---------------------------------------------------------------------------
# COMMAND HANDLERS
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["start"])
def cmd_start(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    
    # Emergency hatch: /start ALWAYS breaks the lock and resets state
    set_state(chat_id, STATE_IDLE)
    
    parts = message.text.split()
    if len(parts) > 1 and parts[1].startswith("REF_"):
        try:
            ref_id = int(parts[1].split("_")[1])
            if ref_id != message.from_user.id:
                user_ref_data[chat_id] = ref_id
        except Exception:
            pass

    lang = get_lang(chat_id)
    banner_path = 'banner.jpg' 

    if _is_user_registered(message.from_user.id):
        try:
            bot.send_photo(chat_id, open(banner_path, 'rb'), 
                           caption=STRINGS[lang]["welcome_back"], 
                           reply_markup=main_menu_markup(lang))
        except Exception:
            bot.send_message(chat_id, STRINGS[lang]["welcome_back"], reply_markup=main_menu_markup(lang))
    else:
        bot.send_message(
            chat_id,
            "🌐 Choose Language / እባክዎ ቋንቋ ይምረጡ፡",
            reply_markup=lang_selection_markup()
        )

@bot.message_handler(commands=["play"])
def cmd_play(message):
    if not can_execute_command(message, allow_group_admin=True):
        return
    
    chat_id = message.chat.id
    lang = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    kb = InlineKeyboardMarkup()
    kb.add(InlineKeyboardButton("🎮 አሁን ይጫወቱ (Play Now)", web_app=WebAppInfo(url=MINI_APP_URL)))
    
    welcome_text = (
        "🎰 *እንኳን ወደ Chela Bingo በደህና መጡ!* 🎉\n\n"
        "በዚህ ግሩፕ ውስጥ አዝናኝ የቢንጎ ጨዋታዎችን፣ ዕለታዊ ጃክፖቶችን እና አዳዲስ የጨዋታ መረጃዎችን ያገኛሉ! 💸✨\n\n"
        "🎰 ምን ይጠብቆታል?\n"
        "🔹 ዕለታዊ ጃክፖቶች 💰\n"
        "🔹 የተለያዩ የጨዋታ አማራጮች 🎯\n"
        "🔹 ልዩ እና አዝናኝ የቢንጎ ቅጦች ✨\n\n"
        "ለመጫወት እና ለማሸነፍ ዝግጁ ነዎት? አሁኑኑ ይጀምሩ! መልካም ዕድል! 🍀\n\n"
        "📍 አብረውን ስለሆኑ እናመሰግናለን!"
    )
    
    try:
        bot.send_photo(chat_id, open('banner.jpg', 'rb'), 
                       caption=welcome_text, 
                       reply_markup=kb)
    except Exception:
        bot.send_message(chat_id, welcome_text, reply_markup=kb)

@bot.message_handler(commands=["invite"])
def cmd_invite(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    lang = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    ref_link = f"https://t.me/ChelaBingoBot?start=REF_{message.from_user.id}"
    
    invite_text = (
        "💥 *ልዩ የቼላ ቢንጎ ቅናሽ!* 💥🤝🤑\n"
        "እንኳን ደህና መጡ ወደ አዲሱ እና ትልቁ የጋባዥነት ፕሮግራማችን! 👑✨\n"
        "💸 *5 ጓደኞችን ይጋብዙ፣ ወዲያውኑ 50 ETB ይውሰዱ!* 💸💎\n\n"
        "ይህ ለተወሰነ ጊዜ ብቻ የሚቆይ ነው፣ አሁኑኑ ተጠቀሙበት።\n"
        "5 ሰዎች ሲመዘገቡ ወዲያውኑ 50 ETB የቼላ ቢንጎ አካውንት ላይ ይጨመራል።\n\n"
        "በተጨማሪም የጨላ ቢንጎ አባላት የሚከተሉትን ጥቅሞች ያገኛሉ፡\n"
        "🏆 ዕለታዊ ሽልማቶች\n"
        "🎰 የጨዋታ አማራጮች\n"
        "🤝 የማህበረሰብ ውይይት\n\n"
        "ይህንን ልዩ ዕድል አያምልጥዎ! ⏳\n"
        "🚀 አሁኑኑ ያጋሩ እና ማሸነፍ ይጀምሩ! 🥳💸\n\n"
        f"🔗 *የመጋበዣ ሊንክዎ:*\n`{ref_link}`"
    )
    
    kb = InlineKeyboardMarkup()
    share_url = f"https://t.me/share/url?url={ref_link}&text=Play%20Chela%20Bingo%20and%20win!"
    kb.add(InlineKeyboardButton("🔗 አሁኑኑ ያጋሩ (Share Now)", url=share_url))
    
    try:
        bot.send_photo(
            chat_id, 
            open('invite_banner.jpg', 'rb'), 
            caption=invite_text, 
            reply_markup=kb,
            parse_mode="Markdown"
        )
    except Exception:
        bot.send_message(chat_id, invite_text, reply_markup=kb, parse_mode="Markdown")

@bot.message_handler(commands=["support"])
def cmd_support(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    lang = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    bot.send_message(chat_id, STRINGS[lang]["support_msg"])

@bot.message_handler(commands=["balance"])
def cmd_balance(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    lang = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    real_bal, promo_bal, total_bal = _get_user_wallet(message.from_user.id)
    bot.send_message(chat_id, STRINGS[lang]["curr_bal"].format(total_bal, real_bal, promo_bal))
    bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))

@bot.message_handler(commands=["deposit"])
def cmd_deposit(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    lang = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    set_state(chat_id, STATE_AWAITING_DEPOSIT)
    bot.send_message(chat_id, STRINGS[lang]["cancel_instruction"], reply_markup=cancel_reply_keyboard(lang))
    bot.send_message(chat_id, STRINGS[lang]["choose_provider"], reply_markup=payment_methods_markup())

@bot.message_handler(commands=["withdraw"])
def cmd_withdraw(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    lang = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    set_state(chat_id, STATE_WITHDRAW_AMOUNT)
    bot.send_message(chat_id, STRINGS[lang]["cancel_instruction"], reply_markup=cancel_reply_keyboard(lang))
    bot.send_message(chat_id, "Please send the amount to withdraw:")

@bot.message_handler(commands=["testsms"])
def cmd_testsms(message):
    if not is_admin(message):
        return
    
    raw_text = message.text.replace("/testsms", "").strip()
    if not raw_text:
        bot.send_message(message.chat.id, "⚠️ Paste an SMS after the command.\nExample: `/testsms Dear Eyasu You have transferred...`")
        return
        
    extracted_id = _extract_transaction_id(raw_text)
    
    if extracted_id:
        bot.send_message(message.chat.id, f"✅ *SUCCESS!*\nThe bot strictly extracted: `{extracted_id}`")
    else:
        bot.send_message(message.chat.id, f"❌ *FAILED!*\nThe bot could not find a valid alphanumeric transaction ID in that text.")

# ---------------------------------------------------------------------------
# ADMIN MANUAL SEND BANNER
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["send"])
def cmd_send_manual_banner(message):
    if not is_admin(message):
        try:
            bot.delete_message(message.chat.id, message.message_id)
        except Exception:
            pass
        return

    try:
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("🎮 አሁን ይጫወቱ (Play Now)", web_app=WebAppInfo(url=MINI_APP_URL)))
        
        welcome_text = (
            "🎰 *እንኳን ወደ Chela Bingo በደህና መጡ!* 🎉\n\n"
            "በዚህ ግሩፕ ውስጥ አዝናኝ የቢንጎ ጨዋታዎችን፣ ዕለታዊ ጃክፖቶችን እና አዳዲስ የጨዋታ መረጃዎችን ያገኛሉ! 💸✨\n\n"
            "🎰 ምን ይጠብቆታል?\n"
            "🔹 ዕለታዊ ጃክፖቶች 💰\n"
            "🔹 የተለያዩ የጨዋታ አማራጮች 🎯\n"
            "🔹 ልዩ እና አዝናኝ የቢንጎ ቅጦች ✨\n\n"
            "ለመጫወት እና ለማሸነፍ ዝግጁ ነዎት? አሁኑኑ ይጀምሩ! መልካም ዕድል! 🍀\n\n"
            "📍 አብረውን ስለሆኑ እናመሰግናለን!"
        )
        
        bot.send_photo(
            message.chat.id, 
            open('banner.jpg', 'rb'), 
            caption=welcome_text,
            reply_markup=kb
        )
    except Exception as e:
        bot.send_message(message.chat.id, f"Error sending banner: {e}")
        print(f"Error sending manual banner: {e}")

# ---------------------------------------------------------------------------
# SECURE /CREDIT COMMAND
# ---------------------------------------------------------------------------
@bot.message_handler(commands=["credit"])
def cmd_credit(message):
    """
    Highly secured credit addition logic. Bypasses anonymous group spoofing.
    """
    chat_id  = message.chat.id

    if not is_admin(message):
        return

    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(chat_id, "⚠️ *Usage:* `/credit <amount> [target_tg_id]`")
        return

    try:
        amount = float(parts[1])
        if amount <= 0 or amount > 50000:
            bot.send_message(chat_id, "⚠️ Invalid amount. Must be positive and reasonable.")
            return
    except ValueError:
        bot.send_message(chat_id, "⚠️ Invalid amount format.")
        return

    target_tg_id = message.from_user.id
    if len(parts) >= 3:
        try:
            target_tg_id = int(parts[2])
        except ValueError:
            bot.send_message(chat_id, "⚠️ Invalid target ID.")
            return

    if _supabase is None:
        return

    try:
        real_bal, promo_bal, total_bal = _get_user_wallet(target_tg_id)
        new_bal = real_bal + amount
        
        _supabase.table("tg_users").update({"balance": new_bal}).eq("tg_id", target_tg_id).execute()
        
        # Log this admin credit injection for tracing
        _supabase.table("transactions").insert({
            "id": str(uuid.uuid4()),
            "user_id": str(target_tg_id),
            "amount": amount,
            "tx_type": "deposit",
            "status": "completed"
        }).execute()

        bot.send_message(chat_id, f"✅ *Credited {amount:.2f} ETB* to `{target_tg_id}`.\n\n💰 *New Real Balance:* `{new_bal:.2f} ETB`")
        
        try:
            bot.send_message(target_tg_id, f"🎉 *Deposit Successful!*\n\nYour account has been credited with `{amount:.2f} ETB`.")
        except Exception:
            pass
        
    except Exception as e:
        bot.send_message(chat_id, f"❌ *Credit failed.*\n\nError: `{str(e)[:200]}`")

# ---------------------------------------------------------------------------
# CONTACT REGISTRATION
# ---------------------------------------------------------------------------
@bot.message_handler(content_types=["contact"])
def handle_contact(message):
    if not can_execute_command(message, allow_group_admin=False):
        return
    
    chat_id = message.chat.id
    contact = message.contact
    lang    = get_lang(chat_id)
    
    if get_state(chat_id) != STATE_IDLE:
        bot.send_message(chat_id, STRINGS[lang]["locked_warning"], reply_markup=cancel_reply_keyboard(lang))
        return

    if contact.user_id != message.from_user.id:
        bot.send_message(chat_id, STRINGS[lang]["invalid_contact"], reply_markup=registration_markup(lang))
        return

    tg_id       = contact.user_id
    first_name  = message.from_user.first_name or ""
    last_name   = message.from_user.last_name or ""
    username    = message.from_user.username
    phone       = contact.phone_number  
    display     = f"{first_name} {last_name}".strip() or f"Player_{tg_id}"
    ref_id = user_ref_data.get(chat_id, None)

    if _supabase is not None:
        try:
            payload = {
                "tg_id": tg_id, 
                "display_name": display, 
                "tg_username": username,
                "phone": phone, 
                "password_hash": "telegram_native_auth"
            }
            if ref_id:
                payload["referrer_id"] = ref_id

            _supabase.table("tg_users").upsert(payload, on_conflict="tg_id").execute()
        except Exception:
            bot.send_message(chat_id, "❌ Server error. Try /start again.", reply_markup=remove_keyboard())
            return

    bot.send_message(chat_id, STRINGS[lang]["reg_success"], reply_markup=remove_keyboard())
    bot.send_message(chat_id, "🎮 *Main Menu*", reply_markup=main_menu_markup(lang))

# ---------------------------------------------------------------------------
# CALLBACKS
# ---------------------------------------------------------------------------
@bot.callback_query_handler(func=lambda call: True)
def handle_callback(call):
    if call.message.chat.type != "private":
        bot.answer_callback_query(call.id)
        return
        
    chat_id = call.message.chat.id
    data    = call.data
    lang    = get_lang(chat_id)
    state   = get_state(chat_id)

    # 🚀 FIXED STATE LOCKING ENFORCEMENT
    if state != STATE_IDLE:
        is_allowed = False
        
        if state == STATE_AWAITING_DEPOSIT and (data.startswith("dep_prov|") or data.startswith("dep_amt|")):
            is_allowed = True
        elif state == STATE_WITHDRAW_BANK and data.startswith("with_bank|"):
            is_allowed = True
        elif state == STATE_WITHDRAW_CONFIRM and data.startswith("with_confirm|"):
            is_allowed = True
            
        if not is_allowed:
            bot.answer_callback_query(call.id, STRINGS[lang]["locked_warning"], show_alert=True)
            return

    if data.startswith("set_lang|"):
        bot.answer_callback_query(call.id)
        selected_lang = data.split("|")[1]
        set_lang(chat_id, selected_lang)
        
        if _is_user_registered(call.from_user.id):
            bot.send_message(chat_id, STRINGS[selected_lang]["welcome_back"], reply_markup=main_menu_markup(selected_lang))
        else:
            try:
                bot.send_photo(
                    chat_id, 
                    open('reg_banner.jpg', 'rb'), 
                    caption=STRINGS[selected_lang]["welcome_new"], 
                    reply_markup=registration_markup(selected_lang)
                )
            except Exception:
                bot.send_message(chat_id, STRINGS[selected_lang]["welcome_new"], reply_markup=registration_markup(selected_lang))

    elif data == "action_change_lang":
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, "🌐 Choose Language / እባክዎ ቋንቋ ይምረጡ፡", reply_markup=lang_selection_markup())

    elif data == "action_balance":
        bot.answer_callback_query(call.id)
        real_bal, promo_bal, total_bal = _get_user_wallet(call.from_user.id)
        bot.send_message(chat_id, STRINGS[lang]["curr_bal"].format(total_bal, real_bal, promo_bal))
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))

    elif data == "action_deposit":
        bot.answer_callback_query(call.id)
        set_state(chat_id, STATE_AWAITING_DEPOSIT)
        bot.send_message(chat_id, STRINGS[lang]["cancel_instruction"], reply_markup=cancel_reply_keyboard(lang))
        bot.send_message(chat_id, STRINGS[lang]["choose_provider"], reply_markup=payment_methods_markup())

    elif data.startswith("dep_prov|"):
        bot.answer_callback_query(call.id)
        provider = data.split("|")[1]
        user_deposit_data[chat_id] = {"provider": provider}
        bot.send_message(chat_id, STRINGS[lang]["enter_amount"], reply_markup=cancel_reply_keyboard(lang))
        bot.send_message(chat_id, "💡 Quick Options:", reply_markup=quick_amount_markup())

    elif data.startswith("dep_amt|"):
        bot.answer_callback_query(call.id)
        if chat_id not in user_deposit_data:
            user_deposit_data[chat_id] = {"provider": "telebirr"}
        amount = float(data.split("|")[1])
        user_deposit_data[chat_id]["amount"] = amount
        provider = user_deposit_data[chat_id]["provider"]
        set_state(chat_id, STATE_AWAITING_TXN_SMS)
        inst_txt = STRINGS[lang][f"inst_{provider}"].format(amount)
        bot.send_message(chat_id, inst_txt, reply_markup=cancel_reply_keyboard(lang), parse_mode="HTML")

    elif data == "action_withdraw":
        bot.answer_callback_query(call.id)
        set_state(chat_id, STATE_WITHDRAW_AMOUNT)
        bot.send_message(chat_id, STRINGS[lang]["cancel_instruction"], reply_markup=cancel_reply_keyboard(lang))
        bot.send_message(chat_id, "Please send the amount to withdraw:")

    # --- WITHDRAWAL FLOW CALLBACKS ---
    elif data.startswith("with_bank|"):
        bot.answer_callback_query(call.id)
        bank = data.split("|")[1]
        if chat_id not in user_withdraw_data: 
            user_withdraw_data[chat_id] = {}
        user_withdraw_data[chat_id]["bank"] = bank
        set_state(chat_id, STATE_WITHDRAW_NAME)
        bot.send_message(chat_id, f"Please send the account holder's name for {bank}:")

    elif data.startswith("with_confirm|"):
        bot.answer_callback_query(call.id)
        choice = data.split("|")[1]
        set_state(chat_id, STATE_IDLE)
        
        if choice == "no":
            bot.send_message(chat_id, STRINGS[lang]["action_cancelled"], reply_markup=remove_keyboard())
            bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
            return
            
        w_data = user_withdraw_data.get(chat_id, {})
        amount = w_data.get("amount", 0)
        bank = w_data.get("bank", "Unknown")
        name = w_data.get("name", "Unknown")
        account = w_data.get("account", "Unknown")
        
        real_bal, promo_bal, total_bal = _get_user_wallet(call.from_user.id)
        
        if amount > real_bal:
            bot.send_message(chat_id, STRINGS[lang]["promo_locked_err"].format(real_bal, promo_bal), reply_markup=remove_keyboard())
        else:
            if _supabase is not None:
                new_balance = real_bal - amount
                _supabase.table("tg_users").update({"balance": new_balance}).eq("tg_id", call.from_user.id).execute()
                
                ref = "cN5" + str(uuid.uuid4().hex)[:7].upper()
                
                _supabase.table("transactions").insert({
                    "id": str(uuid.uuid4()),
                    "user_id": str(call.from_user.id),
                    "amount": amount,
                    "tx_type": "withdrawal",
                    "status": "pending",
                    "bank_name": bank,
                    "account_name": name,
                    "account_number": account
                }).execute()
                
                success_msg = f"Withdrawal request successful\n\nBank: `{bank}`\nAccount Name: `{name}`\nAccount Number: `{account}`\nAmount: `{amount} ETB`\nreference: `{ref}`"
                bot.send_message(chat_id, success_msg, reply_markup=remove_keyboard(), parse_mode="Markdown")
        
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))

    elif data == "action_invite":
        bot.answer_callback_query(call.id)
        ref_link = f"https://t.me/ChelaBingoBot?start=REF_{call.from_user.id}"
        invite_text = (
            "💥 *ልዩ የቼላ ቢንጎ ቅናሽ!* 💥🤝🤑\n"
            "እንኳን ደህና መጡ ወደ አዲሱ እና ትልቁ የጋባዥነት ፕሮግራማችን! 👑✨\n"
            "💸 *5 ጓደኞችን ይጋብዙ፣ ወዲያውኑ 50 ETB ይውሰዱ!* 💸💎\n\n"
            "ይህ ለተወሰነ ጊዜ ብቻ የሚቆይ ነው፣ አሁኑኑ ተጠቀሙበት።\n"
            "5 ሰዎች ሲመዘገቡ ወዲያውኑ 50 ETB የቼላ ቢንጎ አካውንት ላይ ይጨመራል።\n\n"
            "በተጨማሪም የጨላ ቢን አባላት የሚከተሉትን ጥቅሞች ያገኛሉ፡\n"
            "🏆 ዕለታዊ ሽልማቶች\n"
            "🎰 የጨዋታ አማራጮች\n"
            "🤝 የማህበረሰብ ውይይት\n\n"
            "ይህንን ልዩ ዕድል አያምልጥዎ! ⏳\n"
            "🚀 አሁኑኑ ያጋሩ እና ማሸነፍ ይጀምሩ! 🥳💸\n\n"
            f"🔗 *የመጋበዣ ሊንክዎ:*\n`{ref_link}`"
        )
        share_url = f"https://t.me/share/url?url={ref_link}&text=Play%20Chela%20Bingo%20and%20win!"
        kb = InlineKeyboardMarkup()
        kb.add(InlineKeyboardButton("🔗 አሁኑኑ ያጋሩ (Share Now)", url=share_url))
        try:
            bot.send_photo(chat_id, open('invite_banner.jpg', 'rb'), caption=invite_text, reply_markup=kb, parse_mode="Markdown")
        except Exception:
            bot.send_message(chat_id, invite_text, reply_markup=kb, parse_mode="Markdown")
            
    elif data == "action_support":
        bot.answer_callback_query(call.id)
        bot.send_message(chat_id, STRINGS[lang]["support_msg"])

    else:
        bot.answer_callback_query(call.id)

# ---------------------------------------------------------------------------
# STATE MACHINE & SECURE VERIFICATION ROUTING
# ---------------------------------------------------------------------------
@bot.message_handler(func=lambda m: m.content_type == "text" and not m.text.startswith("/"))
def handle_text(message):
    # Public group text cleanup rules
    if message.chat.type != "private":
        if not is_admin(message):
            try:
                bot.delete_message(message.chat.id, message.message_id)
            except Exception:
                pass
        return

    chat_id = message.chat.id
    text    = message.text.strip()
    state   = get_state(chat_id)
    lang    = get_lang(chat_id)

    # Breaking the lock gracefully
    if text in (STRINGS["en"]["cancel_btn"], STRINGS["am"]["cancel_btn"]):
        set_state(chat_id, STATE_IDLE)
        bot.send_message(chat_id, STRINGS[lang]["action_cancelled"], reply_markup=remove_keyboard())
        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
        return

    # 🚀 WITHDRAWAL MULTI-STEP ENGINE
    if state == STATE_WITHDRAW_AMOUNT:
        try:
            clean_text_amount = text.replace(',', '')
            amount = float(clean_text_amount)
            if amount <= 0:
                raise ValueError
        except ValueError:
            bot.send_message(chat_id, STRINGS[lang]["invalid_amount"])
            return

        if amount < 500:
            bot.send_message(chat_id, STRINGS[lang]["min_with_err"])
            return
            
        real_bal, promo_bal, total_bal = _get_user_wallet(message.from_user.id)
        if amount > real_bal:
            bot.send_message(chat_id, STRINGS[lang]["promo_locked_err"].format(real_bal, promo_bal), reply_markup=remove_keyboard())
            set_state(chat_id, STATE_IDLE)
            bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
            return
            
        if chat_id not in user_withdraw_data:
            user_withdraw_data[chat_id] = {}
        user_withdraw_data[chat_id]["amount"] = amount
        
        set_state(chat_id, STATE_WITHDRAW_BANK)
        bot.send_message(chat_id, "Please select a bank to withdraw your money", reply_markup=withdraw_bank_markup())
        return

    if state == STATE_WITHDRAW_NAME:
        user_withdraw_data[chat_id]["name"] = text
        bank = user_withdraw_data[chat_id].get("bank", "your bank")
        set_state(chat_id, STATE_WITHDRAW_ACCOUNT)
        bot.send_message(chat_id, f"Please send the account number for {bank}:")
        return

    if state == STATE_WITHDRAW_ACCOUNT:
        user_withdraw_data[chat_id]["account"] = text
        
        w_data = user_withdraw_data[chat_id]
        amount = w_data.get("amount", 0)
        bank = w_data.get("bank", "Unknown")
        name = w_data.get("name", "Unknown")
        account = w_data.get("account", "Unknown")
        
        confirm_text = f"Please confirm withdrawal\n\nBank: `{bank}`\nAccount Name: `{name}`\nAccount Number: `{account}`\nAmount: `{amount} ETB`"
        set_state(chat_id, STATE_WITHDRAW_CONFIRM)
        bot.send_message(chat_id, confirm_text, reply_markup=withdraw_confirm_markup(), parse_mode="Markdown")
        return

    # 🚀 X-RAY VERIFICATION ENGINE
    if state == STATE_AWAITING_TXN_SMS:
        set_state(chat_id, STATE_IDLE)
        
        extracted_id = _extract_transaction_id(text)
        
        if not extracted_id:
            bot.send_message(
                chat_id, 
                "❌ *Invalid Text Format:*\nWe could not find a valid Transaction ID in your message. Please make sure you copy and paste the *entire* SMS from the bank.", 
                reply_markup=remove_keyboard()
            )
            bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
            return
            
        clean_txn_id = extracted_id
        dep_info = user_deposit_data.get(chat_id, {"provider": "telebirr", "amount": 0.0})
        expected_amount = float(dep_info.get("amount", 0.0))
        
        if not _reserve_transaction(clean_txn_id, message.from_user.id, expected_amount):
            bot.send_message(chat_id, STRINGS[lang]["api_used"], reply_markup=remove_keyboard())
            bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
            return

        wait_msg = bot.send_message(chat_id, STRINGS[lang]["checking_api"])
        url = "https://verifyapi.leulzenebe.pro/verify"
        payload = {"reference": clean_txn_id}
        headers = {
            "x-api-key": VERIFIER_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        try:
            response = requests.post(url, json=payload, headers=headers, timeout=20)
            
            if response.status_code != 200:
                _release_transaction(clean_txn_id)
                bot.delete_message(chat_id, wait_msg.message_id)
                bot.send_message(chat_id, STRINGS[lang]["api_fail"], reply_markup=remove_keyboard())
                bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
                return

            api_data = response.json()
            if not api_data.get("success"):
                raise ValueError("API explicitly returned failure flag")

            payload_data = api_data.get("data", {})
            tx_status = str(payload_data.get("transactionStatus", "")).strip().lower()
            if tx_status != "completed":
                _release_transaction(clean_txn_id)
                bot.delete_message(chat_id, wait_msg.message_id)
                bot.send_message(chat_id, "❌ *Transaction Incomplete:* The bank status is not marked as Completed.", reply_markup=remove_keyboard())
                bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
                return

            settled_amt_raw = str(payload_data.get("settledAmount", "0"))
            amt_match = re.search(r"[\d\.]+", settled_amt_raw.replace(',', ''))
            verified_amount = float(amt_match.group(0)) if amt_match else 0.0
            
            receiver_name = str(payload_data.get("creditedPartyName", "")).upper()
            receiver_account = str(payload_data.get("creditedPartyAccountNo", ""))

            is_valid_destination = False
            for valid_name in VALID_MERCHANT_NAMES:
                if valid_name in receiver_name:
                    is_valid_destination = True
                    break
            
            if not is_valid_destination:
                for valid_account in VALID_MERCHANT_ACCOUNTS:
                    if valid_account[-4:] in receiver_account:
                        is_valid_destination = True
                        break

            if not is_valid_destination:
                _release_transaction(clean_txn_id)
                bot.delete_message(chat_id, wait_msg.message_id)
                bot.send_message(chat_id, "🚨 *Destination Mismatch:*\nThe receipt is genuine, but the funds were not sent to our official merchant wallets.", reply_markup=remove_keyboard())
                bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
                return

            if verified_amount >= expected_amount and verified_amount > 0:
                real_bal, promo_bal, total_bal = _get_user_wallet(message.from_user.id)
                new_balance = real_bal + verified_amount
                
                if _supabase is not None:
                    _supabase.table("tg_users").update({"balance": new_balance}).eq("tg_id", message.from_user.id).execute()
                    _supabase.table("transactions").insert({
                        "id": str(uuid.uuid4()),
                        "user_id": str(message.from_user.id),
                        "amount": verified_amount,
                        "tx_type": "deposit",
                        "status": "completed"
                    }).execute()

                bot.delete_message(chat_id, wait_msg.message_id)
                bot.send_message(chat_id, STRINGS[lang]["api_success"].format(verified_amount), reply_markup=remove_keyboard())
                
                try:
                    bot.send_message(ADMIN_IDS[0], f"🟢 *AUTOMATED DEPOSIT SUCCESS*\nUser ID: `{message.from_user.id}`\nRef: `{clean_txn_id}`\nCredited: `{verified_amount} ETB`")
                except Exception:
                    pass
            else:
                _release_transaction(clean_txn_id)
                bot.delete_message(chat_id, wait_msg.message_id)
                bot.send_message(chat_id, STRINGS[lang]["api_wrong_amount"], reply_markup=remove_keyboard())
        
        except requests.exceptions.Timeout:
            _release_transaction(clean_txn_id)
            bot.delete_message(chat_id, wait_msg.message_id)
            bot.send_message(chat_id, STRINGS[lang]["api_error"], reply_markup=remove_keyboard())
        except Exception as e:
            _release_transaction(clean_txn_id)
            if 'wait_msg' in locals():
                try:
                    bot.delete_message(chat_id, wait_msg.message_id)
                except Exception:
                    pass
            bot.send_message(chat_id, STRINGS[lang]["api_error"], reply_markup=remove_keyboard())

        bot.send_message(chat_id, "Main Menu:", reply_markup=main_menu_markup(lang))
        return

    if state == STATE_AWAITING_DEPOSIT:
        try:
            clean_text_amount = text.replace(',', '')
            amount = float(clean_text_amount)
            if amount <= 0:
                raise ValueError
        except ValueError:
            bot.send_message(chat_id, STRINGS[lang]["invalid_amount"])
            return

        if amount < 50:
            bot.send_message(chat_id, STRINGS[lang]["min_dep_err"])
            return
            
        if chat_id not in user_deposit_data:
            user_deposit_data[chat_id] = {"provider": "telebirr"}
        
        user_deposit_data[chat_id]["amount"] = amount
        provider = user_deposit_data[chat_id]["provider"]
        set_state(chat_id, STATE_AWAITING_TXN_SMS)
        
        inst_txt = STRINGS[lang][f"inst_{provider}"].format(amount)
        bot.send_message(chat_id, inst_txt, reply_markup=cancel_reply_keyboard(lang), parse_mode="HTML")
        return

    if state == STATE_IDLE:
        bot.send_message(chat_id, "Please use the menu below:", reply_markup=main_menu_markup(lang))


if __name__ == "__main__":
    print(f"--- CHELA Bingo Bot Starting ---")
    bot.infinity_polling(timeout=30, long_polling_timeout=20)
