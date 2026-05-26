import subprocess
import sys

print("🚀 Starting CHELA Bingo Infrastructure...")

# Start the Engine in the background
engine_process = subprocess.Popen([sys.executable, "engine/bingo_caller.py"])

# Start the Bot in the foreground
bot_process = subprocess.Popen([sys.executable, "bot.py"])

# Keep the main thread alive
try:
    engine_process.wait()
    bot_process.wait()
except KeyboardInterrupt:
    engine_process.terminate()
    bot_process.terminate()