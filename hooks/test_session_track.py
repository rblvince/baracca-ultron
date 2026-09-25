#!/usr/bin/env python3
# farm/hooks/test_session_track.py
"""Controllo rapido di session_track.py: python3 test_session_track.py"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import session_track as st
import supabase_client

supabase_client.CONFIG_PATH = "/nonexistent/baracca/.env"   # cintura: mai il database vero
# la coda verso Supabase in una cartella di prova, svuotata subito e in questo
# processo (niente figli staccati): i finti select/patch vedono le chiamate
st.QUEUE_PATH = os.path.join(tempfile.mkdtemp(), "supabase_queue.json")
st.KICK = st.drain


def test_update_session_writes_locally_and_returns_the_row():
    """La sessione va nel file locale; la riga per Supabase la manda barracks.sync()."""
    import json
    tmp_dir = tempfile.mkdtemp()
    old_sessions_path = st.SESSIONS_PATH
    st.SESSIONS_PATH = os.path.join(tmp_dir, "sessions.json")
    try:
        row = st.update_session("/path/to/transcript.jsonl", status="thinking", room="prod", node=None)
        assert row["transcript_path"] == "/path/to/transcript.jsonl", row
        assert row["status"] == "thinking" and row["room"] == "prod" and "node" not in row, row
        with open(st.SESSIONS_PATH, encoding="utf-8") as f:
            local = json.load(f)["/path/to/transcript.jsonl"]
        assert local == {k: v for k, v in row.items() if k != "transcript_path"}, local
        assert st.update_session(None, status="idle") is None
    finally:
        st.SESSIONS_PATH = old_sessions_path


def test_last_room_reads_the_terminal_last_event():
    tmp_dir = tempfile.mkdtemp()
    old_sessions_path = st.SESSIONS_PATH
    st.SESSIONS_PATH = os.path.join(tmp_dir, "sessions.json")
    try:
        assert st.last_room("/a") is None
        st.update_session("/a", status="thinking", room="qa")
        st.update_session("/b", status="writing", room="prod")
        assert st.last_room("/a") == "qa" and st.last_room("/b") == "prod"
        st.update_session("/a", status="thinking")   # istantanea senza reparto
        assert st.last_room("/a") is None
        assert st.last_room(None) is None
    finally:
        st.SESSIONS_PATH = old_sessions_path


def test_hooks_only_enqueue_and_the_drain_keeps_the_order():
    """Nel processo che Claude Code aspetta non parte nessuna chiamata di
    rete: le scritture vanno in coda e si svuotano dopo, nell'ordine degli
    eventi (la claim deve trovare la riga dello spawn di un istante prima)."""
    import supabase_client
    seen = []
    old = (st.KICK, supabase_client.insert, supabase_client.patch_oldest, supabase_client.load_config,
           st.SUBAGENTS_PATH)
    st.KICK = lambda: None
    supabase_client.insert = lambda table, row: seen.append(("insert", row["task"])) or 201
    supabase_client.patch_oldest = lambda table, f, n, v, extra=None: seen.append(("patch", sorted(v))) or 204
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "u1"}
    st.SUBAGENTS_PATH = os.path.join(tempfile.mkdtemp(), "subagents.json")
    try:
        st.spawn_subagent("qa", "qualita-1", "primo", "tu-1")
        st.claim_subagent("ag-1")
        st.reap_subagent("ag-1")
        assert seen == [], "nessuna rete prima del drain: " + str(seen)
        assert [op for op, _ in st._load(st.QUEUE_PATH, [])] == ["spawn", "claim", "reap"]
        st.drain()
        assert seen == [("insert", "primo"), ("patch", ["agent_id"]), ("patch", ["finished_at"])], seen
        assert st._load(st.QUEUE_PATH, None) == [], "la coda si svuota"
        assert supabase_client.TIMEOUT == st.NET_TIMEOUT, "nel drain il timeout è quello lungo"
    finally:
        (st.KICK, supabase_client.insert, supabase_client.patch_oldest, supabase_client.load_config,
         st.SUBAGENTS_PATH) = old
        supabase_client.TIMEOUT = 1


def test_queue_is_bounded_and_survives_a_broken_job():
    old = (st.KICK, st.QUEUE_MAX, st.REMOTE)
    ran = []
    st.KICK, st.QUEUE_MAX = (lambda: None), 3
    st.REMOTE = {"ok": lambda n: ran.append(n), "boom": lambda n: 1 / 0}
    try:
        for n in range(5):
            st.enqueue("ok", n=n)
        assert [a["n"] for _, a in st._load(st.QUEUE_PATH, [])] == [2, 3, 4]
        st.enqueue("boom", n=99)          # esce la 2, resta il limite
        st.enqueue("ok", n=5)
        st.drain()
        assert ran == [4, 5], ran         # 3 e boom scartate dal limite o dall'errore
    finally:
        st.KICK, st.QUEUE_MAX, st.REMOTE = old
        st._save(st.QUEUE_PATH, [])


def test_parallel_hooks_do_not_lose_sessions():
    """Hook dei tool in parallelo: ogni terminale scritto da un processo
    diverso nello stesso istante deve restare nel file."""
    import multiprocessing
    tmp_dir = tempfile.mkdtemp()
    old = st.SESSIONS_PATH
    st.SESSIONS_PATH = os.path.join(tmp_dir, "sessions.json")
    try:
        ctx = multiprocessing.get_context("fork")
        procs = [ctx.Process(target=lambda i=i: [st.update_session("/t%d" % i, status="thinking")
                                                  for _ in range(20)]) for i in range(8)]
        for p in procs:
            p.start()
        for p in procs:
            p.join()
        assert sorted(st._load(st.SESSIONS_PATH, {})) == sorted("/t%d" % i for i in range(8))
    finally:
        st.SESSIONS_PATH = old


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
        assert "tool_use_id" not in row, row
        st.spawn_subagent("qa", "qualita-1", "run tests", tool_use_id="toolu_9")
        assert calls[1][1]["tool_use_id"] == "toolu_9", calls[1]
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
    supabase_client.patch_oldest = lambda table, filters, nulls, values, extra=None: calls.append((table, filters, nulls, values, extra)) or next(it)
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
        table, filters, nulls, values, extra = calls[0]
        assert table == "subagents", table
        assert filters == {"user_id": "u1", "agent_id": "ag-2"}, filters
        assert nulls == ["finished_at"], nulls
        assert set(values) == {"finished_at"} and values["finished_at"].endswith("+00:00"), values
        assert extra is None, extra
    finally:
        restore()


def test_reap_subagent_falls_back_to_fifo():
    """Il fallback FIFO non deve mai chiudere una riga già reclamata da un
    altro sub-agente in corso: agent_id deve essere fra le colonne NULL."""
    calls, restore = _with_patch_oldest([None, 204])
    try:
        st.reap_subagent("ag-sconosciuto")
        assert len(calls) == 2, calls
        assert calls[1][1] == {"user_id": "u1"} and calls[1][2] == ["finished_at", "agent_id"], calls
    finally:
        restore()


def test_reap_subagent_without_id_is_fifo():
    calls, restore = _with_patch_oldest([204])
    try:
        st.reap_subagent()
        assert len(calls) == 1 and calls[0][1] == {"user_id": "u1"} and calls[0][2] == ["finished_at", "agent_id"], calls
    finally:
        restore()


def test_claim_subagent_sets_agent_id_on_oldest_unclaimed():
    calls, restore = _with_patch_oldest([204])
    try:
        st.claim_subagent("ag-1")
        assert len(calls) == 1, calls
        table, filters, nulls, values, extra = calls[0]
        assert table == "subagents" and filters == {"user_id": "u1"}, calls[0]
        assert nulls == ["agent_id", "finished_at"], nulls
        assert values == {"agent_id": "ag-1"}, values
        assert extra and len(extra) == 1 and extra[0].startswith("created_at=gte."), extra
    finally:
        restore()


def test_claim_subagent_excludes_stale_orphan_rows():
    """Una riga orfana (PreToolUse senza SubagentStart che l'ha mai reclamata)
    resta sempre la più vecchia: senza un filtro temporale ogni claim
    successiva la reclamerebbe al posto giusto, spostando di una posizione
    ogni riga del diario da lì in poi. Il filtro deve valere ~60s, non "da
    sempre" (altrimenti l'orfana resta comunque reclamabile per sempre)."""
    import urllib.parse
    from datetime import datetime, timezone
    calls, restore = _with_patch_oldest([204])
    try:
        before = datetime.now(timezone.utc)
        st.claim_subagent("ag-2")
        extra = calls[0][4]
        raw = extra[0][len("created_at=gte."):]
        cutoff = datetime.fromisoformat(urllib.parse.unquote(raw))
        delta = (before - cutoff).total_seconds()
        assert 55 <= delta <= 65, delta
    finally:
        restore()


def test_claim_subagent_without_id_does_nothing():
    calls, restore = _with_patch_oldest([])
    try:
        st.claim_subagent(None)
        assert calls == [], calls
    finally:
        restore()


def _with_fake_db(rows):
    """Finto select/patch su una lista di righe in memoria (la tabella
    subagents). Ritorna (patches, restore)."""
    import supabase_client
    patches = []
    old = supabase_client.select, supabase_client.patch, supabase_client.load_config

    def select(table, filters, columns):
        assert table == "subagents", table
        return [dict(r) for r in rows if all(r.get(k) == v for k, v in filters.items())]

    def patch(table, row_id, values):
        patches.append((row_id, values))
        for r in rows:
            if r["id"] == row_id:
                r.update(values)
        return 204
    supabase_client.select, supabase_client.patch = select, patch
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "u1"}

    def restore():
        supabase_client.select, supabase_client.patch, supabase_client.load_config = old
    return patches, restore


