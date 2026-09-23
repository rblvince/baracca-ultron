# Pannelli STORICO in React — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere alla DASHBOARD della Baracca un gruppo `STORICO` con tre pannelli React (consumo token 30 giorni, diario subagenti 7 giorni, timeline sessioni 7 giorni) su dati Supabase veri, più le modifiche a schema e hook che rendono quei dati esistenti.

**Architecture:** Un'isola Vite + React + TypeScript in `farm/panels/`, buildata in un solo `panels/dist/panels.js` (IIFE) che espone `window.mountStorico(el, supaClient, {rooms})`. Il vanilla di `baracca.html` resta padrone della pagina: monta l'isola dopo l'autenticazione e le dice quando la DASHBOARD è visibile. Gli hook Python registrano i subagenti (tool `Agent`, non più solo `Task`), li abbinano per `agent_id` e li chiudono invece di cancellarli.

**Tech Stack:** React 19.3.0, TypeScript 5.9.3, Vite 8.3.0, Vitest 5.0.1, Testing Library 16.3.3, jsdom 30.1.1; Python 3 stdlib (hook, server); Supabase REST/PostgREST.

**Spec:** `farm/docs/superpowers/specs/2026-09-23-react-storico-design.md` (con la sezione "Aggiornamenti dal piano" in fondo).

## Global Constraints

- Il motore canvas di `baracca.html` non si tocca: nessuna funzione `draw*`, `bake*`, `step*`, `goTo`, `simulate`, `applyLive`, `subscribeRealtime` modificata.
- Nessuna modifica a RLS o alla pubblicazione Realtime.
- `typescript@5.9.3` esatto (non 7.x: niente `tsserver.js`, rompe il language server).
- Tutte le versioni npm fissate esatte, senza `^`/`~`.
- supabase-js non entra nel bundle: solo `import type`.
- Gli hook non sollevano mai eccezioni verso Claude Code (ogni chiamata Supabase dentro `try/except Exception: pass`).
- Mai una chiave o un token scritto nel repo, nel piano o nelle note: la config vive in `~/.config/baracca/.env` (permessi 600).
- `dist/panels.js` è committato: `./start.sh` deve continuare a funzionare senza Node.
- Testi dell'interfaccia in italiano, maiuscoletto nei titoli dei pannelli come quelli esistenti.
- Nessun push su GitHub senza il via esplicito di Vincent. `~/my-agent/.claude/settings.json` si modifica solo dopo il merge, con conferma esplicita.

## Review Focus

- **Due subagenti lanciati nello stesso messaggio:** ognuno deve chiudersi sulla propria riga. La chiusura va per `agent_id`, non FIFO, quando l'id c'è (test in Task 3: `reap_subagent("ag-2")` filtra per `agent_id=ag-2`).
- **Sessione a cavallo della mezzanotte:** compare su due righe della timeline, non come una barra che esce dal bordo (test in Task 5).
- **Supabase irraggiungibile dopo un primo caricamento riuscito:** il pannello tiene i dati vecchi e mostra `ERRORE`, non si svuota (test in Task 6 e Task 7).
- **`panels.js` mancante o rotto:** la Baracca funziona come prima (verifica manuale in Task 9).
- **Giorni senza consumo o dataset tutto a zero:** niente `NaN`/`Infinity` nel grafico, resa cache mostrata come "—" (test in Task 5 e Task 7).

---

### Task 1: Gli hook riconoscono il tool `Agent`

Oggi `barracks.py` confronta `tool_name == "Task"`, ma il tool che lancia i subagenti si chiama `Agent`: la coda non ha mai registrato nulla (`state/subagents.json` fermo a `next_id: 1`, tabella `subagents` vuota, verificato il 2026-09-23).

**Files:**
- Modify: `farm/hooks/barracks.py` (costante nuova vicino a `SUBAGENT_ROOM`, riga ~242 in `classify`, riga ~290 in `main`)
- Test: `farm/hooks/test_barracks.py`

**Interfaces:**
- Produces: `barracks.SUBAGENT_TOOLS = ("Task", "Agent")`

- [ ] **Step 1: Write the failing tests** (in `test_barracks.py`, prima di `def main():`)

```python
def test_classify_agent_tool_same_as_task():
    old = b.classify({"tool_name": "Task", "tool_input": {"subagent_type": "qualita"}})
    new = b.classify({"tool_name": "Agent", "tool_input": {"subagent_type": "qualita"}})
    assert old == new, (old, new)


def test_main_pretooluse_agent_spawns_subagent():
    import io
    import session_track
    spawned = []
    old_spawn, old_upd = session_track.spawn_subagent, session_track.update_session
    old_write = b.write_state
    session_track.spawn_subagent = lambda room, agent, task: spawned.append((room, agent, task))
    session_track.update_session = lambda *a, **k: None
    b.write_state = lambda **k: None
    old_stdin, old_argv = sys.stdin, sys.argv
    sys.stdin = io.StringIO(json.dumps({
        "hook_event_name": "PreToolUse", "tool_name": "Agent",
        "tool_input": {"subagent_type": "Explore", "description": "cerca file"}}))
    sys.argv = ["barracks.py"]
    try:
        b.main()
        assert spawned == [("ricerca", "ricerca-1", "cerca file")], spawned
    finally:
        session_track.spawn_subagent, session_track.update_session = old_spawn, old_upd
        b.write_state = old_write
        sys.stdin, sys.argv = old_stdin, old_argv
```

Aggiungere a `main()` del file di test:

```python
    test_classify_agent_tool_same_as_task()
    test_main_pretooluse_agent_spawns_subagent()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/my-agent/farm/hooks && python3 test_barracks.py`
Expected: `AssertionError` su `test_classify_agent_tool_same_as_task` (le due tuple differiscono).

- [ ] **Step 3: Implement**

In `barracks.py`, subito dopo il dizionario `SUBAGENT_CREW`:

```python
# Il tool che lancia un sub-agente si chiamava "Task", oggi "Agent": vanno
# riconosciuti entrambi, altrimenti la coda dei sub-agenti resta vuota.
SUBAGENT_TOOLS = ("Task", "Agent")
```

In `classify()`: `if tool == "Task":` → `if tool in SUBAGENT_TOOLS:`

In `main()`: `if (payload.get("tool_name") or payload.get("toolName")) == "Task":` → `if (payload.get("tool_name") or payload.get("toolName")) in SUBAGENT_TOOLS:`

Aggiornare il commento sopra (`# PreToolUse su Task`) in `# PreToolUse su Task/Agent`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ~/my-agent/farm/hooks && python3 test_barracks.py`
Expected: `barracks.py: tutti i controlli passati` (o il messaggio finale esistente del file), nessun errore.

- [ ] **Step 5: Commit**

```bash
cd ~/my-agent/farm && git add hooks/barracks.py hooks/test_barracks.py
git commit -m "fix(hooks): riconosci il tool Agent oltre a Task per i sub-agenti"
```

---

### Task 2: `patch_oldest` al posto di `delete_oldest`

**Files:**
- Modify: `farm/hooks/supabase_client.py` (sostituisce `delete_oldest`, righe ~94-117)
- Test: `farm/hooks/test_supabase_client.py` (sostituisce `test_delete_oldest_encodes_filter_values`)

**Interfaces:**
- Produces: `supabase_client.patch_oldest(table: str, filters: dict, null_columns: list[str], values: dict) -> int | None` — stato HTTP del PATCH, `None` se manca la config, la rete non risponde o nessuna riga corrisponde. Non solleva mai.
- Removes: `supabase_client.delete_oldest` (unico chiamante: `session_track.reap_subagent`, sistemato in Task 3).

- [ ] **Step 1: Write the failing tests**

Sostituire l'intera funzione `test_delete_oldest_encodes_filter_values` con:

```python
def _fake_urlopen_sequence(responses, seen):
    """Finto urlopen: registra (metodo, url, corpo) e restituisce le risposte in ordine."""
    it = iter(responses)

    def fake(req, timeout=1):
        seen.append((req.get_method(), req.full_url, req.data))
        status, body = next(it)

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return body
        r = R()
        r.status = status
        return r
    return fake


def test_patch_oldest_selects_then_patches():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(200, b'[{"id": 7}]'), (204, b"")], seen)
    try:
        status = sc.patch_oldest("subagents", {"user_id": "a b&x=eq.y"}, ["agent_id", "finished_at"], {"agent_id": "ag-1"})
        assert status == 204, status
        method, url, _ = seen[0]
        assert method == "GET", method
        assert "/rest/v1/subagents?user_id=eq.a%20b%26x%3Deq.y&agent_id=is.null&finished_at=is.null" in url, url
        assert url.endswith("&order=created_at.asc&limit=1&select=id"), url
        method, url, body = seen[1]
        assert method == "PATCH", method
        assert url.endswith("/rest/v1/subagents?id=eq.7"), url
        assert json.loads(body) == {"agent_id": "ag-1"}, body
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_patch_oldest_no_row_returns_none():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(200, b"[]")], seen)
    try:
        assert sc.patch_oldest("subagents", {"user_id": "u"}, ["finished_at"], {"finished_at": "x"}) is None
        assert len(seen) == 1, seen
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_patch_oldest_network_error_returns_none():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp

    def boom(req, timeout=1):
        raise urllib.error.URLError("rete giù")
    sc.urllib.request.urlopen = boom
    try:
        assert sc.patch_oldest("subagents", {"user_id": "u"}, ["finished_at"], {"finished_at": "x"}) is None
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_delete_oldest_is_gone():
    assert not hasattr(sc, "delete_oldest")
