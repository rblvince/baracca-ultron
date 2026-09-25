#!/usr/bin/env python3
"""Scrive uno stato fisso: UserPromptSubmit (thinking), Notification (waiting),
Stop (idle), PreCompact (compacting) e SessionStart. Stessa scrittura atomica e
stesso invio a Supabase di barracks.py: istantanea fresca, le colonne non dette
vanno a null (altrimenti la pagina in Realtime rifarebbe camminata e luci
dell'evento prima a ogni thinking/idle), e senza la riga su agent_state l'avviso
Discord sul passaggio a waiting non scatterebbe.

La riga (line) dice alla Baracca chi deve muoversi:
  Notification  "permesso · Bash" se Claude chiede un permesso (il GUARDIANO),
                "attesa" se aspetta solo che tu scriva (MARCONI trasmette)
  PreCompact    "compatta · auto|manual" (lo SPAZZINO)
  SessionStart  "sessione aperta · startup|resume|clear" (il PORTINAIO); dopo una
                compattazione (source "compact") lo stato torna thinking con
                "contesto compattato": il turno continua

A Stop conta anche i token dell'ultima risposta: quella senza tool non passa
mai da PostToolUse, e senza questo ogni turno perdeva il suo messaggio finale.
Vanno al reparto dell'ultimo evento di quel terminale (laboratorio se non c'è)."""
import json
import re
import sys

import barracks
import session_track


def line_for(status, payload):
    """(status, line) dal payload dell'hook; line None se l'evento non ne ha una."""
    event = payload.get("hook_event_name") or payload.get("hookEventName") or ""
    if event == "SessionStart":
        source = str(payload.get("source") or "startup")
        if source == "compact":
            return "thinking", "contesto compattato"
        return "idle", "sessione aperta · " + source
    if event == "PreCompact" or status == "compacting":
        return "compacting", "compatta · " + str(payload.get("trigger") or "auto")
    if event == "Notification" or status == "waiting":
        kind = str(payload.get("notification_type") or "")
        msg = str(payload.get("message") or "")
        if kind == "permission_prompt" or "permission" in msg.lower():
            tool = re.search(r"permission to use (\S+)", msg)
            return "waiting", "permesso" + (" · " + tool.group(1).rstrip(".,") if tool else "")
        return "waiting", "attesa"
    return status, None


def main():
    status = sys.argv[1] if len(sys.argv) > 1 else "idle"
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    status, line = line_for(status, payload)
    state = barracks.write_state(status=status, line=line)
    transcript_path = payload.get("transcript_path")
    event = payload.get("hook_event_name") or payload.get("hookEventName") or ""
    delta = None
    if status == "idle" and transcript_path and event != "SessionStart":
        room = session_track.last_room(transcript_path) or "rs"
        _, delta = barracks.accumulate_tokens(room, transcript_path)
    barracks.sync(state, session_track.update_session(transcript_path, status=status), delta)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # un hook che esplode bloccherebbe la tool call reale