def test_reconcile_swaps_crossed_claims():
    """Due lanci ravvicinati, SubagentStart arrivati invertiti: ognuno ha
    l'id dell'altro. Il PostToolUse di A (tool_use_id + agentId veri) deve
    rimettere a posto id e fine su entrambe le righe."""
    rows = [
        {"id": 1, "user_id": "u1", "tool_use_id": "tu-A", "agent_id": "ag-B", "finished_at": "t-B"},
        {"id": 2, "user_id": "u1", "tool_use_id": "tu-B", "agent_id": "ag-A", "finished_at": None},
    ]
    patches, restore = _with_fake_db(rows)
    try:
        st.reconcile_subagent("tu-A", "ag-A")
        assert rows[0]["agent_id"] == "ag-A" and rows[0]["finished_at"] is None, rows
        assert rows[1]["agent_id"] == "ag-B" and rows[1]["finished_at"] == "t-B", rows
        patches.clear()
        st.reconcile_subagent("tu-B", "ag-B")  # ormai giusta: nessuna scrittura
        assert patches == [], patches
    finally:
        restore()


def test_reconcile_sets_missing_agent_id():
    """Riga mai reclamata (claim persa o fuori finestra): prende l'id giusto."""
    rows = [{"id": 4, "user_id": "u1", "tool_use_id": "tu-A", "agent_id": None, "finished_at": None}]
    patches, restore = _with_fake_db(rows)
    try:
        st.reconcile_subagent("tu-A", "ag-A")
        assert patches == [(4, {"agent_id": "ag-A"})], patches
    finally:
        restore()