```

In `main()` del file di test, sostituire `test_delete_oldest_encodes_filter_values()` con:

```python
    test_patch_oldest_selects_then_patches()
    test_patch_oldest_no_row_returns_none()
    test_patch_oldest_network_error_returns_none()
    test_delete_oldest_is_gone()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/my-agent/farm/hooks && python3 test_supabase_client.py`
Expected: `AttributeError: module 'supabase_client' has no attribute 'patch_oldest'`

- [ ] **Step 3: Implement**

In `supabase_client.py`, sostituire l'intera funzione `delete_oldest` con:

```python
def patch_oldest(table, filters, null_columns, values):
    """Aggiorna la riga più vecchia (per created_at) che soddisfa i filtri di
    uguaglianza (dict campo->valore) e ha NULL in tutte le null_columns.
    Due chiamate REST, perché PostgREST non supporta "update + limit 1":
    select dell'id più vecchio, poi PATCH per id. Ritorna lo stato HTTP del
    PATCH, oppure None se manca la config, la rete non risponde o nessuna
    riga corrisponde."""
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    parts = [k + "=eq." + urllib.parse.quote(str(v), safe="") for k, v in filters.items()]
    parts += [c + "=is.null" for c in null_columns]
    select_url = (url + "/rest/v1/" + table + "?" + "&".join(parts)
                  + "&order=created_at.asc&limit=1&select=id")
    status, body = _do_request("GET", select_url, key)
    if status != 200 or not body:
        return None
    try:
        rows = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not rows:
        return None
    row_id = rows[0]["id"]
    patch_status, _ = _do_request("PATCH", url + "/rest/v1/" + table + "?id=eq." + str(row_id), key,
                                  body=values, extra_headers={"Prefer": "return=minimal"})
    return patch_status
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ~/my-agent/farm/hooks && python3 test_supabase_client.py`
Expected: `supabase_client.py: tutti i controlli passati`

`test_session_track.py` in questo momento fallisce perché usa ancora `delete_oldest`: lo sistema il Task 3. Per non lasciare un commit con un test rosso, **Task 2 e Task 3 si committano insieme alla fine del Task 3**.

- [ ] **Step 5: (nessun commit, vedi Task 3 Step 6)**

---

### Task 3: Abbinamento per `agent_id` e chiusura invece della cancellazione

Documentazione ufficiale degli hook (letta il 2026-09-23): `SubagentStart` e `SubagentStop` portano entrambi `agent_id` e `agent_type`; `PreToolUse` porta la `description` del Task ma non `agent_id`. Quindi: la riga nasce a `PreToolUse` (con reparto, operativo e compito), `SubagentStart` le assegna l'`agent_id` (la più vecchia ancora senza id), `SubagentStop` chiude la riga con quell'`agent_id`. Se l'id manca o non trova la riga, si ricade sul FIFO.

**Files:**
- Modify: `farm/hooks/session_track.py` (`reap_subagent`, nuova `claim_subagent`, import di `datetime`)
- Modify: `farm/hooks/barracks.py` (`main()`: ramo `SubagentStart`, `agent_id` passato a `reap_subagent`)
- Test: `farm/hooks/test_session_track.py` (sostituisce `test_reap_subagent_calls_delete_oldest`), `farm/hooks/test_barracks.py`

**Interfaces:**
- Consumes: `supabase_client.patch_oldest(table, filters, null_columns, values)` (Task 2)
- Produces: `session_track.claim_subagent(agent_id: str | None) -> None`; `session_track.reap_subagent(agent_id: str | None = None) -> None`

- [ ] **Step 1: Write the failing tests** in `test_session_track.py`

Sostituire l'intera funzione `test_reap_subagent_calls_delete_oldest` con:

```python
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
```

In `main()` del file di test, sostituire `test_reap_subagent_calls_delete_oldest()` con:

```python
    test_reap_subagent_closes_by_agent_id()
    test_reap_subagent_falls_back_to_fifo()
    test_reap_subagent_without_id_is_fifo()
    test_claim_subagent_sets_agent_id_on_oldest_unclaimed()
    test_claim_subagent_without_id_does_nothing()
```

- [ ] **Step 2: Write the failing tests** in `test_barracks.py` (prima di `def main():`)

```python
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
```

Aggiungere a `main()` del file di test:

```python
    test_main_subagent_start_claims_agent_id()
    test_main_subagent_stop_reaps_by_agent_id()
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd ~/my-agent/farm/hooks && python3 test_session_track.py; python3 test_barracks.py`
Expected: `AttributeError: module 'session_track' has no attribute 'claim_subagent'` (o `TypeError` su `reap_subagent("ag-2")`).

- [ ] **Step 4: Implement** in `session_track.py`

Aggiungere agli import in cima: `from datetime import datetime, timezone`

Sostituire l'intera funzione `reap_subagent` con queste due:

```python
def claim_subagent(agent_id):
    """Un sub-agente è appena partito (SubagentStart): la riga creata un istante
    prima da PreToolUse (la più vecchia ancora senza agent_id) prende il suo id,
    così al rientro si chiude la riga giusta anche con più sub-agenti insieme.
    ponytail: due partenze nello stesso istante possono scambiarsi i compiti
    (le claim sono FIFO); la durata resta comunque quella del sub-agente giusto."""
    if not agent_id:
        return
    try:
        user_id = supabase_client.load_config().get("SUPABASE_USER_ID")
        if user_id:
            supabase_client.patch_oldest("subagents", {"user_id": user_id},
                                         ["agent_id", "finished_at"], {"agent_id": agent_id})
    except Exception:
        pass


def reap_subagent(agent_id=None):
    """Un sub-agente è rientrato (SubagentStop). In locale toglie il più vecchio
    ancora in coda (FIFO, come sempre: il file serve solo alla scena). Su
    Supabase la riga non si cancella più: si chiude con finished_at, così resta
    nel diario. Con agent_id si chiude la riga esatta; senza, o se nessuna riga
    ha quell'id, la più vecchia ancora aperta."""
    data = _load(SUBAGENTS_PATH, {"next_id": 1, "list": []})
    if data.get("list"):
        data["list"].pop(0)
        _save(SUBAGENTS_PATH, data)

    try:
        user_id = supabase_client.load_config().get("SUPABASE_USER_ID")
        if user_id:
            now = {"finished_at": datetime.now(timezone.utc).isoformat()}
            done = None
            if agent_id:
                done = supabase_client.patch_oldest("subagents", {"user_id": user_id, "agent_id": agent_id},
                                                    ["finished_at"], now)
            if done is None:
                supabase_client.patch_oldest("subagents", {"user_id": user_id}, ["finished_at"], now)
    except Exception:
        pass
```

- [ ] **Step 5: Implement** in `barracks.py`, dentro `main()`

Sostituire il blocco `if event == "SubagentStop":` con:

```python
    if event == "SubagentStart":
        session_track.claim_subagent(payload.get("agent_id"))
        return
    if event == "SubagentStop":
        write_state(status="thinking", room="prod", line="reparto rientrato")
        session_track.reap_subagent(payload.get("agent_id"))
        session_track.update_session(transcript_path, status="thinking", room="prod")
        return
```

- [ ] **Step 6: Run all hook tests, then commit Task 2 + Task 3 together**

Run: `cd ~/my-agent/farm/hooks && python3 test_supabase_client.py && python3 test_session_track.py && python3 test_barracks.py && python3 test_set_state.py && cd .. && python3 test_server.py`
Expected: ogni file stampa il suo "tutti i controlli passati", exit code 0.

Run: `cd ~/my-agent/farm && grep -rn "delete_oldest" hooks server.py`
Expected: nessun risultato.

```bash
cd ~/my-agent/farm && git add hooks/supabase_client.py hooks/test_supabase_client.py hooks/session_track.py hooks/test_session_track.py hooks/barracks.py hooks/test_barracks.py
git commit -m "feat(hooks): sub-agenti abbinati per agent_id e chiusi con finished_at invece che cancellati"
```

---

### Task 4: Migrazione `002_history.sql` e schema aggiornato

Solo file: la migrazione si applica al database vero nel Task 10.

**Files:**
- Create: `farm/supabase/migrations/002_history.sql`
- Modify: `farm/supabase/schema.sql` (tabelle `sessions` e `subagents`, per chi installa da zero)

**Interfaces:**
- Produces: colonne `sessions.created_at timestamptz` (default `now()` solo per le righe nuove), `subagents.finished_at timestamptz`, `subagents.agent_id text`. Le usano Task 6 (`types.ts`) e Task 10.

- [ ] **Step 1: Create `002_history.sql`**

```sql
-- farm/supabase/migrations/002_history.sql
-- Giro 2, pannelli STORICO. Solo colonne aggiunte: niente di distruttivo.

-- sessions: ora di inizio. Aggiunta SENZA default, poi default solo per le
-- righe nuove: le sessioni esistenti restano NULL ("inizio non registrato")
-- invece di ricevere tutte l'ora della migrazione.
alter table sessions add column created_at timestamptz;
alter table sessions alter column created_at set default now();

-- subagents: da coda a storico. finished_at NULL = ancora in corso.
-- agent_id arriva da SubagentStart e serve a chiudere la riga giusta.
alter table subagents add column finished_at timestamptz;
alter table subagents add column agent_id text;
```

- [ ] **Step 2: Update `schema.sql`**

Nella `create table sessions`, dopo `ts bigint not null,` aggiungere la riga:

```sql
  created_at timestamptz default now(),
```

Nella `create table subagents`, dopo `created_at timestamptz not null default now()` (che diventa `created_at timestamptz not null default now(),`) aggiungere:

```sql
  finished_at timestamptz,
  agent_id text
```

- [ ] **Step 3: Check the SQL reads correctly**

Run: `cd ~/my-agent/farm && sed -n '/create table sessions/,/);/p;/create table subagents/,/);/p' supabase/schema.sql`
Expected: `sessions` con `created_at timestamptz default now(),` prima di `unique (user_id, transcript_path)`; `subagents` che termina con `finished_at timestamptz,` / `agent_id text` e senza virgola dopo l'ultima colonna.

- [ ] **Step 4: Commit**

```bash
cd ~/my-agent/farm && git add supabase/migrations/002_history.sql supabase/schema.sql
git commit -m "feat(db): migrazione 002, created_at su sessions, finished_at e agent_id su subagents"
```

---

### Task 5: Progetto `panels/` e logica pura

**Files:**
- Create: `farm/panels/package.json`, `farm/panels/tsconfig.json`, `farm/panels/vite.config.ts`, `farm/panels/.gitignore`
- Create: `farm/panels/src/types.ts` (solo i tipi; le colonne arrivano nel Task 6)
- Create: `farm/panels/src/logic.ts`
- Test: `farm/panels/src/logic.test.ts`

**Interfaces:**
- Produces (`types.ts`): `Room`, `TokenUsageRow`, `SubagentRow`, `SessionRow`, `HISTORY_SINCE`
- Produces (`logic.ts`): `dayKey(d: Date): string`, `dayStart(day: string): number`, `nextDay(day: string): string`, `lastNDays(today: Date, n: number): string[]`, `fmtDay(day: string): string`, `fmtClock(ms: number): string`, `fmtTokens(n: number): string`, `tokenDays(rows: TokenUsageRow[], days: string[]): DayBar[]`, `tokenSummary(rows: TokenUsageRow[]): TokenSummary`, `durationMs(start: string, end: string | null): number | null`, `formatDuration(ms: number): string`, `groupByDay<T>(rows: T[], when: (r: T) => number): { day: string; rows: T[] }[]`, `sessionSegments(s: SessionRow, days: string[]): Segment[]`, `stripedRooms(rooms: Room[]): Set<string>`, `roomOf(rooms: Room[], id: string | null): Room`, `roomFill(room: Room, striped: Set<string>): string`, `orderedRooms(byRoom: Record<string, number>, rooms: Room[]): Room[]`; tipi `DayBar`, `TokenSummary`, `Segment`

- [ ] **Step 1: Create the project files**

`farm/panels/package.json`:

```json
{
  "name": "baracca-panels",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "test": "TZ=Europe/Rome vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@supabase/supabase-js": "2.117.1",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/node": "24.13.6",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "jsdom": "30.1.1",
    "typescript": "5.9.3",
    "vite": "8.3.0",
    "vitest": "5.0.1"
  }
}
```

`farm/panels/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`farm/panels/vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Isola React della Baracca: un solo panels.js (IIFE) che espone
// window.mountStorico. React entra nel bundle, supabase-js no (solo tipi).
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // in library mode Vite non sostituisce process.env.NODE_ENV da solo;
  // solo in build, altrimenti i test girerebbero sul React di produzione
  define: command === 'build' ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: {
    lib: { entry: 'src/mount.tsx', name: 'BaraccaPanels', formats: ['iife'], fileName: () => 'panels.js' },
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: { environment: 'jsdom' },
}));
```

