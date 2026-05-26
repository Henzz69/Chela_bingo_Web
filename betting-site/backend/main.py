import subprocess
import sys
from pathlib import Path

print("🚀 Starting CHELA Bingo Infrastructure...")

# 1. Hunt for the Engine automatically EVERYWHERE
engine_path = None
for path in Path('.').rglob('bingo_caller.py'):
    engine_path = str(path)
    break

if not engine_path:
    print("❌ FATAL: Could not find bingo_caller.py ANYWHERE in the project directory!")
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