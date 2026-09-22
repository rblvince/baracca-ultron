#!/bin/bash
# Starts La Baracca di Ultron: the local server (if not already running), the
# page in Chrome, and a terminal Ultron session — both open together.
cd "$(dirname "$0")"
AGENT_HOME="$(cd .. && pwd)"

if ! lsof -i :8795 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 server.py > /tmp/ultron_farm.log 2>&1 &
  sleep 1
fi

open -a "Google Chrome" "http://127.0.0.1:8795/baracca.html"

osascript -e "tell application \"Terminal\" to do script \"cd '$AGENT_HOME' && claude --channels plugin:discord@claude-plugins-official\"" >/dev/null
