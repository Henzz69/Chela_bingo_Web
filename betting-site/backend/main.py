import os
import sys
import subprocess
import time

print("🚀 Booting CHELA Bingo Infrastructure...")

# Force the script to run from the 'betting-site' directory so it can see both folders
if os.path.basename(os.getcwd()) == "backend":
    os.chdir("..")

print(f"📂 Running from Directory: {os.getcwd()}")

engine_path = "engine/bingo_caller.py"
bot_path = "backend/bot.py"

# 1. Start the Engine
if not os.path.exists(engine_path):
    print(f"❌ FATAL: Cannot find engine at {engine_path}")
else:
    print("✅ Engine found! Starting Bingo Caller...")
    engine_proc = subprocess.Popen([sys.executable, engine_path])

# 2. The Anti-Conflict Sleep (Fixes Error 409)
print("⏳ Waiting 10 seconds for old Railway containers to shut down before connecting to Telegram...")
time.sleep(10)

# 3. Start the Bot
if not os.path.exists(bot_path):
    print(f"❌ FATAL: Cannot find bot at {bot_path}")
else:
    print("🤖 Starting Telegram Bot...")
    bot_proc = subprocess.Popen([sys.executable, bot_path])

# 4. Keep alive
try:
    if 'engine_proc' in locals(): engine_proc.wait()
    if 'bot_proc' in locals(): bot_proc.wait()
except KeyboardInterrupt:
    if 'engine_proc' in locals(): engine_proc.terminate()
    if 'bot_proc' in locals(): bot_proc.terminate()