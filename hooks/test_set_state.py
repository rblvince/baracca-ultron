#!/usr/bin/env python3
"""Controllo rapido di set_state.py: python3 test_set_state.py"""
import io
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import set_state
import supabase_client

supabase_client.CONFIG_PATH = "/nonexistent/baracca/.env"   # cintura: mai il database vero


def _run(argv, stdin, counted=None, room=None):
    sent = []
    tmp = tempfile.mktemp()
    b, st = set_state.barracks, set_state.session_track
    old = (b.STATE_PATH, b.sync, b.accumulate_tokens, st.update_session, st.last_room, sys.argv, sys.stdin)
    b.STATE_PATH = tmp
    b.sync = lambda *a: sent.append(a)
    b.accumulate_tokens = lambda r, t: (counted.append((r, t)), (None, {"room": r}))[1] \
        if counted is not None else (None, None)
    st.update_session = lambda key, **k: dict(k, transcript_path=key) if key else None
    st.last_room = lambda key: room
    sys.argv, sys.stdin = argv, io.StringIO(stdin)
    try:
        set_state.main()
    finally:
        b.STATE_PATH, b.sync, b.accumulate_tokens, st.update_session, st.last_room, sys.argv, sys.stdin = old
    with open(tmp, encoding="utf-8") as f:
        local = json.load(f)
    os.remove(tmp)
    return local, sent


def test_status_is_a_fresh_snapshot_sent_with_the_session():
    local, sent = _run(["set_state.py", "waiting"], '{"transcript_path": "/t"}')
    assert set(local) == {"status", "ts"} and local["status"] == "waiting", local
    assert sent == [(local, {"status": "waiting", "transcript_path": "/t"}, None)], sent


def test_without_stdin_still_writes_and_syncs_the_state():
    local, sent = _run(["set_state.py", "idle"], "")
    assert local["status"] == "idle", local
    assert sent == [(local, None, None)], sent


def test_stop_counts_the_final_reply_in_the_last_room():
    counted = []
    local, sent = _run(["set_state.py", "idle"], '{"transcript_path": "/t"}', counted, room="qa")
    assert counted == [("qa", "/t")], counted
    assert sent[0][2] == {"room": "qa"}, sent
    # senza un reparto noto per quel terminale: laboratorio
    counted = []
    _run(["set_state.py", "idle"], '{"transcript_path": "/t"}', counted, room=None)
    assert counted == [("rs", "/t")], counted


def test_only_stop_counts_tokens():
    counted = []
    for status in ("thinking", "waiting"):
        _run(["set_state.py", status], '{"transcript_path": "/t"}', counted, room="qa")
    assert counted == [], counted


def main():
    test_status_is_a_fresh_snapshot_sent_with_the_session()
    test_without_stdin_still_writes_and_syncs_the_state()
    test_stop_counts_the_final_reply_in_the_last_room()
    test_only_stop_counts_tokens()
    print("set_state.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