def test_reconcile_without_ids_or_row_does_nothing():
    rows = [{"id": 4, "user_id": "u1", "tool_use_id": "tu-X", "agent_id": None, "finished_at": None}]
    patches, restore = _with_fake_db(rows)
    try:
        st.reconcile_subagent(None, "ag-A")
        st.reconcile_subagent("tu-A", None)
        st.reconcile_subagent("tu-sconosciuto", "ag-A")
        assert patches == [], patches
    finally:
        restore()


def main():
    test_reconcile_swaps_crossed_claims()
    test_reconcile_sets_missing_agent_id()
    test_reconcile_without_ids_or_row_does_nothing()
    test_update_session_writes_locally_and_returns_the_row()
    test_hooks_only_enqueue_and_the_drain_keeps_the_order()
    test_queue_is_bounded_and_survives_a_broken_job()
    test_parallel_hooks_do_not_lose_sessions()
    test_last_room_reads_the_terminal_last_event()
    test_spawn_subagent_calls_supabase_insert()
    test_reap_subagent_closes_by_agent_id()
    test_reap_subagent_falls_back_to_fifo()
    test_reap_subagent_without_id_is_fifo()
    test_claim_subagent_sets_agent_id_on_oldest_unclaimed()
    test_claim_subagent_excludes_stale_orphan_rows()
    test_claim_subagent_without_id_does_nothing()
    print("session_track.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
