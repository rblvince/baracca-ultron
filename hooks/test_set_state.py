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


def _run(argv, stdin):
    sent = []
    tmp = tempfile.mktemp()
    b, st = set_state.barracks, set_state.session_track
    old = (b.STATE_PATH, b.sync, st.update_session, sys.argv, sys.stdin)
    b.STATE_PATH = tmp
    b.sync = lambda *a: sent.append(a)
    st.update_session = lambda key, **k: dict(k, transcript_path=key) if key else None
    sys.argv, sys.stdin = argv, io.StringIO(stdin)
    try:
        set_state.main()
    finally:
        b.STATE_PATH, b.sync, st.update_session, sys.argv, sys.stdin = old
    with open(tmp, encoding="utf-8") as f:
        local = json.load(f)
    os.remove(tmp)
    return local, sent


def test_status_is_a_fresh_snapshot_sent_with_the_session():
    local, sent = _run(["set_state.py", "waiting"], '{"transcript_path": "/t"}')
    assert set(local) == {"status", "ts"} and local["status"] == "waiting", local
    assert sent == [(local, {"status": "waiting", "transcript_path": "/t"})], sent


def test_without_stdin_still_writes_and_syncs_the_state():
    local, sent = _run(["set_state.py", "idle"], "")
    assert local["status"] == "idle", local
    assert sent == [(local, None)], sent


def main():
    test_status_is_a_fresh_snapshot_sent_with_the_session()
    test_without_stdin_still_writes_and_syncs_the_state()
    print("set_state.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
