#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill any existing bg-brain process on port 3336
lsof -ti:3336 | xargs kill 2>/dev/null

# Launch persistent background brain
nohup npx tsx "$SCRIPT_DIR/src/bg-brain.ts" > "$SCRIPT_DIR/bg-brain.log" 2>&1 &
echo "Background brain launched (PID: $!). Logs: $SCRIPT_DIR/bg-brain.log"
