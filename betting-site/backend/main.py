import os
import subprocess
import sys

print("🚀 Starting CHELA Bingo Infrastructure...")

# 1. Hunt for the Engine automatically
engine_path = "engine/bingo_caller.py"
if not os.path.exists(engine_path):
    engine_path = "../engine/bingo_caller.py" # Look one folder up

if not os.path.exists(engine_path):
    print("❌ FATAL: Could not find bingo_caller.py in ./engine or ../engine!")
else:
    print(f"✅ Found Engine at: {engine_path}")
    engine_process = subprocess.Popen([sys.executable, engine_path])

# 2. Start the Bot
bot_process = subprocess.Popen([sys.executable, "bot.py"])

# 3. Keep the server alive
try:
    if 'engine_process' in locals(): engine_process.wait()
    bot_process.wait()
except KeyboardInterrupt:
    if 'engine_process' in locals(): engine_process.terminate()
    bot_process.terminate()