`farm/panels/.gitignore`:

```
node_modules/
```

Run: `cd ~/my-agent/farm/panels && npm install`
Expected: installazione senza errori di peer dependency; `node_modules/typescript/lib/tsserver.js` esiste (`ls node_modules/typescript/lib/tsserver.js`).

- [ ] **Step 2: Create `src/types.ts`**

```ts
// Righe delle tabelle Supabase lette dai pannelli. Scritte a mano da
// supabase/schema.sql (supabase gen types richiederebbe un token d'accesso
// all'account). Il test in schema.test.ts fallisce se divergono.

export type Room = { id: string; n: string; col: string };

export type TokenUsageRow = {
  user_id: string;
  day: string; // 'YYYY-MM-DD', data locale del Mac che ha scritto
  room: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type SubagentRow = {
  id: number;
  user_id: string;
  room: string;
  agent: string | null;
  task: string | null;
  created_at: string;
  finished_at: string | null;
  agent_id: string | null;
};

export type SessionRow = {
  id: number;
  user_id: string;
  transcript_path: string;
  status: string | null;
  room: string | null;
  node: string | null;
  ts: number; // ms epoch dell'ultimo segnale
  created_at: string | null; // NULL per le sessioni nate prima della migrazione 002
};

// Giorno in cui la migrazione 002 è stata applicata: da qui parte il diario.
export const HISTORY_SINCE = '2026-09-23';
```

- [ ] **Step 3: Write the failing tests** — `src/logic.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  dayKey, dayStart, durationMs, fmtDay, fmtTokens, formatDuration, groupByDay, lastNDays,
  orderedRooms, roomFill, roomOf, sessionSegments, stripedRooms, tokenDays, tokenSummary,
} from './logic';
import type { Room, SessionRow, TokenUsageRow } from './types';

const ROOMS: Room[] = [
  { id: 'ricerca', n: 'RICERCA', col: '#229fb3' },
  { id: 'prod', n: 'OFFICINA', col: '#2aa883' },
  { id: 'rs', n: 'LABORATORIO', col: '#229FB3' },
];
const tok = (day: string, room: string, input: number, output: number, cache_read = 0, cache_write = 0): TokenUsageRow =>
  ({ user_id: 'u', day, room, input, output, cache_read, cache_write });
const ses = (p: Partial<SessionRow>): SessionRow =>
  ({ id: 1, user_id: 'u', transcript_path: 't', status: null, room: 'prod', node: null, ts: 0, created_at: null, ...p });

describe('giorni', () => {
  it('lastNDays restituisce n giorni locali, dal più vecchio a oggi', () => {
    expect(lastNDays(new Date(2026, 8, 2, 10), 3)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });
  it('dayKey usa la data locale, non UTC', () => {
    expect(dayKey(new Date(2026, 8, 23, 0, 30))).toBe('2026-09-23');
  });
  it('fmtDay mostra GG/MM', () => {
    expect(fmtDay('2026-09-03')).toBe('03/09');
  });
});

describe('token', () => {
  it('tokenDays somma input+output per reparto e tiene i giorni vuoti', () => {
    const bars = tokenDays([tok('2026-09-22', 'prod', 10, 90), tok('2026-09-22', 'rs', 1, 9)], ['2026-09-21', '2026-09-22']);
    expect(bars).toEqual([
      { day: '2026-09-21', total: 0, byRoom: {} },
      { day: '2026-09-22', total: 110, byRoom: { prod: 100, rs: 10 } },
    ]);
  });
  it('tokenDays ignora giorni fuori finestra', () => {
    expect(tokenDays([tok('2026-01-01', 'prod', 5, 5)], ['2026-09-22'])[0].total).toBe(0);
  });
  it('tokenSummary: totale, reparto top, resa cache con cache_write al denominatore', () => {
    const s = tokenSummary([tok('d', 'prod', 100, 900, 800, 100), tok('d', 'rs', 0, 50, 0, 0)]);
    expect(s.total).toBe(1050);
    expect(s.topRoom).toBe('prod');
    expect(s.cacheYield).toBeCloseTo(800 / 1000);
  });
  it('tokenSummary con dati vuoti o tutti a zero non produce NaN', () => {
    expect(tokenSummary([])).toEqual({ total: 0, topRoom: null, cacheYield: null });
    expect(tokenSummary([tok('d', 'prod', 0, 0)])).toEqual({ total: 0, topRoom: null, cacheYield: null });
  });
  it('fmtTokens arrotonda senza scrivere 1000k', () => {
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1500)).toBe('1.5k');
    expect(fmtTokens(999_950)).toBe('1M');
    expect(fmtTokens(1_234_567)).toBe('1.2M');
  });
});

describe('durate', () => {
  it('durationMs: null se ancora in corso o se le date sono al contrario', () => {
    expect(durationMs('2026-09-23T10:00:00Z', null)).toBeNull();
    expect(durationMs('2026-09-23T10:00:10Z', '2026-09-23T10:00:00Z')).toBeNull();
    expect(durationMs('2026-09-23T10:00:00Z', '2026-09-23T10:01:05Z')).toBe(65_000);
  });
  it('formatDuration', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(192_000)).toBe('3m 12s');
    expect(formatDuration(3_840_000)).toBe('1h 04m');
  });
  it('groupByDay: giorni dal più recente, righe dal più recente', () => {
    const a = { t: new Date(2026, 8, 22, 9).getTime() };
    const b = { t: new Date(2026, 8, 23, 8).getTime() };
    const c = { t: new Date(2026, 8, 23, 18).getTime() };
    expect(groupByDay([a, b, c], (r) => r.t)).toEqual([
      { day: '2026-09-23', rows: [c, b] },
      { day: '2026-09-22', rows: [a] },
    ]);
  });
});

describe('timeline', () => {
  const days = ['2026-09-22', '2026-09-23'];
  it('sessione nello stesso giorno: una barra con le percentuali giuste', () => {
    const s = ses({ created_at: new Date(2026, 8, 23, 6).toISOString(), ts: new Date(2026, 8, 23, 12).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-23', startPct: 25, endPct: 50, point: false }]);
  });
  it('sessione a cavallo della mezzanotte: spezzata su due giorni', () => {
    const s = ses({ created_at: new Date(2026, 8, 22, 18).toISOString(), ts: new Date(2026, 8, 23, 6).getTime() });
    expect(sessionSegments(s, days)).toEqual([
      { day: '2026-09-22', startPct: 75, endPct: 100, point: false },
      { day: '2026-09-23', startPct: 0, endPct: 25, point: false },
    ]);
  });
  it('sessione che finisce esattamente a mezzanotte: nessuna barra vuota il giorno dopo', () => {
    const s = ses({ created_at: new Date(2026, 8, 22, 18).toISOString(), ts: new Date(2026, 8, 23, 0).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-22', startPct: 75, endPct: 100, point: false }]);
  });
  it('sessione senza inizio registrato: un punto sull’ultimo segnale', () => {
    const s = ses({ created_at: null, ts: new Date(2026, 8, 23, 18).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-23', startPct: 75, endPct: 75, point: true }]);
  });
  it('inizio dopo l’ultimo segnale (orologi diversi): trattato come un istante', () => {
    const s = ses({ created_at: new Date(2026, 8, 23, 12, 0, 1).toISOString(), ts: new Date(2026, 8, 23, 12).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-23', startPct: 50, endPct: 50, point: false }]);
  });
  it('sessione fuori finestra: niente', () => {
    const s = ses({ created_at: null, ts: new Date(2026, 0, 1).getTime() });
    expect(sessionSegments(s, days)).toEqual([]);
  });
  it('giorno con cambio d’ora (25 ore) resta tra 0 e 100', () => {
    const s = ses({ created_at: new Date(2026, 9, 25, 0).toISOString(), ts: new Date(2026, 9, 25, 23, 59).getTime() });
    const [seg] = sessionSegments(s, ['2026-10-25']);
    expect(seg.startPct).toBe(0);
    expect(seg.endPct).toBeGreaterThan(99);
    expect(seg.endPct).toBeLessThanOrEqual(100);
    expect(dayStart('2026-10-26') - dayStart('2026-10-25')).toBe(25 * 3_600_000);
  });
});

describe('reparti', () => {
  it('stripedRooms: il secondo reparto con lo stesso colore va a righe', () => {
    expect([...stripedRooms(ROOMS)]).toEqual(['rs']);
  });
  it('roomOf: reparto sconosciuto con nome e colore di riserva', () => {
    expect(roomOf(ROOMS, 'boh')).toEqual({ id: 'boh', n: 'boh', col: '#8f7c62' });
    expect(roomOf(ROOMS, null)).toEqual({ id: '—', n: '—', col: '#8f7c62' });
  });
  it('roomFill: colore pieno o righe', () => {
    const striped = stripedRooms(ROOMS);
    expect(roomFill(ROOMS[1], striped)).toBe('#2aa883');
    expect(roomFill(ROOMS[2], striped)).toContain('repeating-linear-gradient');
  });
  it('orderedRooms: ordine di ROOMS, poi gli sconosciuti, solo quelli con valore', () => {
    expect(orderedRooms({ rs: 1, boh: 2, prod: 3, ricerca: 0 }, ROOMS).map((r) => r.id)).toEqual(['prod', 'rs', 'boh']);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd ~/my-agent/farm/panels && npm test`
