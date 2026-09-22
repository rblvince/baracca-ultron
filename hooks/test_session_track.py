#!/usr/bin/env python3
# farm/hooks/test_session_track.py
"""Controllo rapido di session_track.py: python3 test_session_track.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_track as st


def test_update_session_calls_supabase_upsert():
    import supabase_client
    calls = []
    old_upsert = supabase_client.upsert
    supabase_client.upsert = lambda table, row, on_conflict=None: calls.append((table, row, on_conflict)) or 200
    old_cfg = supabase_client.load_config
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "test-user"}
    tmp_dir = tempfile.mkdtemp()
    old_sessions_path = st.SESSIONS_PATH
    st.SESSIONS_PATH = os.path.join(tmp_dir, "sessions.json")
    try:
        st.update_session("/path/to/transcript.jsonl", status="thinking", room="prod")
        assert len(calls) == 1, calls
        table, row, on_conflict = calls[0]
        assert table == "sessions", table
        assert row["transcript_path"] == "/path/to/transcript.jsonl", row
        assert row["status"] == "thinking" and row["room"] == "prod", row
        assert row["user_id"] == "test-user", row
        assert on_conflict == "user_id,transcript_path", on_conflict
    finally:
        supabase_client.upsert = old_upsert
        supabase_client.load_config = old_cfg
        st.SESSIONS_PATH = old_sessions_path


def test_update_session_without_key_does_nothing():
    import supabase_client
    calls = []
    old_upsert = supabase_client.upsert
    supabase_client.upsert = lambda *a, **k: calls.append(1) or 200
    try:
        st.update_session(None, status="idle")
        assert calls == [], calls
    finally:
        supabase_client.upsert = old_upsert


def main():
    test_update_session_calls_supabase_upsert()
    test_update_session_without_key_does_nothing()
    print("session_track.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
