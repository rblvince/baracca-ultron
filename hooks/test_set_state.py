#!/usr/bin/env python3
"""Controllo rapido di set_state.py: python3 test_set_state.py"""
import io
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import set_state


def test_status_goes_to_agent_state_as_fresh_row():
    sent = []
    tmp = tempfile.mktemp()
    old = (set_state.STATE_PATH, set_state.supabase_client.load_config,
           set_state.supabase_client.upsert, set_state.session_track.update_session,
           sys.argv, sys.stdin)
    set_state.STATE_PATH = tmp
    set_state.supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "u-1"}
    set_state.supabase_client.upsert = lambda t, row, on_conflict=None: sent.append((t, row, on_conflict))
    set_state.session_track.update_session = lambda *a, **k: None
    sys.argv = ["set_state.py", "waiting"]
    sys.stdin = io.StringIO("{}")
    try:
        set_state.main()
    finally:
        (set_state.STATE_PATH, set_state.supabase_client.load_config,
         set_state.supabase_client.upsert, set_state.session_track.update_session,
         sys.argv, sys.stdin) = old
    with open(tmp, encoding="utf-8") as f:
        local = json.load(f)
    os.remove(tmp)
    assert local["status"] == "waiting", local
    assert len(sent) == 1, sent
    table, row, conflict = sent[0]
    assert table == "agent_state" and conflict == "user_id", sent
    assert row["user_id"] == "u-1" and row["status"] == "waiting" and row["ts"] == local["ts"], row
    # riga fresca: niente reparto/tool/nota dell'evento precedente
    assert all(row[k] is None for k in ("room", "node", "agent", "task", "tool", "line", "area", "tokens")), row


def test_no_config_no_supabase_call():
    sent = []
    tmp = tempfile.mktemp()
    old = (set_state.STATE_PATH, set_state.supabase_client.load_config,
           set_state.supabase_client.upsert, set_state.session_track.update_session,
           sys.argv, sys.stdin)
    set_state.STATE_PATH = tmp
    set_state.supabase_client.load_config = lambda: {}
    set_state.supabase_client.upsert = lambda *a, **k: sent.append(a)
    set_state.session_track.update_session = lambda *a, **k: None
    sys.argv = ["set_state.py", "idle"]
    sys.stdin = io.StringIO("")
    try:
        set_state.main()
    finally:
        (set_state.STATE_PATH, set_state.supabase_client.load_config,
         set_state.supabase_client.upsert, set_state.session_track.update_session,
         sys.argv, sys.stdin) = old
    os.remove(tmp)
    assert sent == [], sent


def main():
    test_status_goes_to_agent_state_as_fresh_row()
    test_no_config_no_supabase_call()
    print("set_state.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