Expected: FAIL, `Failed to resolve import "./logic"`.

- [ ] **Step 5: Implement `src/logic.ts`**

```ts
import type { Room, SessionRow, TokenUsageRow } from './types';

// ---- giorni (sempre ora locale: token_usage.day è scritto con l'ora locale del Mac)

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y, m, d];
}

export function dayStart(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d).getTime();
}

export function nextDay(day: string): string {
  const [y, m, d] = parts(day);
  return dayKey(new Date(y, m - 1, d + 1));
}

export function lastNDays(today: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
  }
  return out;
}

export function fmtDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- token

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  if (k < 1000) return `${k}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

export type DayBar = { day: string; total: number; byRoom: Record<string, number> };

export function tokenDays(rows: TokenUsageRow[], days: string[]): DayBar[] {
  const map = new Map<string, DayBar>(days.map((d) => [d, { day: d, total: 0, byRoom: {} }]));
  for (const r of rows) {
    const bar = map.get(r.day);
    if (!bar) continue;
    const v = r.input + r.output;
    bar.byRoom[r.room] = (bar.byRoom[r.room] ?? 0) + v;
    bar.total += v;
  }
  return days.map((d) => map.get(d)!);
}

export type TokenSummary = { total: number; topRoom: string | null; cacheYield: number | null };

export function tokenSummary(rows: TokenUsageRow[]): TokenSummary {
  let total = 0, input = 0, read = 0, write = 0;
  const per: Record<string, number> = {};
  for (const r of rows) {
    const v = r.input + r.output;
    total += v;
    per[r.room] = (per[r.room] ?? 0) + v;
    input += r.input;
    read += r.cache_read;
    write += r.cache_write;
  }
  let topRoom: string | null = null;
  for (const [room, v] of Object.entries(per)) {
    if (v > 0 && (topRoom === null || v > per[topRoom])) topRoom = room;
  }
  // quota dell'input totale servita dalla cache (letture / tutto ciò che è entrato)
  const denom = input + read + write;
  return { total, topRoom, cacheYield: denom > 0 ? read / denom : null };
}

// ---- durate e raggruppamenti

