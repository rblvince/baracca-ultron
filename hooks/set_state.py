#!/usr/bin/env python3
"""Writes a fixed status to the farm's state file. Used by UserPromptSubmit (thinking),
Notification (waiting) and Stop (idle) hooks."""
import json
import sys
import time
import os

import session_track

STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "state", "state.json")

def main():
    status = sys.argv[1] if len(sys.argv) > 1 else "idle"
    data = {"status": status, "area": None, "ts": int(time.time() * 1000)}
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass

    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        payload = {}
    session_track.update_session(payload.get("transcript_path"), status=status)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # un hook che esplode bloccherebbe la tool call reale
