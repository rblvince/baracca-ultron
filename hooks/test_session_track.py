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


def test_spawn_subagent_calls_supabase_insert():
    import supabase_client
    calls = []
    old_insert = supabase_client.insert
    supabase_client.insert = lambda table, row: calls.append((table, row)) or 201
    old_cfg = supabase_client.load_config
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "test-user"}
    tmp_dir = tempfile.mkdtemp()
    old_path = st.SUBAGENTS_PATH
    st.SUBAGENTS_PATH = os.path.join(tmp_dir, "subagents.json")
    try:
        st.spawn_subagent("qa", "qualita-1", "run tests")
        assert len(calls) == 1, calls
        table, row = calls[0]
        assert table == "subagents", table
        assert row["room"] == "qa" and row["agent"] == "qualita-1", row
        assert row["user_id"] == "test-user", row
    finally:
        supabase_client.insert = old_insert
        supabase_client.load_config = old_cfg
        st.SUBAGENTS_PATH = old_path


def _with_patch_oldest(returns):
    """Sostituisce patch_oldest con un finto che registra le chiamate e
    restituisce, in ordine, i valori di `returns`. Ritorna (calls, restore)."""
    import supabase_client
    calls = []
    it = iter(returns)
    old_patch, old_cfg = supabase_client.patch_oldest, supabase_client.load_config
    supabase_client.patch_oldest = lambda table, filters, nulls, values: calls.append((table, filters, nulls, values)) or next(it)
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "u1"}
    tmp_dir = tempfile.mkdtemp()
    old_path = st.SUBAGENTS_PATH
    st.SUBAGENTS_PATH = os.path.join(tmp_dir, "subagents.json")

    def restore():
        supabase_client.patch_oldest, supabase_client.load_config = old_patch, old_cfg
        st.SUBAGENTS_PATH = old_path
    return calls, restore


def test_reap_subagent_closes_by_agent_id():
    calls, restore = _with_patch_oldest([204])
    try:
        st.reap_subagent("ag-2")
        assert len(calls) == 1, calls
        table, filters, nulls, values = calls[0]
        assert table == "subagents", table
        assert filters == {"user_id": "u1", "agent_id": "ag-2"}, filters
        assert nulls == ["finished_at"], nulls
        assert set(values) == {"finished_at"} and values["finished_at"].endswith("+00:00"), values
    finally:
        restore()


def test_reap_subagent_falls_back_to_fifo():
    calls, restore = _with_patch_oldest([None, 204])
    try:
        st.reap_subagent("ag-sconosciuto")
        assert len(calls) == 2, calls
        assert calls[1][1] == {"user_id": "u1"} and calls[1][2] == ["finished_at"], calls
    finally:
        restore()


def test_reap_subagent_without_id_is_fifo():
    calls, restore = _with_patch_oldest([204])
    try:
        st.reap_subagent()
        assert len(calls) == 1 and calls[0][1] == {"user_id": "u1"}, calls
    finally:
        restore()


def test_claim_subagent_sets_agent_id_on_oldest_unclaimed():
    calls, restore = _with_patch_oldest([204])
    try:
        st.claim_subagent("ag-1")
        assert calls == [("subagents", {"user_id": "u1"}, ["agent_id", "finished_at"], {"agent_id": "ag-1"})], calls
    finally:
        restore()


def test_claim_subagent_without_id_does_nothing():
    calls, restore = _with_patch_oldest([])
    try:
        st.claim_subagent(None)
        assert calls == [], calls
    finally:
        restore()


def test_update_session_survives_broken_load_config():
    """load_config() non deve MAI far saltare l'hook: se esplode comunque,
    la scrittura locale deve essere già andata a buon fine e update_session()
    deve tornare normalmente."""
    import json
    import supabase_client
    old_cfg = supabase_client.load_config

    def boom():
        raise RuntimeError("config marcia")

    supabase_client.load_config = boom
    tmp_dir = tempfile.mkdtemp()
    old_sessions_path = st.SESSIONS_PATH
    st.SESSIONS_PATH = os.path.join(tmp_dir, "sessions.json")
    try:
        st.update_session("/path/t.jsonl", status="writing", room="prod")
        with open(st.SESSIONS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        assert data["/path/t.jsonl"]["status"] == "writing", data
        assert data["/path/t.jsonl"]["room"] == "prod", data
    finally:
        supabase_client.load_config = old_cfg
        st.SESSIONS_PATH = old_sessions_path


def main():
    test_update_session_calls_supabase_upsert()
    test_update_session_survives_broken_load_config()
    test_update_session_without_key_does_nothing()
    test_spawn_subagent_calls_supabase_insert()
    test_reap_subagent_closes_by_agent_id()
    test_reap_subagent_falls_back_to_fifo()
    test_reap_subagent_without_id_is_fifo()
    test_claim_subagent_sets_agent_id_on_oldest_unclaimed()
    test_claim_subagent_without_id_does_nothing()
    print("session_track.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