export function durationMs(start: string, end: string | null): number | null {
  if (!end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return ms >= 0 ? ms : null;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function groupByDay<T>(rows: T[], when: (r: T) => number): { day: string; rows: T[] }[] {
  const sorted = [...rows].sort((a, b) => when(b) - when(a));
  const groups: { day: string; rows: T[] }[] = [];
  for (const r of sorted) {
    const day = dayKey(new Date(when(r)));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return groups;
}

// ---- timeline

export type Segment = { day: string; startPct: number; endPct: number; point: boolean };

export function sessionSegments(s: SessionRow, days: string[]): Segment[] {
  const end = s.ts;
  if (!s.created_at) {
    const day = dayKey(new Date(end));
    if (!days.includes(day)) return [];
    const ds = dayStart(day);
    const p = ((end - ds) / (dayStart(nextDay(day)) - ds)) * 100;
    return [{ day, startPct: p, endPct: p, point: true }];
  }
  // created_at viene dall'orologio del server, ts da quello del Mac: se
  // l'inizio risulta dopo la fine, è un istante, non una durata negativa
  const start = Math.min(Date.parse(s.created_at), end);
  const out: Segment[] = [];
  for (const day of days) {
    const ds = dayStart(day);
    const de = dayStart(nextDay(day)); // 23 o 25 ore nei giorni del cambio d'ora
    const a = Math.max(start, ds);
    const b = Math.min(end, de);
    if (b < a || (b === a && start !== end)) continue;
    out.push({ day, startPct: ((a - ds) / (de - ds)) * 100, endPct: ((b - ds) / (de - ds)) * 100, point: false });
  }
  return out;
}

// ---- reparti

const FALLBACK = '#8f7c62';

export function stripedRooms(rooms: Room[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const r of rooms) {
    const c = r.col.toLowerCase();
    if (seen.has(c)) out.add(r.id);
    else seen.add(c);
  }
  return out;
}

export function roomOf(rooms: Room[], id: string | null): Room {
  if (!id) return { id: '—', n: '—', col: FALLBACK };
  return rooms.find((r) => r.id === id) ?? { id, n: id, col: FALLBACK };
}

export function roomFill(room: Room, striped: Set<string>): string {
  if (!striped.has(room.id)) return room.col;
  return `repeating-linear-gradient(45deg, ${room.col} 0 3px, rgba(0,0,0,.4) 3px 5px)`;
}

export function orderedRooms(byRoom: Record<string, number>, rooms: Room[]): Room[] {
  const known = rooms.filter((r) => (byRoom[r.id] ?? 0) > 0);
  const unknown = Object.keys(byRoom)
    .filter((id) => byRoom[id] > 0 && !rooms.some((r) => r.id === id))
    .map((id) => roomOf(rooms, id));
  return [...known, ...unknown];
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd ~/my-agent/farm/panels && npm test && npm run typecheck`
Expected: tutti i test di `logic.test.ts` PASS; `tsc` senza errori.

- [ ] **Step 7: Commit**

```bash
cd ~/my-agent/farm && git add panels/package.json panels/package-lock.json panels/tsconfig.json panels/vite.config.ts panels/.gitignore panels/src/types.ts panels/src/logic.ts panels/src/logic.test.ts
git commit -m "feat(panels): progetto Vite+React+TS e logica pura dei pannelli STORICO"
```

---

### Task 6: Colonne verificate contro lo schema, query e `useTable`

**Files:**
- Modify: `farm/panels/src/types.ts` (aggiunge `COLUMNS`)
- Create: `farm/panels/src/queries.ts`, `farm/panels/src/useTable.ts`
- Test: `farm/panels/src/schema.test.ts`, `farm/panels/src/queries.test.ts`, `farm/panels/src/useTable.test.tsx`

**Interfaces:**
- Consumes: tipi di `types.ts` (Task 5), `supabase/schema.sql` (Task 4)
- Produces: `COLUMNS: { token_usage: readonly (keyof TokenUsageRow)[]; subagents: readonly (keyof SubagentRow)[]; sessions: readonly (keyof SessionRow)[] }`; `fetchTokenUsage(c: SupabaseClient, sinceDay: string): Promise<TokenUsageRow[]>`; `fetchSubagents(c: SupabaseClient, sinceIso: string): Promise<SubagentRow[]>`; `fetchSessions(c: SupabaseClient, sinceMs: number): Promise<SessionRow[]>`; `type TableState<T> = { data: T[] | null; error: boolean }`; `useTable<T>(fetcher: () => Promise<T[]>, active: boolean, intervalMs?: number): TableState<T>`

- [ ] **Step 1: Write the failing test** — `src/schema.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLUMNS } from './types';

const SQL = readFileSync(fileURLToPath(new URL('../../supabase/schema.sql', import.meta.url)), 'utf8');

function columnsOf(table: string): string[] {
  const m = SQL.match(new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`tabella ${table} non trovata in schema.sql`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('primary key') && !l.startsWith('unique') && !l.startsWith('--'))
    .map((l) => l.split(/\s+/)[0]);
}

describe('types.ts combacia con schema.sql', () => {
  for (const table of ['token_usage', 'subagents', 'sessions'] as const) {
    it(table, () => {
      expect([...COLUMNS[table]].sort()).toEqual(columnsOf(table).sort());
    });
  }
});
```

Run: `cd ~/my-agent/farm/panels && npm test -- schema`
Expected: FAIL, `COLUMNS` non esportato.

- [ ] **Step 2: Implement `COLUMNS`** — in fondo a `src/types.ts`

```ts
// Elenco delle colonne, verificato contro schema.sql da schema.test.ts.
// Il tipo Exact fa fallire tsc se un elenco non copre esattamente il suo tipo.
type Exact<T, L extends readonly (keyof T)[]> = [keyof T] extends [L[number]] ? L : never;
const cols = <T>() => <L extends readonly (keyof T)[]>(l: Exact<T, L>) => l;

export const COLUMNS = {
  token_usage: cols<TokenUsageRow>()(['user_id', 'day', 'room', 'input', 'output', 'cache_read', 'cache_write'] as const),
  subagents: cols<SubagentRow>()(['id', 'user_id', 'room', 'agent', 'task', 'created_at', 'finished_at', 'agent_id'] as const),
  sessions: cols<SessionRow>()(['id', 'user_id', 'transcript_path', 'status', 'room', 'node', 'ts', 'created_at'] as const),
};
```

Run: `cd ~/my-agent/farm/panels && npm test -- schema && npm run typecheck`
Expected: 3 PASS, `tsc` pulito. Controprova: togliere temporaneamente `'agent_id'` da `subagents` → `tsc` deve fallire; rimetterlo.

- [ ] **Step 3: Write the failing tests** — `src/queries.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchSessions, fetchSubagents, fetchTokenUsage } from './queries';

/** Client finto: registra la catena di chiamate e risolve con {data, error}. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'gte', 'order']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, ...args]); return builder; };
  }
  builder.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko);
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('query', () => {
  it('token_usage dal giorno indicato, ordinati per giorno', async () => {
    const { client, calls } = fakeClient({ data: [{ day: '2026-09-23' }], error: null });
    expect(await fetchTokenUsage(client, '2026-08-25')).toEqual([{ day: '2026-09-23' }]);
    expect(calls).toEqual([['from', 'token_usage'], ['select', '*'], ['gte', 'day', '2026-08-25'], ['order', 'day']]);
  });
  it('subagents dal più recente', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await fetchSubagents(client, '2026-09-17T00:00:00.000Z');
    expect(calls).toEqual([['from', 'subagents'], ['select', '*'], ['gte', 'created_at', '2026-09-17T00:00:00.000Z'], ['order', 'created_at', { ascending: false }]]);
  });
  it('sessions per ultimo segnale', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await fetchSessions(client, 1000)).toEqual([]);
    expect(calls).toEqual([['from', 'sessions'], ['select', '*'], ['gte', 'ts', 1000], ['order', 'ts']]);
  });
  it('un errore di Supabase diventa una promise rifiutata', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'JWT expired' } });
    await expect(fetchSessions(client, 0)).rejects.toEqual({ message: 'JWT expired' });
  });
});
```

Run: `cd ~/my-agent/farm/panels && npm test -- queries`
Expected: FAIL, `./queries` non risolto.

- [ ] **Step 4: Implement `src/queries.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionRow, SubagentRow, TokenUsageRow } from './types';

// Nessun filtro su user_id: ci pensa la RLS (solo le righe dell'utente loggato).
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data as T[] | null) ?? [];
}

export const fetchTokenUsage = (c: SupabaseClient, sinceDay: string) =>
  rows<TokenUsageRow>(c.from('token_usage').select('*').gte('day', sinceDay).order('day'));

export const fetchSubagents = (c: SupabaseClient, sinceIso: string) =>
  rows<SubagentRow>(c.from('subagents').select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }));

export const fetchSessions = (c: SupabaseClient, sinceMs: number) =>
  rows<SessionRow>(c.from('sessions').select('*').gte('ts', sinceMs).order('ts'));
```

Run: `cd ~/my-agent/farm/panels && npm test -- queries`
Expected: 4 PASS.

- [ ] **Step 5: Write the failing tests** — `src/useTable.test.tsx`

```tsx
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTable, type TableState } from './useTable';

let seen: TableState<number>;
function Probe({ fetcher, active }: { fetcher: () => Promise<number[]>; active: boolean }) {
  seen = useTable(fetcher, active, 60_000);
  return null;
}
const flush = () => act(async () => { await Promise.resolve(); });

describe('useTable', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('non interroga finché non è attivo', async () => {
    const f = vi.fn().mockResolvedValue([1]);
    render(<Probe fetcher={f} active={false} />);
    await flush();
    expect(f).not.toHaveBeenCalled();
    expect(seen).toEqual({ data: null, error: false });
  });

  it('carica subito, poi ogni 60s, e si ferma quando non è più attivo', async () => {
    const f = vi.fn().mockResolvedValue([1]);
    const { rerender } = render(<Probe fetcher={f} active={true} />);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ data: [1], error: false });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(f).toHaveBeenCalledTimes(2);
    rerender(<Probe fetcher={f} active={false} />);
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('dopo un errore tiene l’ultimo dato buono e segnala errore; al giro buono torna pulito', async () => {
    const f = vi.fn().mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error('giù')).mockResolvedValueOnce([2]);
    render(<Probe fetcher={f} active={true} />);
    await flush();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(seen).toEqual({ data: [1], error: true });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(seen).toEqual({ data: [2], error: false });
  });
});
```

Run: `cd ~/my-agent/farm/panels && npm test -- useTable`
Expected: FAIL, `./useTable` non risolto.

- [ ] **Step 6: Implement `src/useTable.ts`**

```ts
import { useEffect, useRef, useState } from 'react';

export type TableState<T> = { data: T[] | null; error: boolean };

/** Interroga subito quando `active` diventa true, poi ogni intervalMs; si ferma
 *  quando torna false o il componente sparisce. Un errore non cancella i dati
 *  già mostrati: alza solo `error`. */
export function useTable<T>(fetcher: () => Promise<T[]>, active: boolean, intervalMs = 60_000): TableState<T> {
  const [state, setState] = useState<TableState<T>>({ data: null, error: false });
  const latest = useRef(fetcher);
  latest.current = fetcher;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const run = () => {
      latest.current().then(
        (data) => { if (alive) setState({ data, error: false }); },
        () => { if (alive) setState((s) => ({ data: s.data, error: true })); },
      );
    };
    run();
    const id = setInterval(run, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [active, intervalMs]);

  return state;
}
```

- [ ] **Step 7: Run to verify all pass**

Run: `cd ~/my-agent/farm/panels && npm test && npm run typecheck`
Expected: tutti PASS, `tsc` pulito.

- [ ] **Step 8: Commit**

```bash
cd ~/my-agent/farm && git add panels/src/types.ts panels/src/schema.test.ts panels/src/queries.ts panels/src/queries.test.ts panels/src/useTable.ts panels/src/useTable.test.tsx
git commit -m "feat(panels): colonne verificate contro lo schema, query Supabase e hook useTable"
```

---

### Task 7: I tre pannelli

**Prima di scrivere `TokenHistory`: caricare la skill `dataviz`** (`Skill: dataviz`) e applicarne le regole di marca, scala ed etichette, restando nei token colore della Baracca (`--ink-dim`, `--surface-hi`, `--gold`) e nei colori dei reparti.

**Files:**
- Create: `farm/panels/src/PanelHeader.tsx`, `farm/panels/src/TokenHistory.tsx`, `farm/panels/src/SubagentLog.tsx`, `farm/panels/src/SessionTimeline.tsx`
- Test: `farm/panels/src/panels.test.tsx`

**Interfaces:**
- Consumes: `logic.ts` (Task 5), `TableState` (Task 6), tipi (Task 5)
- Produces:
  - `PanelHeader(props: { title: string; sub: string; error: boolean })`
  - `TokenHistory(props: { state: TableState<TokenUsageRow>; rooms: Room[]; days: string[] })`
  - `SubagentLog(props: { state: TableState<SubagentRow>; rooms: Room[] })`
  - `SessionTimeline(props: { state: TableState<SessionRow>; rooms: Room[]; days: string[] })`
  - Classi CSS usate (definite nel Task 9): `dp`, `c12`, `c6`, `dtag real|err`, `stats`, `empty`, `tk-chart`, `tk-axis`, `tk-lbl`, `tk-bar`, `on`, `tk-detail`, `sa-list`, `sa-day`, `sa-row`, `sa-room`, `sa-task`, `sa-run`, `tl-row`, `tl-day`, `tl-track`, `tl-seg`, `tl-pt`, `tl-axis`

- [ ] **Step 1: Write the failing tests** — `src/panels.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionTimeline } from './SessionTimeline';
import { SubagentLog } from './SubagentLog';
import { TokenHistory } from './TokenHistory';
import type { Room, SessionRow, SubagentRow, TokenUsageRow } from './types';

const ROOMS: Room[] = [
  { id: 'ricerca', n: 'RICERCA', col: '#229fb3' },
  { id: 'prod', n: 'OFFICINA', col: '#2aa883' },
  { id: 'rs', n: 'LABORATORIO', col: '#229fb3' },
];
const DAYS = ['2026-09-22', '2026-09-23'];
const tok = (day: string, room: string, input: number, output: number, cache_read = 0): TokenUsageRow =>
  ({ user_id: 'u', day, room, input, output, cache_read, cache_write: 0 });
const sub = (p: Partial<SubagentRow>): SubagentRow =>
  ({ id: 1, user_id: 'u', room: 'prod', agent: 'produzione-1', task: 'scrive i test', created_at: new Date(2026, 8, 23, 10).toISOString(), finished_at: null, agent_id: null, ...p });

describe('TokenHistory', () => {
  it('caricamento', () => {
    render(<TokenHistory state={{ data: null, error: false }} rooms={ROOMS} days={DAYS} />);
    expect(screen.getByText('caricamento…')).toBeTruthy();
  });
  it('sintesi, righe per il reparto col colore doppio, dettaglio al focus', () => {
    const { container } = render(<TokenHistory state={{ data: [tok('2026-09-22', 'prod', 0, 2000, 3000), tok('2026-09-23', 'rs', 0, 500)], error: false }} rooms={ROOMS} days={DAYS} />);
    expect(screen.getByText('2.5k')).toBeTruthy();            // totale
    expect(screen.getByText('OFFICINA')).toBeTruthy();        // reparto top
    expect(screen.getByText('100%')).toBeTruthy();            // 3000 / (0 input + 3000 letti + 0 scritti)
    expect(container.querySelector('pattern#tk-stripe-rs')).toBeTruthy();
    const bars = container.querySelectorAll('g.tk-bar');
    expect(bars).toHaveLength(2);
    fireEvent.focus(bars[0]);
    expect(container.querySelector('.tk-detail')!.textContent).toContain('22/09');
  });
  it('tutto a zero: nessun NaN nel disegno, resa cache "—"', () => {
    const { container } = render(<TokenHistory state={{ data: [], error: false }} rooms={ROOMS} days={DAYS} />);
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
  it('errore con dati vecchi: li tiene e mostra ERRORE', () => {
    render(<TokenHistory state={{ data: [tok('2026-09-23', 'prod', 0, 100)], error: true }} rooms={ROOMS} days={DAYS} />);
    expect(screen.getByText('ERRORE')).toBeTruthy();
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);   // totale, asse e dettaglio
  });
});

describe('SubagentLog', () => {
  it('vuoto: dice da quando parte il diario', () => {
    render(<SubagentLog state={{ data: [], error: false }} rooms={ROOMS} />);
    expect(screen.getByText(/Il diario parte dal 23\/09/)).toBeTruthy();
  });
  it('in corso e durata chiusa, compito completo nel title', () => {
    const start = new Date(2026, 8, 23, 10);
    render(<SubagentLog state={{ data: [
      sub({ id: 1 }),
      sub({ id: 2, room: 'rs', task: 'un compito molto lungo', finished_at: new Date(start.getTime() + 192_000).toISOString() }),
    ], error: false }} rooms={ROOMS} />);
    expect(screen.getByText('in corso')).toBeTruthy();
    expect(screen.getByText('3m 12s')).toBeTruthy();
    expect(screen.getByTitle('un compito molto lungo')).toBeTruthy();
    expect(screen.getByText('LABORATORIO')).toBeTruthy();
  });
});

describe('SessionTimeline', () => {
  it('una riga per giorno, la più recente in alto; sessione senza inizio come punto', () => {
    const s: SessionRow = { id: 1, user_id: 'u', transcript_path: 't', status: null, room: 'prod', node: null, ts: new Date(2026, 8, 23, 18).getTime(), created_at: null };
    const { container } = render(<SessionTimeline state={{ data: [s], error: false }} rooms={ROOMS} days={DAYS} />);
    const labels = [...container.querySelectorAll('.tl-day')].map((e) => e.textContent);
    expect(labels).toEqual(['23/09', '22/09']);
    const pt = container.querySelector('.tl-pt') as HTMLElement;
    expect(pt.title).toContain('inizio non registrato');
    expect(pt.style.left).toBe('75%');
  });
  it('sessione oltre la mezzanotte: due barre', () => {
    const s: SessionRow = { id: 1, user_id: 'u', transcript_path: 't', status: null, room: 'prod', node: null, ts: new Date(2026, 8, 23, 6).getTime(), created_at: new Date(2026, 8, 22, 18).toISOString() };
    const { container } = render(<SessionTimeline state={{ data: [s], error: false }} rooms={ROOMS} days={DAYS} />);
    expect(container.querySelectorAll('.tl-seg')).toHaveLength(2);
  });
});
```

Run: `cd ~/my-agent/farm/panels && npm test -- panels`
Expected: FAIL, moduli dei componenti non risolti.

- [ ] **Step 2: Implement `src/PanelHeader.tsx`**

```tsx
export function PanelHeader({ title, sub, error }: { title: string; sub: string; error: boolean }) {
  return (
    <h4>
      {title} <span className={`dtag ${error ? 'err' : 'real'}`}>{error ? 'ERRORE' : 'REALE'}</span>
      <em>{sub}</em>
    </h4>
  );
}
```

- [ ] **Step 3: Implement `src/TokenHistory.tsx`**

```tsx
import { useState } from 'react';
import { fmtDay, fmtTokens, orderedRooms, roomOf, stripedRooms, tokenDays, tokenSummary } from './logic';
import { PanelHeader } from './PanelHeader';
import type { Room, TokenUsageRow } from './types';
import type { TableState } from './useTable';

const W = 600, H = 150, TOP = 14, BASE = H - 18;

export function TokenHistory({ state, rooms, days }: { state: TableState<TokenUsageRow>; rooms: Room[]; days: string[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const striped = stripedRooms(rooms);
  const header = <PanelHeader title="CONSUMO TOKEN" sub={`ultimi ${days.length} giorni · input + output`} error={state.error} />;

  if (state.data === null) {
    return <div className="dp c12">{header}<div className="empty">{state.error ? 'dati non raggiungibili' : 'caricamento…'}</div></div>;
  }

  const bars = tokenDays(state.data, days);
  const sum = tokenSummary(state.data);
  const max = Math.max(1, ...bars.map((b) => b.total));
  const slot = W / days.length;
  const barW = slot * 0.7;
  const y = (v: number) => BASE - (v / max) * (BASE - TOP);
  const shown = bars[sel ?? bars.length - 1];
  const fill = (r: Room) => (striped.has(r.id) ? `url(#tk-stripe-${r.id})` : r.col);
  const ticks = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];

  return (
    <div className="dp c12">
      {header}
      <div className="stats">
        <div>totale<b>{fmtTokens(sum.total)}</b></div>
        <div>reparto top<b>{sum.topRoom ? roomOf(rooms, sum.topRoom).n : '—'}</b></div>
        <div>resa cache<b>{sum.cacheYield === null ? '—' : `${Math.round(sum.cacheYield * 100)}%`}</b></div>
      </div>
      <svg className="tk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Consumo token per giorno, ultimi ${days.length} giorni`}>
        <defs>
          {rooms.filter((r) => striped.has(r.id)).map((r) => (
            <pattern key={r.id} id={`tk-stripe-${r.id}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill={r.col} />
              <rect width="2" height="4" fill="rgba(0,0,0,.4)" />
            </pattern>
          ))}
        </defs>
        <text className="tk-lbl" x="0" y="10">{fmtTokens(max)}</text>
        <line className="tk-axis" x1="0" x2={W} y1={BASE} y2={BASE} />
        {bars.map((b, i) => {
          let acc = 0;
          const x = i * slot + (slot - barW) / 2;
          return (
            <g key={b.day} className={`tk-bar${i === sel ? ' on' : ''}`} tabIndex={0}
               aria-label={`${fmtDay(b.day)}: ${fmtTokens(b.total)} token`}
               onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)}>
              <rect x={i * slot} y={0} width={slot} height={BASE} fill="transparent" />
              {orderedRooms(b.byRoom, rooms).map((r) => {
                const v = b.byRoom[r.id];
                const top = y(acc + v), bottom = y(acc);
                acc += v;
                return <rect key={r.id} x={x} y={top} width={barW} height={Math.max(0, bottom - top)} fill={fill(r)} />;
              })}
            </g>
          );
        })}
        {ticks.map((i) => (
          <text key={i} className="tk-lbl" x={i * slot + slot / 2} y={H - 4} textAnchor="middle">{fmtDay(days[i])}</text>
        ))}
      </svg>
      <div className="tk-detail">
        <b>{fmtDay(shown.day)}</b>
        {shown.total === 0
          ? <span>nessun consumo registrato</span>
          : <>
              <span>{fmtTokens(shown.total)}</span>
              {orderedRooms(shown.byRoom, rooms).map((r) => (
                <span key={r.id}><i style={{ background: r.col }} />{r.n} {fmtTokens(shown.byRoom[r.id])}</span>
              ))}
            </>}
      </div>
    </div>
  );
}
```

(Nel dettaglio il quadratino usa il colore pieno: le righe servono solo dentro le barre impilate, dove due colori uguali si toccano; qui accanto c'è il nome del reparto.)

- [ ] **Step 4: Implement `src/SubagentLog.tsx`**

```tsx
import { durationMs, fmtClock, fmtDay, formatDuration, groupByDay, roomFill, roomOf, stripedRooms } from './logic';
import { PanelHeader } from './PanelHeader';
import { HISTORY_SINCE, type Room, type SubagentRow } from './types';
import type { TableState } from './useTable';

export function SubagentLog({ state, rooms }: { state: TableState<SubagentRow>; rooms: Room[] }) {
  const header = <PanelHeader title="DIARIO SUBAGENTI" sub="ultimi 7 giorni" error={state.error} />;
  if (state.data === null) {
    return <div className="dp c6">{header}<div className="empty">{state.error ? 'dati non raggiungibili' : 'caricamento…'}</div></div>;
  }
  if (state.data.length === 0) {
    return <div className="dp c6">{header}<div className="empty">Il diario parte dal {fmtDay(HISTORY_SINCE)}: ancora nessun subagente registrato.</div></div>;
  }
  const striped = stripedRooms(rooms);
  return (
    <div className="dp c6">
      {header}
      <div className="sa-list">
        {groupByDay(state.data, (r) => Date.parse(r.created_at)).map((g) => (
          <div key={g.day}>
            <div className="sa-day">{fmtDay(g.day)}</div>
            {g.rows.map((r) => {
              const room = roomOf(rooms, r.room);
              const ms = durationMs(r.created_at, r.finished_at);
              return (
                <div key={r.id} className="sa-row">
                  <span>{fmtClock(Date.parse(r.created_at))}</span>
                  <span className="sa-room" style={{ background: roomFill(room, striped) }}>{room.n}</span>
                  <span>{r.agent ?? '—'}</span>
                  <span className="sa-task" title={r.task ?? ''}>{r.task ?? '—'}</span>
                  {ms === null ? <span className="sa-run">in corso</span> : <span>{formatDuration(ms)}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/SessionTimeline.tsx`**

```tsx
import { fmtClock, fmtDay, roomFill, roomOf, sessionSegments, stripedRooms } from './logic';
import { PanelHeader } from './PanelHeader';
import type { Room, SessionRow } from './types';
import type { TableState } from './useTable';

export function SessionTimeline({ state, rooms, days }: { state: TableState<SessionRow>; rooms: Room[]; days: string[] }) {
  const header = <PanelHeader title="TIMELINE SESSIONI" sub="ultimi 7 giorni · 0-24h" error={state.error} />;
  if (state.data === null) {
    return <div className="dp c6">{header}<div className="empty">{state.error ? 'dati non raggiungibili' : 'caricamento…'}</div></div>;
  }
  const striped = stripedRooms(rooms);
  const segs = state.data.flatMap((s) => sessionSegments(s, days).map((seg) => ({ seg, s })));
  return (
    <div className="dp c6">
      {header}
      {[...days].reverse().map((day) => (
        <div key={day} className="tl-row">
          <span className="tl-day">{fmtDay(day)}</span>
          <div className="tl-track">
            {segs.filter(({ seg }) => seg.day === day).map(({ seg, s }) => {
              const room = roomOf(rooms, s.room);
              if (seg.point) {
                return <span key={s.id} className="tl-pt" style={{ left: `${seg.startPct}%` }}
                             title={`${room.n} · inizio non registrato · ultimo segnale ${fmtClock(s.ts)}`} />;
              }
              return <span key={s.id} className="tl-seg"
                           style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%`, background: roomFill(room, striped) }}
                           title={`${room.n} · ${fmtClock(Date.parse(s.created_at!))}–${fmtClock(s.ts)}`} />;
            })}
          </div>
        </div>
      ))}
      <div className="tl-axis">
        {[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run to verify all pass**

Run: `cd ~/my-agent/farm/panels && npm test && npm run typecheck`
Expected: tutti PASS, `tsc` pulito.

- [ ] **Step 7: Commit**

```bash
cd ~/my-agent/farm && git add panels/src/PanelHeader.tsx panels/src/TokenHistory.tsx panels/src/SubagentLog.tsx panels/src/SessionTimeline.tsx panels/src/panels.test.tsx
git commit -m "feat(panels): pannelli consumo token, diario subagenti, timeline sessioni"
```

---

### Task 8: `Storico`, `mountStorico`, bundle e route del server

**Files:**
- Create: `farm/panels/src/Storico.tsx`, `farm/panels/src/mount.tsx`
- Create (generato): `farm/panels/dist/panels.js`
- Modify: `farm/server.py` (`do_GET`, prima del ramo `/assets/`)
- Test: `farm/panels/src/mount.test.tsx`, `farm/test_server.py`

**Interfaces:**
- Consumes: componenti (Task 7), `useTable` e query (Task 6), `lastNDays`, `dayStart` (Task 5)
- Produces: `Storico(props: { client: SupabaseClient; rooms: Room[]; active: boolean; now?: () => Date })`; `mountStorico(el: HTMLElement, client: SupabaseClient, opts: { rooms: Room[] }): StoricoHandle` con `StoricoHandle = { setActive(active: boolean): void; unmount(): void }`; `window.mountStorico`; route `GET /panels/panels.js` → `panels/dist/panels.js`, `text/javascript`

- [ ] **Step 1: Write the failing test** — `src/mount.test.tsx`

```tsx
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mountStorico } from './mount';

function fakeClient() {
  const from = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'order']) builder[m] = () => builder;
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  from.mockImplementation(() => builder);
  return { client: { from } as unknown as SupabaseClient, from };
}

describe('mountStorico', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('si registra su window', () => {
    expect(window.mountStorico).toBe(mountStorico);
  });

  it('monta il gruppo STORICO, interroga solo quando attivo, si ferma quando no', async () => {
    const el = document.createElement('div');
    const { client, from } = fakeClient();
    let h!: ReturnType<typeof mountStorico>;
    await act(async () => { h = mountStorico(el, client, { rooms: [{ id: 'prod', n: 'OFFICINA', col: '#2aa883' }] }); });
    expect(el.querySelector('.dgroup')!.textContent).toBe('STORICO');
    expect(el.querySelectorAll('.dp')).toHaveLength(3);
    expect(from).not.toHaveBeenCalled();

    await act(async () => { h.setActive(true); });
    expect(from.mock.calls.map((c) => c[0]).sort()).toEqual(['sessions', 'subagents', 'token_usage']);

    await act(async () => { h.setActive(false); });
    from.mockClear();
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(from).not.toHaveBeenCalled();
    await act(async () => { h.unmount(); });
  });
});
```

Run: `cd ~/my-agent/farm/panels && npm test -- mount`
Expected: FAIL, `./mount` non risolto.

- [ ] **Step 2: Implement `src/Storico.tsx`**

```tsx
import type { SupabaseClient } from '@supabase/supabase-js';
import { dayStart, lastNDays } from './logic';
import { fetchSessions, fetchSubagents, fetchTokenUsage } from './queries';
import { SessionTimeline } from './SessionTimeline';
import { SubagentLog } from './SubagentLog';
import { TokenHistory } from './TokenHistory';
import type { Room } from './types';
import { useTable } from './useTable';

export function Storico({ client, rooms, active, now = () => new Date() }:
  { client: SupabaseClient; rooms: Room[]; active: boolean; now?: () => Date }) {
  const today = now();
  const days30 = lastNDays(today, 30);
  const days7 = lastNDays(today, 7);
  const since7 = dayStart(days7[0]);
  const tokens = useTable(() => fetchTokenUsage(client, days30[0]), active);
  const subs = useTable(() => fetchSubagents(client, new Date(since7).toISOString()), active);
  const sess = useTable(() => fetchSessions(client, since7), active);
  return (
    <>
      <div className="dgroup">STORICO</div>
      <TokenHistory state={tokens} rooms={rooms} days={days30} />
      <SubagentLog state={subs} rooms={rooms} />
      <SessionTimeline state={sess} rooms={rooms} days={days7} />
    </>
  );
}
```

- [ ] **Step 3: Implement `src/mount.tsx`**

```tsx
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRoot } from 'react-dom/client';
import { Storico } from './Storico';
import type { Room } from './types';

export type StoricoHandle = { setActive(active: boolean): void; unmount(): void };

/** Unico punto d'ingresso dal vanilla di baracca.html. Il client arriva già
 *  autenticato: niente secondo login, niente seconda connessione. */
export function mountStorico(el: HTMLElement, client: SupabaseClient, opts: { rooms: Room[] }): StoricoHandle {
  const root = createRoot(el);
  const render = (active: boolean) => root.render(<Storico client={client} rooms={opts.rooms} active={active} />);
  render(false);
  return { setActive: render, unmount: () => root.unmount() };
}

declare global {
  interface Window { mountStorico?: typeof mountStorico }
}
window.mountStorico = mountStorico;
```

- [ ] **Step 4: Run tests and build**

Run: `cd ~/my-agent/farm/panels && npm test && npm run typecheck && npm run build`
Expected: tutti PASS, `tsc` pulito, build che produce `dist/panels.js`.

Run: `cd ~/my-agent/farm/panels && ls -la dist && grep -c "mountStorico" dist/panels.js && ! grep -q "process.env" dist/panels.js && echo "nessun process.env" && ! grep -q "createClient" dist/panels.js && echo "supabase-js non incluso"`
Expected: solo `panels.js` in `dist/`; almeno 1 occorrenza di `mountStorico`; stampa `nessun process.env` e `supabase-js non incluso`.

- [ ] **Step 5: Write the failing server test** — in `test_server.py`, prima di `def main():`

```python
def test_panels_route_serves_only_the_bundle():
    import tempfile
    import threading
    import urllib.error
    import urllib.request
    from http.server import HTTPServer
    import server as srv
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "panels", "dist"))
    with open(os.path.join(tmp, "panels", "dist", "panels.js"), "w") as f:
        f.write("window.x=1;")
    with open(os.path.join(tmp, "panels", "package.json"), "w") as f:
        f.write("{}")
    old_here = srv.HERE
    srv.HERE = tmp
    httpd = HTTPServer(("127.0.0.1", 0), srv.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % httpd.server_address[1]
    try:
        with urllib.request.urlopen(base + "/panels/panels.js?v=3") as r:
            assert r.status == 200, r.status
            assert r.headers["Content-Type"] == "text/javascript", r.headers["Content-Type"]
            assert r.read() == b"window.x=1;"
        for bad in ("/panels/package.json", "/panels/dist/panels.js", "/panels/../server.py", "/panels/"):
            try:
                urllib.request.urlopen(base + bad)
                assert False, "doveva essere 404: " + bad
            except urllib.error.HTTPError as e:
                assert e.code == 404, (bad, e.code)
    finally:
        httpd.shutdown()
        httpd.server_close()
        srv.HERE = old_here
```

Aggiungere `    test_panels_route_serves_only_the_bundle()` dentro `main()` di `test_server.py`.

Run: `cd ~/my-agent/farm && python3 test_server.py`
Expected: FAIL, `HTTP Error 404` su `/panels/panels.js?v=3`.

- [ ] **Step 6: Implement the route** in `server.py`, dentro `do_GET`, subito prima di `elif path.startswith("/assets/"):`

```python
        elif path == "/panels/panels.js":
            # isola React dei pannelli STORICO: solo il bundle, nient'altro di panels/
            self._send_file(os.path.join("panels", "dist", "panels.js"), "text/javascript")
```

Run: `cd ~/my-agent/farm && python3 test_server.py`
Expected: `server.py: tutti i controlli passati`

- [ ] **Step 7: Commit**

```bash
cd ~/my-agent/farm && git add panels/src/Storico.tsx panels/src/mount.tsx panels/src/mount.test.tsx panels/dist/panels.js server.py test_server.py
git commit -m "feat(panels): mountStorico, bundle panels.js e route del server"
```

---

### Task 9: Integrazione in `baracca.html`

**Files:**
- Modify: `farm/baracca.html` (CSS dopo la regola `.dgroup{…}`; `<script>` dopo quello di supabase-js; contenitore in fondo a `#dashv`; JS vicino a `supaClient`, in `attemptLogin`, `ensureAuthThenSubscribe`, `showView`)
- Modify: `farm/README.md` (sezione build dei pannelli)

**Interfaces:**
- Consumes: `window.mountStorico` e `StoricoHandle` (Task 8), `ROOMS`, `VIEW`, `supaClient` (esistenti)
- Produces: `var STORICO` (handle o `null`), `function mountStoricoOnce()`

- [ ] **Step 1: Snapshot of untouched functions** (prova che il canvas non cambia)

Run:
```bash
cd ~/my-agent/farm && python3 - <<'EOF' > /tmp/baracca_fn_before.txt
import hashlib, re
src = open("baracca.html", encoding="utf-8").read()
for name in ["drawUltron","drawCrew","drawSpec","goTo","stepEntity","simulate","applyLive","subscribeRealtime","renderDashLive","renderVault","drawWorld","poll"]:
    m = re.search(r"\nfunction " + name + r"\(.*?\n}\n", src, re.S)
    print(name, hashlib.md5(m.group(0).encode()).hexdigest() if m else "MANCANTE")
EOF
cat /tmp/baracca_fn_before.txt
```
Expected: 12 righe con un hash ciascuna, nessuna `MANCANTE`.

- [ ] **Step 2: Add the script tag**

Subito dopo la riga
`<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>`
aggiungere:

```html
<script src="/panels/panels.js"></script>
```

- [ ] **Step 3: Add the container**

Nel `<div class="dashv" id="dashv">`, dopo la riga del pannello VINLAND (`…<div class="bars" id="dVinJobs"></div></div>`) e prima del `</div>` che chiude `#dashv`, aggiungere:

```html
    <!-- isola React (panels/): il vanilla non tocca mai niente qui dentro -->
    <div id="storico"></div>
```

- [ ] **Step 4: Add the CSS** subito dopo la regola `.dgroup{…}` (quella che termina con `text-shadow:1px 1px 0 var(--bg);}`)

```css
  /* ---- storico: isola React (panels/), stessi token della sala comando ---- */
  #storico{display:contents;}            /* i figli React diventano celle della griglia di #dashv */
  .dtag.err{color:var(--red);border-color:var(--red);}
  .tk-chart{display:block;width:100%;height:auto;margin-top:6px;}
  .tk-axis{stroke:var(--surface-hi);stroke-width:1;}
  .tk-lbl{fill:var(--ink-dim);font-family:var(--arc);font-size:9px;}
  .tk-bar{cursor:pointer;outline:none;}
  .tk-bar.on rect+rect,.tk-bar:focus-visible rect+rect{filter:brightness(1.3);}
  .tk-bar:focus-visible rect:first-child{stroke:var(--gold);stroke-width:1;}
  .tk-detail{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-size:12px;color:var(--ink-soft);}
  .tk-detail i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:0;}
  .sa-list{max-height:260px;overflow-y:auto;}
  .sa-day{margin:8px 0 4px;font-family:var(--arc);font-size:8px;color:var(--gold);letter-spacing:.1em;}
  .sa-row{display:grid;grid-template-columns:38px auto minmax(0,.8fr) minmax(0,2fr) auto;gap:8px;align-items:center;
      padding:3px 0;border-bottom:1px solid var(--surface);font-size:12px;color:var(--ink-soft);}
  .sa-room{padding:2px 5px;border-radius:4px;font-family:var(--arc);font-size:7px;color:var(--bg);}
  .sa-task{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .sa-run{color:var(--green);}
  .tl-row{display:grid;grid-template-columns:38px 1fr;gap:8px;align-items:center;margin:5px 0;}
  .tl-day{font-size:11px;color:var(--ink-dim);}
  .tl-track{position:relative;height:12px;background:var(--surface);border-radius:3px;}
  .tl-seg{position:absolute;top:1px;bottom:1px;min-width:2px;border-radius:2px;}
  .tl-pt{position:absolute;top:2px;width:8px;height:8px;margin-left:-4px;border:1px dashed var(--ink);border-radius:50%;}
  .tl-axis{position:relative;height:14px;margin-left:46px;}
  .tl-axis span{position:absolute;transform:translateX(-50%);font-size:10px;color:var(--ink-dim);}
  .dp .empty{font-size:12px;color:var(--ink-dim);}
```

- [ ] **Step 5: Add the mount JS**

Sostituire `var supaClient = null;` con:

```js
var supaClient = null;
/* isola React dei pannelli STORICO (panels/dist/panels.js): montata una volta,
   dopo l'autenticazione. Se il bundle manca o esplode, la Baracca resta com'è. */
var STORICO = null;
```

Subito dopo la funzione `hideLoginGate(){…}` aggiungere:

```js
function mountStoricoOnce(){
  if(STORICO || !supaClient || !window.mountStorico) return;
  try{
    STORICO = window.mountStorico(document.getElementById("storico"), supaClient, {
      rooms: ROOMS.map(function(r){ return {id:r.id, n:r.n, col:r.c}; })
    });
    STORICO.setActive(VIEW === "dash");
  }catch(e){ STORICO = null; }
}
```

In `attemptLogin`, sostituire
```js
    hideLoginGate();
    subscribeRealtime();
```
con
```js
    hideLoginGate();
    subscribeRealtime();
    mountStoricoOnce();
```

In `ensureAuthThenSubscribe`, sostituire
```js
    if(res.data && res.data.session){
      subscribeRealtime();
```
con
```js
    if(res.data && res.data.session){
      subscribeRealtime();
      mountStoricoOnce();
```

In `showView`, subito dopo `document.body.dataset.view = v;` aggiungere:

```js
  if(STORICO) STORICO.setActive(v === "dash");
```

- [ ] **Step 6: Verify syntax and untouched functions**

Run:
```bash
cd ~/my-agent/farm && python3 - <<'EOF'
import re
src = open("baracca.html", encoding="utf-8").read()
scripts = re.findall(r"<script>(.*?)</script>", src, re.S)
open("/tmp/baracca_inline.js", "w").write("\n".join(scripts))
EOF
node --check /tmp/baracca_inline.js && echo "JS ok"
python3 - <<'EOF' > /tmp/baracca_fn_after.txt
import hashlib, re
src = open("baracca.html", encoding="utf-8").read()
for name in ["drawUltron","drawCrew","drawSpec","goTo","stepEntity","simulate","applyLive","subscribeRealtime","renderDashLive","renderVault","drawWorld","poll"]:
    m = re.search(r"\nfunction " + name + r"\(.*?\n}\n", src, re.S)
    print(name, hashlib.md5(m.group(0).encode()).hexdigest() if m else "MANCANTE")
EOF
diff /tmp/baracca_fn_before.txt /tmp/baracca_fn_after.txt && echo "canvas invariato"
python3 test_server.py
```
Expected: `JS ok`, `canvas invariato`, `server.py: tutti i controlli passati`.

- [ ] **Step 7: Verify in Chrome that a missing bundle changes nothing**

Il server live gira dalla cartella principale `~/my-agent/farm` sulla 8795. Per provare il worktree: annotare il PID (`lsof -ti :8795`), fermarlo (`kill <pid>`), avviare `python3 server.py` dalla root del worktree in background, aprire `http://127.0.0.1:8795/baracca.html` in Chrome (stessa origine: la sessione Supabase già loggata resta valida; **mai inserire una password**, se serve il login lo fa Vincent).

1. Con `dist/panels.js` presente: BASE si muove, DASHBOARD mostra il gruppo `STORICO` con i tre pannelli; console senza errori della pagina.
2. Rinominare temporaneamente `panels/dist/panels.js` in `panels.js.off`, ricaricare con Cmd+Shift+R: BASE e DASHBOARD funzionano come prima, niente gruppo STORICO, un solo 404 in console per `panels.js`. Rimettere il nome giusto.

- [ ] **Step 8: README**

Aggiungere a `farm/README.md` una sezione:

```markdown
## Pannelli STORICO (React)

I pannelli del gruppo STORICO in DASHBOARD sono un'isola React in `panels/`, servita come un solo file `panels/dist/panels.js` (committato: la Baracca parte senza Node).

Dopo ogni modifica a `panels/src/`:

    cd panels && npm install && npm test && npm run build

e committare anche `panels/dist/panels.js`. Senza build la pagina continua a servire la versione vecchia.
```

- [ ] **Step 9: Commit**

```bash
cd ~/my-agent/farm && git add baracca.html README.md
git commit -m "feat: gruppo STORICO in DASHBOARD, isola React montata dopo il login"
```

---

### Task 10: Database vero, verifica dal vivo, rifinitura, consegna

Questo task si esegue **nella sessione principale**, non da un subagente: tocca il database di produzione, il browser di Vincent e `~/my-agent/.claude/settings.json`.

**Files:**
- Modify: nessun file del repo salvo i fix che emergono (ognuno col suo test e commit)
- Modify (dopo il merge, con conferma): `~/my-agent/.claude/settings.json`

- [ ] **Step 1: Apply the migration**

In Chrome, dashboard Supabase del progetto "rblvince's Project" → SQL Editor. Metodo già collaudato nel Giro 1: incollare lo script **appiattito su una riga sola** (l'editor Monaco perde il focus sulle righe multiple):

```sql
alter table sessions add column created_at timestamptz; alter table sessions alter column created_at set default now(); alter table subagents add column finished_at timestamptz; alter table subagents add column agent_id text;
```

Verifica via REST con la service key letta da `~/.config/baracca/.env` (mai stampata):

```bash
set -a; . ~/.config/baracca/.env; set +a
H=(-H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY")
curl -s "$SUPABASE_URL/rest/v1/subagents?select=id,finished_at,agent_id&limit=1" "${H[@]}"; echo
curl -s "$SUPABASE_URL/rest/v1/sessions?select=id,created_at&order=ts.desc&limit=3" "${H[@]}"; echo
```
Expected: nessun errore di colonna; le sessioni esistenti con `created_at: null`. Se la migrazione non è stata applicata il 2026-09-23, aggiornare `HISTORY_SINCE` in `panels/src/types.ts`, rifare test e build, committare.

- [ ] **Step 2: Hooks against the real database, from the worktree**

```bash
cd <worktree>/hooks && python3 -c "
import session_track as st
st.spawn_subagent('prod', 'produzione-1', 'prova diario Giro 2')
st.claim_subagent('prova-ag-1')
st.reap_subagent('prova-ag-1')
st.update_session('/tmp/prova-giro2.jsonl', status='thinking', room='rs')
"
set -a; . ~/.config/baracca/.env; set +a
curl -s "$SUPABASE_URL/rest/v1/subagents?agent_id=eq.prova-ag-1&select=task,agent_id,created_at,finished_at" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"; echo
curl -s "$SUPABASE_URL/rest/v1/sessions?transcript_path=eq./tmp/prova-giro2.jsonl&select=created_at,ts" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"; echo
```
Expected: la riga del subagente ha `task`, `agent_id: prova-ag-1` e sia `created_at` sia `finished_at` valorizzati; la sessione di prova ha `created_at` non nullo.

- [ ] **Step 3: Panels on real data**

Con il server del worktree sulla 8795 (Task 9 Step 7), in Chrome aprire DASHBOARD:
- CONSUMO TOKEN: il totale del giorno di oggi coincide con la somma `input+output` letta via `curl` da `token_usage?day=eq.<oggi>`.
- DIARIO SUBAGENTI: compare "prova diario Giro 2" con una durata.
- TIMELINE: la sessione di prova compare; le sessioni vecchie come punti "inizio non registrato".
- Uscire in BASE per 2 minuti con la scheda Network aperta: nessuna richiesta a `/rest/v1/token_usage|subagents|sessions` mentre si è in BASE.

Poi cancellare le righe di prova:
```bash
curl -s -X DELETE "$SUPABASE_URL/rest/v1/subagents?agent_id=eq.prova-ag-1" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
curl -s -X DELETE "$SUPABASE_URL/rest/v1/sessions?transcript_path=eq./tmp/prova-giro2.jsonl" -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

- [ ] **Step 4: Impeccable**

Eseguire `/impeccable audit` sui tre pannelli (in DASHBOARD, larghezza desktop e stretta), poi `/impeccable polish` sui problemi reali trovati. Ogni correzione: modifica in `panels/src/` o nel blocco CSS "storico" di `baracca.html`, test verdi, `npm run build`, commit.

- [ ] **Step 5: Final branch review**

Dispatch di un reviewer (modello più capace) sull'intero diff del branch contro spec e piano. Correggere Critical e Important, ciascuno con test e commit.

- [ ] **Step 6: Show Vincent — STOP**

Mostrare a Vincent la DASHBOARD nel suo Chrome con i dati veri. **Fermarsi e aspettare il suo ok.** Nessun merge senza.

- [ ] **Step 7: Merge (after Vincent's ok)**

Merge del branch su `main` in locale, test rieseguiti sul risultato del merge (tutti i file di test Python + `npm test` in `panels/`). Fermare il server del worktree, riavviare quello di `~/my-agent/farm` sulla 8795 (`nohup python3 server.py > /tmp/ultron_farm.log 2>&1 &`), ricaricare la pagina e ricontrollare che STORICO ci sia. Rimuovere worktree e branch.

- [ ] **Step 8: settings.json (explicit confirmation from Vincent first)**

Dire a Vincent la modifica esatta e aspettare conferma:
- `PreToolUse` → `"matcher": "Task"` diventa `"matcher": "Task|Agent"`;
- nuova voce `"SubagentStart": [{"hooks": [{"type": "command", "command": "python3 /Users/rbl.vincent/my-agent/farm/hooks/barracks.py"}]}]`.

Dopo la modifica, la prova che gli hook nuovi sono attivi è lo Step 9 (effetto reale sul database), non un messaggio di conferma. Se non scattano, riavviare la sessione e riprovare.

- [ ] **Step 9: Real subagent, end to end**

Lanciare un subagente vero e breve (es. `Explore` che elenca i file di `farm/hooks`). Poi via `curl`: nuova riga in `subagents` con `task` = la description, `agent_id` valorizzato, `finished_at` valorizzato. In DASHBOARD la riga compare nel diario entro 60 secondi.

Se `agent_id` resta NULL: il payload reale di `SubagentStart` non porta il campo. Il sistema ricade sul FIFO da solo; annotarlo nella nota della Baracca come limite verificato.

- [ ] **Step 10: Vault checkpoint** (nessun push)

Aggiornare: [[La Baracca di Ultron - Design]] (sezione Giro 2 sotto-progetto 1 con stato e commit), la missione [[Supabase nella Baracca]] (spuntare il Passo 1 con una riga FATTO), la daily note, [[Active Priorities]]. Push su GitHub solo quando Vincent lo dice.
