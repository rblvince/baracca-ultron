#!/usr/bin/env python3
"""Controllo rapido di barracks.py: python3 test_barracks.py"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import barracks as b
import supabase_client

# cintura: nessun test arriva mai al database vero (config inesistente) né
# lancia processi figli; chi vuole vedere l'invio rimette in_background.
supabase_client.CONFIG_PATH = "/nonexistent/baracca/.env"
REAL_IN_BACKGROUND = b.in_background
b.in_background = lambda job: None


def test_classify_bash_qa():
    status, room, node, agent, task = b.classify({"tool_name": "Bash", "tool_input": {"command": "npm test"}})
    assert (status, room, agent) == ("thinking", "qa", "qualita-1"), (status, room, agent)


def test_classify_lsp_and_review_skill_are_qa():
    for payload in ({"tool_name": "LSP", "tool_input": {"operation": "documentSymbol"}},
                    {"tool_name": "Skill", "tool_input": {"skill": "code-review"}}):
        status, room, node, agent, task = b.classify(payload)
        assert (room, agent) == ("qa", "qualita-1"), (payload, room, agent)
    # una skill qualunque resta nel laboratorio
    assert b.classify({"tool_name": "Skill", "tool_input": {"skill": "gsap"}})[1] == "rs"


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
        first, delta = b.accumulate_tokens("prod", transcript)
        assert first["prod"] == {"in": 10, "out": 5, "cread": 1, "cwrite": 2}, first
        assert delta["input"] == 10 and delta["output"] == 5, delta
        second, delta2 = b.accumulate_tokens("prod", transcript)
        assert second["prod"] == {"in": 10, "out": 5, "cread": 1, "cwrite": 2}, "il dedup non ha funzionato: " + str(second)
        assert delta2 is None, "turno già contato: niente da mandare a Supabase"
    finally:
        b.TOKENS_PATH = old_tokens_path


def test_write_state_is_local_and_returns_the_snapshot():
    tmp_dir = tempfile.mkdtemp()
    old_state_path = b.STATE_PATH
    b.STATE_PATH = os.path.join(tmp_dir, "state.json")
    try:
        state = b.write_state(status="thinking", room="qa", node=None)
        with open(b.STATE_PATH, encoding="utf-8") as f:
            assert json.load(f) == state, state
        assert state["status"] == "thinking" and state["room"] == "qa" and "node" not in state, state
    finally:
        b.STATE_PATH = old_state_path


def test_sync_sends_one_record_event():
    """Stato, sessione e token in UNA chiamata (migrazione 008), dal figlio."""
    calls = []
    old = (b.in_background, supabase_client.load_config, supabase_client.record_event)
    b.in_background = lambda job: job()
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "test-user"}
    supabase_client.record_event = lambda *a: calls.append(a)
    try:
        b.sync({"status": "writing", "ts": 1}, {"transcript_path": "/t", "ts": 1}, {"room": "prod"})
        assert calls == [("test-user", {"status": "writing", "ts": 1}, {"transcript_path": "/t", "ts": 1}, {"room": "prod"})], calls
        supabase_client.load_config = lambda: {}
        b.sync({"status": "idle", "ts": 2})
        assert len(calls) == 1, "senza utente configurato non parte niente"
    finally:
        b.in_background, supabase_client.load_config, supabase_client.record_event = old


def test_in_background_returns_before_the_job_ends():
    """Il padre torna subito anche se il lavoro di rete è lento: Claude Code aspetta solo lui."""
    import time
    mark = os.path.join(tempfile.mkdtemp(), "fatto")
    def job():
        time.sleep(0.5)
        open(mark, "w").close()
    t0 = time.time()
    REAL_IN_BACKGROUND(job)
    assert time.time() - t0 < 0.3, "il padre ha aspettato il figlio"
    for _ in range(50):
        if os.path.exists(mark):
            break
        time.sleep(0.05)
    assert os.path.exists(mark), "il figlio non ha finito il lavoro"


def test_accumulate_tokens_delta_for_supabase():
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
        _, delta = b.accumulate_tokens("qa", transcript)
        assert delta["room"] == "qa" and delta["input"] == 3 and delta["output"] == 7, delta
        assert len(delta["day"]) == 10, delta
    finally:
        b.TOKENS_PATH = old_tokens_path


def test_last_assistant_usage_reads_from_the_tail():
    """Coda a pezzi: trova l'ultimo turno anche se è prima di una riga enorme
    (un tool_result grosso) e anche con il primo pezzo tagliato a metà riga."""
    tmp_dir = tempfile.mkdtemp()
    transcript = os.path.join(tmp_dir, "t.jsonl")
    old = {"type": "assistant", "uuid": "vecchio", "message": {"usage": {"output_tokens": 1}}}
    new = {"type": "assistant", "uuid": "nuovo", "message": {"model": "m", "usage": {"output_tokens": 2}}}
    big = {"type": "user", "message": {"content": "x" * 5000}}
    with open(transcript, "w", encoding="utf-8") as f:
        for e in (old, big, new, big, {"type": "user"}):
            f.write(json.dumps(e) + "\n")
    uuid, usage, model = b.last_assistant_usage(transcript, chunk=1000)
    assert (uuid, usage, model) == ("nuovo", {"output_tokens": 2}, "m"), (uuid, usage, model)
    assert b.last_assistant_usage(os.path.join(tmp_dir, "manca.jsonl")) == (None, None, None)
    assert b.last_assistant_usage(None) == (None, None, None)


def test_classify_agent_tool_same_as_task():
    old = b.classify({"tool_name": "Task", "tool_input": {"subagent_type": "qualita"}})
    new = b.classify({"tool_name": "Agent", "tool_input": {"subagent_type": "qualita"}})
    assert old == new, (old, new)


def _run_main(payload):
    import io
    old_stdin, old_argv = sys.stdin, sys.argv
    sys.stdin = io.StringIO(json.dumps(payload))
    sys.argv = ["barracks.py"]
    try:
        b.main()
    finally:
        sys.stdin, sys.argv = old_stdin, old_argv


def test_main_subagent_start_claims_agent_id():
    import session_track
    calls = []
    old = session_track.claim_subagent
    session_track.claim_subagent = lambda agent_id: calls.append(agent_id)
    try:
        _run_main({"hook_event_name": "SubagentStart", "agent_id": "ag-1", "agent_type": "Explore"})
        assert calls == ["ag-1"], calls
    finally:
        session_track.claim_subagent = old


def test_main_subagent_stop_reaps_by_agent_id():
    import session_track
    calls = []
    old_reap, old_upd, old_write = session_track.reap_subagent, session_track.update_session, b.write_state
    session_track.reap_subagent = lambda agent_id=None: calls.append(agent_id)
    session_track.update_session = lambda *a, **k: None
    b.write_state = lambda **k: None
    try:
        _run_main({"hook_event_name": "SubagentStop", "agent_id": "ag-1"})
        assert calls == ["ag-1"], calls
    finally:
        session_track.reap_subagent, session_track.update_session, b.write_state = old_reap, old_upd, old_write


def test_main_pretooluse_agent_spawns_subagent():
    import io
    import session_track
    spawned = []
    old_spawn, old_upd = session_track.spawn_subagent, session_track.update_session
    old_write = b.write_state
    session_track.spawn_subagent = lambda room, agent, task, tool_use_id=None: spawned.append((room, agent, task, tool_use_id))
    session_track.update_session = lambda *a, **k: None
    b.write_state = lambda **k: None
    old_stdin, old_argv = sys.stdin, sys.argv
    sys.stdin = io.StringIO(json.dumps({
        "hook_event_name": "PreToolUse", "tool_name": "Agent", "tool_use_id": "toolu_1",
        "tool_input": {"subagent_type": "Explore", "description": "cerca file"}}))
    sys.argv = ["barracks.py"]
    try:
        b.main()
        assert spawned == [("ricerca", "ricerca-1", "cerca file", "toolu_1")], spawned
    finally:
        session_track.spawn_subagent, session_track.update_session = old_spawn, old_upd
        b.write_state = old_write
        sys.stdin, sys.argv = old_stdin, old_argv


def test_main_posttooluse_agent_reconciles():
    """Il risultato del tool Agent porta agentId (async_launched e completed):
    con il tool_use_id del lancio corregge l'accoppiamento del diario."""
    import session_track
    calls = []
    old_rec, old_upd, old_write, old_tok = (session_track.reconcile_subagent, session_track.update_session,
                                            b.write_state, b.accumulate_tokens)
    session_track.reconcile_subagent = lambda tu, ag: calls.append((tu, ag))
    session_track.update_session = lambda *a, **k: None
    b.write_state = lambda **k: None
    b.accumulate_tokens = lambda *a: ({}, None)
    try:
        _run_main({"hook_event_name": "PostToolUse", "tool_name": "Agent", "tool_use_id": "toolu_1",
                   "tool_input": {"description": "x"},
                   "tool_response": {"status": "async_launched", "agentId": "ag-1"}})
        _run_main({"hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_use_id": "toolu_2",
                   "tool_input": {"command": "ls"}, "tool_response": {"agentId": "finto"}})
        assert calls == [("toolu_1", "ag-1")], calls
    finally:
        (session_track.reconcile_subagent, session_track.update_session,
         b.write_state, b.accumulate_tokens) = old_rec, old_upd, old_write, old_tok


