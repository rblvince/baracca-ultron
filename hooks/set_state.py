#!/usr/bin/env python3
"""Writes a fixed status to the farm's state file. Used by UserPromptSubmit (thinking),
Notification (waiting) and Stop (idle) hooks."""
import json
import sys
import time
import os

import barracks
import session_track
import supabase_client

STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "state", "state.json")

def main():
    status = sys.argv[1] if len(sys.argv) > 1 else "idle"
    data = {"status": status, "area": None, "ts": int(time.time() * 1000)}
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except OSError:
        pass
    # anche su Supabase: senza questo thinking/waiting/idle non arrivano mai in
    # agent_state, la pagina in Realtime non vede "pensa"/"aspetta" e un avviso
    # sul passaggio a waiting non scatterebbe. Riga "fresca" come il file
    # locale: le colonne non dette vanno a null, altrimenti il merge di
    # PostgREST terrebbe room/tool/node dell'evento prima e la pagina
    # rifarebbe camminata e luci a ogni thinking/idle.
    try:
        user_id = supabase_client.load_config().get("SUPABASE_USER_ID")
        if user_id:
            row = {k: None for k in barracks.AGENT_STATE_COLUMNS}
            row.update(user_id=user_id, status=status, ts=data["ts"])
            supabase_client.upsert("agent_state", row, on_conflict="user_id")
    except Exception:
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
