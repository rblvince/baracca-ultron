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


def main():
    test_classify_bash_qa()
    test_classify_task_matches_spawn_helper()
    test_accumulate_tokens_dedup()
    print("barracks.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