def test_accumulate_tokens_sends_model_and_1h_cache_write():
    """Per il costo in euro serve sapere il modello e quanta scrittura in cache
    è a 1 ora (costa 1,6 volte quella a 5 minuti)."""
    tmp_dir = tempfile.mkdtemp()
    transcript = os.path.join(tmp_dir, "t.jsonl")
    with_model = {"type": "assistant", "uuid": "a1", "message": {"model": "claude-opus-5-5", "usage": {
        "input_tokens": 1, "output_tokens": 2, "cache_read_input_tokens": 3, "cache_creation_input_tokens": 50,
        "cache_creation": {"ephemeral_5m_input_tokens": 10, "ephemeral_1h_input_tokens": 40}}}}
    old_tokens_path = b.TOKENS_PATH
    b.TOKENS_PATH = os.path.join(tmp_dir, "tokens.json")
    try:
        with open(transcript, "w", encoding="utf-8") as f:
            f.write(json.dumps(with_model) + "\n")
        _, delta = b.accumulate_tokens("qa", transcript)
        assert delta["model"] == "claude-opus-5-5", delta
        assert delta["cache_write"] == 50 and delta["cache_write_1h"] == 40, delta
        # transcript vecchio, senza modello né dettaglio: 'unknown' e 0, mai un errore
        bare = {"type": "assistant", "uuid": "a2", "message": {"usage": {"input_tokens": 1, "output_tokens": 1}}}
        with open(transcript, "w", encoding="utf-8") as f:
            f.write(json.dumps(bare) + "\n")
        _, delta = b.accumulate_tokens("qa", transcript)
        assert delta["model"] == "unknown" and delta["cache_write_1h"] == 0, delta
    finally:
        b.TOKENS_PATH = old_tokens_path


