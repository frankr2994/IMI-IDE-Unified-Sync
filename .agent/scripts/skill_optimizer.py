import os
import json
import time
import sys
from pathlib import Path

# --- CONFIGURATION ---
HOME_DIR = str(Path.home())
STATE_PATH = os.path.join(HOME_DIR, '.gemini', 'state.json')
DIRECTIVE_PATH = os.path.join(os.getcwd(), '.agent', 'directives.json')
TOKEN_LIMIT_FOR_OFFLOAD = 50000  # If session > 50k, suggest offloading
LATENCY_SENSITIVITY = 1.2 # 1.2x average = slow

# --- STATE TRACKING ---
last_token_count = 0
session_start_time = time.time()

def get_imi_state():
    try:
        with open(STATE_PATH, 'r') as f:
            return json.load(f)
    except Exception:
        return None

def send_directive(message, urgency='high', action='REFRESH_SKILLS'):
    directive = {
        "type": "OPTIMIZATION",
        "urgency": urgency,
        "message": message,
        "action": action,
        "timestamp": time.time()
    }
    with open(DIRECTIVE_PATH, 'w') as f:
        json.dump(directive, f, indent=2)
    print(f"[ASOS] Directive Sent: {message}")

def monitor_loop():
    global last_token_count
    print("🚀 ASOS Monitor (Autonomous Skill Optimization) ACTIVE")
    print(f"👀 Watching state: {STATE_PATH}")
    
    while True:
        state = get_imi_state()
        if state:
            current_tokens = state.get('tokenUsage', {}).get('gemini', 0)
            
            # 1. TOKEN BLOAT DETECTION
            if current_tokens - last_token_count > 10000:
                print(f"[ASOS] Significant token jump detected: {current_tokens - last_token_count}")
                send_directive(
                    message=f"Token consumption spiked by {current_tokens - last_token_count} in this session. Recommend 'Pruning Context' or moving this task to Jules Cloud.",
                    urgency="high"
                )
                last_token_count = current_tokens

            # 2. SATURATION DETECTION
            if current_tokens > TOKEN_LIMIT_FOR_OFFLOAD:
                send_directive(
                    message="The active session has crossed 50k tokens. IMI recommends unloading 'heavy' skill files to preserve performance.",
                    urgency="critical",
                    action="PRUNE_SKILLS"
                )

        time.sleep(10)  # Check every 10 seconds

if __name__ == "__main__":
    try:
        monitor_loop()
    except KeyboardInterrupt:
        sys.exit(0)
