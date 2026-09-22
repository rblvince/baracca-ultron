#!/usr/bin/env python3
"""Controllo rapido di barracks.py: python3 test_barracks.py"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import barracks as b


def test_classify_bash_qa():
    status, room, node, agent, task = b.classify({"tool_name": "Bash", "tool_input": {"command": "npm test"}})
    assert (status, room, agent) == ("thinking", "qa", "qualita-1"), (status, room, agent)


def test_classify_task_matches_spawn_helper():
    status, room, node, agent, task = b.classify({"tool_name": "Task", "tool_input": {"subagent_type": "qualita"}})
    room2, agent2, task2 = b.subagent_room_agent_task({"subagent_type": "qualita"})
    assert (room, agent) == (room2, agent2) == ("qa", "qualita-1"), (room, agent, room2, agent2)


def test_accumulate_tokens_dedup():
    tmp_dir = tempfile.mkdtemp()
    transcript = os.path.join(tmp_dir, "t.jsonl")
    entry = {"type": "assistant", "uuid": "abc", "message": {"usage": {
        "input_tokens": 10, "output_tokens": 5,
        "cache_read_input_tokens": 1, "cache_creation_input_tokens": 2}}}
    with open(transcript, "w", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    old_tokens_path = b.TOKENS_PATH
    b.TOKENS_PATH = os.path.join(tmp_dir, "tokens.json")
    try:
        first = b.accumulate_tokens("prod", transcript)
        assert first["prod"] == {"in": 10, "out": 5, "cread": 1, "cwrite": 2}, first
        second = b.accumulate_tokens("prod", transcript)
        assert second["prod"] == {"in": 10, "out": 5, "cread": 1, "cwrite": 2}, "il dedup non ha funzionato: " + str(second)
    finally:
        b.TOKENS_PATH = old_tokens_path


def test_write_state_calls_supabase_upsert():
    import supabase_client
    calls = []
    old_upsert = supabase_client.upsert
    supabase_client.upsert = lambda table, row, on_conflict=None: calls.append((table, row, on_conflict)) or 200
    old_cfg = supabase_client.load_config
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "test-user"}
    tmp_dir = tempfile.mkdtemp()
    old_state_path = b.STATE_PATH
    b.STATE_PATH = os.path.join(tmp_dir, "state.json")
    try:
        b.write_state(status="thinking", room="qa")
        assert len(calls) == 1, calls
        table, row, on_conflict = calls[0]
        assert table == "agent_state", table
        assert row["status"] == "thinking" and row["room"] == "qa", row
        assert row["user_id"] == "test-user", row
        assert on_conflict == "user_id", on_conflict
        # la scrittura locale resta la fonte di verità: Supabase è in più, non al posto
        assert os.path.exists(b.STATE_PATH), b.STATE_PATH
        with open(b.STATE_PATH, encoding="utf-8") as f:
            local = json.load(f)
        assert local["status"] == "thinking" and local["room"] == "qa", local
    finally:
        supabase_client.upsert = old_upsert
        supabase_client.load_config = old_cfg
        b.STATE_PATH = old_state_path


def test_accumulate_tokens_calls_rpc_with_deltas():
    import supabase_client
    calls = []
    old_rpc = supabase_client.rpc
    supabase_client.rpc = lambda fn, params: calls.append((fn, params)) or 200
    old_cfg = supabase_client.load_config
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "test-user"}
    tmp_dir = tempfile.mkdtemp()
    transcript = os.path.join(tmp_dir, "t.jsonl")
    entry = {"type": "assistant", "uuid": "xyz", "message": {"usage": {
        "input_tokens": 3, "output_tokens": 7,
        "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}
    with open(transcript, "w", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    old_tokens_path = b.TOKENS_PATH
    b.TOKENS_PATH = os.path.join(tmp_dir, "tokens.json")
    try:
        b.accumulate_tokens("qa", transcript)
        assert len(calls) == 1, calls
        fn, params = calls[0]
        assert fn == "increment_token_usage", fn
        assert params["p_room"] == "qa", params
        assert params["p_input"] == 3 and params["p_output"] == 7, params
        assert params["p_user_id"] == "test-user", params
        assert "p_day" in params, params
    finally:
        supabase_client.rpc = old_rpc
        supabase_client.load_config = old_cfg
        b.TOKENS_PATH = old_tokens_path


def main():
    test_classify_bash_qa()
    test_classify_task_matches_spawn_helper()
    test_accumulate_tokens_dedup()
    test_write_state_calls_supabase_upsert()
    test_accumulate_tokens_calls_rpc_with_deltas()
    print("barracks.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