def test_main_posttooluse_syncs_state_session_and_tokens_once():
    import session_track
    sent = []
    old = (b.sync, b.write_state, b.accumulate_tokens, session_track.update_session)
    b.sync = lambda *a: sent.append(a)
    b.write_state = lambda **k: dict(k, ts=1)
    b.accumulate_tokens = lambda *a: ({"prod": {}}, {"room": "prod"})
    session_track.update_session = lambda key, **k: dict(k, transcript_path=key)
    try:
        _run_main({"hook_event_name": "PostToolUse", "tool_name": "Bash", "transcript_path": "/t",
                   "tool_input": {"command": "ls"}})
        assert len(sent) == 1, sent
        state, session, delta = sent[0]
        assert state["status"] == "writing" and state["tool"] == "Bash", state
        assert session == {"status": "writing", "room": "prod", "node": None, "transcript_path": "/t"}, session
        assert delta == {"room": "prod"}, delta
    finally:
        b.sync, b.write_state, b.accumulate_tokens, session_track.update_session = old


def main():
    test_main_posttooluse_agent_reconciles()
    test_classify_bash_qa()
    test_classify_lsp_and_review_skill_are_qa()
    test_classify_task_matches_spawn_helper()
    test_accumulate_tokens_dedup()
    test_write_state_is_local_and_returns_the_snapshot()
    test_sync_sends_one_record_event()
    test_in_background_returns_before_the_job_ends()
    test_accumulate_tokens_delta_for_supabase()
    test_last_assistant_usage_reads_from_the_tail()
    test_main_posttooluse_syncs_state_session_and_tokens_once()
    test_accumulate_tokens_sends_model_and_1h_cache_write()
    test_classify_agent_tool_same_as_task()
    test_main_pretooluse_agent_spawns_subagent()
    test_main_subagent_start_claims_agent_id()
    test_main_subagent_stop_reaps_by_agent_id()
    print("barracks.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
