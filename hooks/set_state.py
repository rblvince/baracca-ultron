#!/usr/bin/env python3
"""Scrive uno stato fisso: UserPromptSubmit (thinking), Notification (waiting)
e Stop (idle). Stessa scrittura atomica e stesso invio a Supabase di
barracks.py: istantanea fresca, le colonne non dette vanno a null (altrimenti
la pagina in Realtime rifarebbe camminata e luci dell'evento prima a ogni
thinking/idle), e senza la riga su agent_state l'avviso Discord sul passaggio
a waiting non scatterebbe."""
import json
import sys

import barracks
import session_track


def main():
    status = sys.argv[1] if len(sys.argv) > 1 else "idle"
    state = barracks.write_state(status=status)
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        payload = {}
    barracks.sync(state, session_track.update_session(payload.get("transcript_path"), status=status))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # un hook che esplode bloccherebbe la tool call reale
