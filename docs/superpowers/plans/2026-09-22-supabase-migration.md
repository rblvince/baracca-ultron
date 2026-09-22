# La Baracca di Ultron — Migrazione a Supabase (Giro 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire il livello dati della Baracca (oggi file JSON locali) con Supabase, a rischio zero, senza toccare canvas o dashboard.

**Architecture:** Hook Python (invariati nel trigger) scrivono su Supabase via HTTP stdlib-only, in aggiunta ai file locali esistenti (doppia scrittura transitoria). `server.py` guadagna un endpoint `/api/config` e perde, solo all'ultimo task, le route di sola-lettura dello stato. `baracca.html` guadagna un client Supabase dietro un flag, poi passa da poll a Realtime — le funzioni di rendering esistenti (`applyLive`, `pollAux`, ecc.) restano identiche, cambia solo la forma di chi le alimenta.

**Tech Stack:** Python 3 stdlib (`urllib`, nessuna dipendenza pip nuova), Supabase (Postgres + Auth + Realtime, piano gratuito), client `@supabase/supabase-js` via CDN nel browser.

**Spec:** `farm/docs/superpowers/specs/2026-09-22-supabase-migration-design.md`

## Global Constraints

- Nessuna dipendenza pip nuova negli hook/server — solo stdlib (`urllib`, `json`, `os`, `time`), come da principio "server Python stdlib-only" già scritto nella nota di design della Baracca.
- Nessun test con pytest o altro framework — stile esistente: funzioni `test_*` con `assert`, eseguite da `main()`, `python3 test_X.py`. Vedi `hooks/test_barracks.py` come riferimento.
- Le chiavi Supabase non vanno mai committate né scritte nel vault — vivono in `~/.config/baracca/.env`, permessi `600`, stesso pattern già in uso per `watch`/OpenRouter.
- Ogni hook non deve mai sollevare un'eccezione che blocchi la tool call reale — ogni chiamata a Supabase è avvolta in try/except che ritorna `None` in caso di errore, mai un'eccezione propagata.
- Il canvas pixel-art (`drawUltron`, `drawCrew`, `drawSpec`, `bakeRoom`, ecc.) e la logica di rendering della dashboard non vengono toccati in nessun task di questo piano.

---

## Nota sullo schema: raffinato rispetto alla spec

La spec (design doc) proponeva uno schema semplificato per `agent_state`. Leggendo il codice reale (`barracks.py:write_state()`, `baracca.html:applyLive()`) risulta che lo stato scambiato oggi ha più campi (`room`, `node`, `agent`, `task`, `tool`, `tokens`, `line`, oltre a `status`/`area`/`ts`) — lo schema sotto li include tutti per **compatibilità 1:1** con `applyLive()`, che resta invariata: la Supabase-row deve avere esattamente la stessa forma dell'oggetto che quella funzione già sa consumare.

## Task 1: Supabase — progetto, schema SQL, credenziali

**Files:**
- Create: `farm/supabase/schema.sql`
- Create: `farm/hooks/.env.example` (template committato, senza valori reali)

**Passi manuali di Vincent (non delegabili — creazione account):**

- [ ] **Passo 1: Vincent crea un progetto Supabase gratuito**

Su supabase.com → New Project. Annotare Project URL (es. `https://xxxxx.supabase.co`) e Project Reference ID.

- [ ] **Passo 2: Scrivo lo schema SQL**

```sql
-- farm/supabase/schema.sql
create table agent_state (
  user_id uuid primary key references auth.users(id),
  status text not null default 'idle',
  room text,
  node text,
  agent text,
  task text,
  area text,
  tool text,
  tokens jsonb,
  line text,
  ts bigint not null
);

create table sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  transcript_path text not null,
  status text,
  room text,
  node text,
  ts bigint not null,
  unique (user_id, transcript_path)
);

create table subagents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  room text not null,
  agent text,
  task text,
  created_at timestamptz not null default now()
);

create table token_usage (
  user_id uuid not null references auth.users(id),
  day date not null,
  room text not null,
  input bigint not null default 0,
  output bigint not null default 0,
  cache_read bigint not null default 0,
  cache_write bigint not null default 0,
  primary key (user_id, day, room)
);

-- upsert incrementale: PostgREST non sa fare "upsert che somma", serve una funzione
create or replace function increment_token_usage(
  p_user_id uuid, p_day date, p_room text,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint
) returns void as $$
  insert into token_usage (user_id, day, room, input, output, cache_read, cache_write)
  values (p_user_id, p_day, p_room, p_input, p_output, p_cache_read, p_cache_write)
  on conflict (user_id, day, room) do update set
    input = token_usage.input + excluded.input,
    output = token_usage.output + excluded.output,
    cache_read = token_usage.cache_read + excluded.cache_read,
    cache_write = token_usage.cache_write + excluded.cache_write;
$$ language sql;

alter table agent_state enable row level security;
alter table sessions enable row level security;
alter table subagents enable row level security;
alter table token_usage enable row level security;

create policy "solo il proprietario" on agent_state for all using (auth.uid() = user_id);
create policy "solo il proprietario" on sessions for all using (auth.uid() = user_id);
create policy "solo il proprietario" on subagents for all using (auth.uid() = user_id);
create policy "solo il proprietario" on token_usage for all using (auth.uid() = user_id);
```

- [ ] **Passo 3: Vincent esegue `schema.sql` nell'SQL Editor di Supabase (dashboard → SQL Editor → incolla → Run)**

- [ ] **Passo 4: Vincent crea il proprio utente Auth**

Dashboard → Authentication → Users → Add user (email + password, "Auto Confirm User" attivo così non serve un'email di verifica).

- [ ] **Passo 5: Vincent recupera le chiavi**

Dashboard → Project Settings → API: `Project URL`, `anon public` key, `service_role` key (quest'ultima **segreta**, mai condivisa). Dashboard → Authentication → Users: copia lo `User UID` dell'utente creato al passo 4.

- [ ] **Passo 6: creo il template committato**

```
# farm/hooks/.env.example
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=
SUPABASE_USER_ID=
```

- [ ] **Passo 7: Vincent crea il file vero, mai committato**

```bash
mkdir -p ~/.config/baracca
cp farm/hooks/.env.example ~/.config/baracca/.env
chmod 600 ~/.config/baracca/.env
# poi apre ~/.config/baracca/.env con un editor e incolla i 4 valori del Passo 5
```

- [ ] **Passo 8: verifica**

Dashboard → Table Editor: le 4 tabelle esistono, ognuna con l'icona RLS attiva (lucchetto verde).

- [ ] **Passo 9: commit**

```bash
cd /Users/rbl.vincent/my-agent/farm
git add supabase/schema.sql hooks/.env.example
git commit -m "feat: schema Supabase (agent_state, sessions, subagents, token_usage)"
```

---

## Task 2: `supabase_client.py` — modulo HTTP condiviso

**Files:**
- Create: `farm/hooks/supabase_client.py`
- Test: `farm/hooks/test_supabase_client.py`

**Interfaces:**
- Produces: `upsert(table: str, row: dict, on_conflict: str = None) -> int|None`, `rpc(fn_name: str, params: dict) -> int|None`, `delete_oldest(table: str, filters: dict) -> int|None`, `load_config() -> dict`

- [ ] **Step 1: Write the failing test**

```python
# farm/hooks/test_supabase_client.py
#!/usr/bin/env python3
"""Controllo rapido di supabase_client.py: python3 test_supabase_client.py"""
import io
import json
import os
import sys
import tempfile
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supabase_client as sc


def _fake_config(tmp_path):
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write("SUPABASE_URL=https://example.supabase.co\n")
        f.write("SUPABASE_SERVICE_KEY=fake-service-key\n")
        f.write("SUPABASE_ANON_KEY=fake-anon-key\n")
        f.write("SUPABASE_USER_ID=00000000-0000-0000-0000-000000000000\n")


def test_load_config_parses_env_file():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp
    try:
        cfg = sc.load_config()
        assert cfg["SUPABASE_URL"] == "https://example.supabase.co", cfg
        assert cfg["SUPABASE_SERVICE_KEY"] == "fake-service-key", cfg
    finally:
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_load_config_missing_file_returns_empty_dict():
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = "/nonexistent/path/.env"
    try:
        assert sc.load_config() == {}
    finally:
        sc.CONFIG_PATH = old


def test_upsert_builds_correct_request(monkeypatch_urlopen):
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp
    captured = {}

    class FakeResponse:
        status = 201
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b"[]"

    def fake_urlopen(req, timeout=3):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["headers"] = dict(req.header_items())
        captured["body"] = req.data
        return FakeResponse()

    old_urlopen = sc.urllib.request.urlopen
    sc.urllib.request.urlopen = fake_urlopen
    try:
        sc.CONFIG_PATH = tmp
        status = sc.upsert("agent_state", {"status": "idle"}, on_conflict="user_id")
        assert status == 201, status
        assert captured["method"] == "POST", captured["method"]
        assert "agent_state" in captured["url"], captured["url"]
        assert "on_conflict=user_id" in captured["url"], captured["url"]
        assert json.loads(captured["body"]) == {"status": "idle"}, captured["body"]
        assert captured["headers"]["Apikey"] == "fake-service-key", captured["headers"]
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_upsert_network_error_returns_none_never_raises():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp

    def fake_urlopen(req, timeout=3):
        raise urllib.error.URLError("no network")

    old_urlopen = sc.urllib.request.urlopen
    sc.urllib.request.urlopen = fake_urlopen
    try:
        result = sc.upsert("agent_state", {"status": "idle"})
        assert result is None, result
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_upsert_missing_config_returns_none():
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = "/nonexistent/.env"
    try:
        assert sc.upsert("agent_state", {"status": "idle"}) is None
    finally:
        sc.CONFIG_PATH = old


def main():
    test_load_config_parses_env_file()
    test_load_config_missing_file_returns_empty_dict()
    test_upsert_builds_correct_request(None)
    test_upsert_network_error_returns_none_never_raises()
    test_upsert_missing_config_returns_none()
    print("supabase_client.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farm/hooks && python3 test_supabase_client.py`
Expected: `ModuleNotFoundError: No module named 'supabase_client'`

- [ ] **Step 3: Write the implementation**

```python
#!/usr/bin/env python3
# farm/hooks/supabase_client.py
"""Client HTTP minimale per Supabase REST, stdlib-only (urllib) — coerente
col principio "server Python stdlib-only" già in uso nella Baracca, nessuna
dipendenza pip nuova. Le scritture usano sempre la service-role key (bypassa
RLS, lato server); il file di config non è mai committato.

Non solleva mai: un hook che esplode bloccherebbe la tool call reale."""
import json
import os
import urllib.error
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.config/baracca/.env")


def load_config():
    cfg = {}
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    except OSError:
        pass
    return cfg


def _headers(key):
    return {
        "Apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }


def _do_request(method, url, key, body=None, extra_headers=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in _headers(key).items():
        req.add_header(k, v)
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            return resp.status, resp.read()
    except (urllib.error.URLError, OSError):
        return None, None


def upsert(table, row, on_conflict=None):
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    endpoint = url + "/rest/v1/" + table
    if on_conflict:
        endpoint += "?on_conflict=" + on_conflict
    status, _ = _do_request("POST", endpoint, key, body=row,
                             extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
    return status


def insert(table, row):
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    status, _ = _do_request("POST", url + "/rest/v1/" + table, key, body=row,
                             extra_headers={"Prefer": "return=minimal"})
    return status


def rpc(fn_name, params):
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    status, _ = _do_request("POST", url + "/rest/v1/rpc/" + fn_name, key, body=params)
    return status


def delete_oldest(table, filters):
    """Cancella la riga più vecchia (per created_at) che soddisfa i filtri
    (dict campo->valore, solo uguaglianza). Due chiamate REST: select
    dell'id più vecchio, poi delete — PostgREST non supporta "delete + limit 1"
    in una sola chiamata."""
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    query = "&".join(k + "=eq." + str(v) for k, v in filters.items())
    select_url = url + "/rest/v1/" + table + "?" + query + "&order=created_at.asc&limit=1&select=id"
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
    del_status, _ = _do_request("DELETE", url + "/rest/v1/" + table + "?id=eq." + str(row_id), key)
    return del_status
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farm/hooks && python3 test_supabase_client.py`
Expected: `supabase_client.py: tutti i controlli passati`

- [ ] **Step 5: `python3 -m py_compile`**

Run: `cd farm/hooks && python3 -m py_compile supabase_client.py test_supabase_client.py`
Expected: nessun output (pulito)

- [ ] **Step 6: Commit**

```bash
cd /Users/rbl.vincent/my-agent/farm
git add hooks/supabase_client.py hooks/test_supabase_client.py
git commit -m "feat: client Supabase stdlib-only (upsert/insert/rpc/delete_oldest)"
```

---

## Task 3: `barracks.py` — doppia scrittura di `agent_state`

**Files:**
- Modify: `farm/hooks/barracks.py:77-87` (funzione `write_state`)
- Test: `farm/hooks/test_barracks.py` (estendere)

**Interfaces:**
- Consumes: `supabase_client.upsert(table, row, on_conflict=None) -> int|None`, `supabase_client.load_config() -> dict`

- [ ] **Step 1: Write the failing test**

Aggiungere a `farm/hooks/test_barracks.py`, prima di `def main():`:

```python
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
    finally:
        supabase_client.upsert = old_upsert
        supabase_client.load_config = old_cfg
        b.STATE_PATH = old_state_path
```

E aggiungere la chiamata in `main()`:
```python
    test_write_state_calls_supabase_upsert()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farm/hooks && python3 test_barracks.py`
Expected: `AssertionError: []` (nessuna chiamata registrata — `write_state` non chiama ancora Supabase)

- [ ] **Step 3: Modificare `write_state` in `barracks.py`**

Sostituire (righe 1-22, aggiungere l'import) e (righe 77-87, la funzione):

```python
# riga 18, dopo "import session_track":
import supabase_client
```

```python
# sostituisce le righe 77-87
def write_state(**kw):
    data = {"ts": int(time.time() * 1000)}
    data.update({k: v for k, v in kw.items() if v is not None})
    tmp = STATE_PATH + ".tmp"
    try:
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, STATE_PATH)   # atomica: la pagina non legge mai un JSON a metà
    except OSError:
        pass
    cfg = supabase_client.load_config()
    user_id = cfg.get("SUPABASE_USER_ID")
    if user_id:
        row = dict(data)
        row["user_id"] = user_id
        supabase_client.upsert("agent_state", row, on_conflict="user_id")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farm/hooks && python3 test_barracks.py`
Expected: `barracks.py: tutti i controlli passati`

- [ ] **Step 5: `python3 -m py_compile`**

Run: `cd farm/hooks && python3 -m py_compile barracks.py`
Expected: pulito

- [ ] **Step 6: Commit**

```bash
git add hooks/barracks.py hooks/test_barracks.py
git commit -m "feat: write_state scrive anche su Supabase (doppia scrittura)"
```

---

## Task 4: `barracks.py` — `token_usage` aggregata via RPC

**Files:**
- Modify: `farm/hooks/barracks.py:136-157` (funzione `accumulate_tokens`)
- Test: `farm/hooks/test_barracks.py` (estendere)

**Interfaces:**
- Consumes: `supabase_client.rpc(fn_name, params) -> int|None`

- [ ] **Step 1: Write the failing test**

Aggiungere a `test_barracks.py`:

```python
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
```

E in `main()`: `test_accumulate_tokens_calls_rpc_with_deltas()`

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farm/hooks && python3 test_barracks.py`
Expected: `AssertionError: []`

- [ ] **Step 3: Modificare `accumulate_tokens`**

Sostituisce le righe 136-157:

```python
def accumulate_tokens(room, transcript_path):
    """Somma i token dell'ultimo turno assistant nel reparto dato, deduplicando
    per uuid così un turno con più tool in parallelo non si conta più volte.
    Ritorna il totale cumulativo per reparto, o None se non c'è nulla da sommare.
    In più, manda il delta di QUESTO turno a Supabase come riga aggregata
    per giorno/reparto (RPC increment_token_usage, mai una riga per evento)."""
    if not room:
        return None
    uuid, usage = last_assistant_usage(transcript_path)
    if not usage:
        return None
    tokens = load_tokens()
    if uuid and tokens.get("_last") == uuid:
        return tokens.get("rooms")
    bucket = tokens.setdefault("rooms", {})
    r = bucket.setdefault(room, {"in": 0, "out": 0, "cread": 0, "cwrite": 0})
    d_in = usage.get("input_tokens", 0) or 0
    d_out = usage.get("output_tokens", 0) or 0
    d_cread = usage.get("cache_read_input_tokens", 0) or 0
    d_cwrite = usage.get("cache_creation_input_tokens", 0) or 0
    r["in"] += d_in
    r["out"] += d_out
    r["cread"] += d_cread
    r["cwrite"] += d_cwrite
    if uuid:
        tokens["_last"] = uuid
    save_tokens(tokens)

    cfg = supabase_client.load_config()
    user_id = cfg.get("SUPABASE_USER_ID")
    if user_id:
        supabase_client.rpc("increment_token_usage", {
            "p_user_id": user_id,
            "p_day": time.strftime("%Y-%m-%d"),
            "p_room": room,
            "p_input": d_in, "p_output": d_out,
            "p_cache_read": d_cread, "p_cache_write": d_cwrite,
        })
    return bucket
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farm/hooks && python3 test_barracks.py`
Expected: `barracks.py: tutti i controlli passati`

- [ ] **Step 5: `python3 -m py_compile`**

Run: `python3 -m py_compile hooks/barracks.py`

- [ ] **Step 6: Commit**

```bash
git add hooks/barracks.py hooks/test_barracks.py
git commit -m "feat: accumulate_tokens manda il delta a token_usage via RPC"
```

---

## Task 5: `session_track.py` — doppia scrittura `sessions`

**Files:**
- Modify: `farm/hooks/session_track.py:42-54` (funzione `update_session`)
- Test: Create `farm/hooks/test_session_track.py`

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farm/hooks && python3 test_session_track.py`
Expected: `AssertionError: []`

- [ ] **Step 3: Modificare `session_track.py`**

Aggiungere l'import in cima (dopo riga 15 `import time`):
```python
import supabase_client
```

Sostituire `update_session` (righe 42-54):
```python
def update_session(session_key, **fields):
    """Un terminale (identificato dal suo transcript_path) ha appena fatto
    qualcosa: scrive la sua istantanea, scartando le sessioni troppo vecchie
    così il file non cresce all'infinito con terminali chiusi da settimane.
    Doppia scrittura: anche su Supabase, stesso identico contenuto."""
    if not session_key:
        return
    now = int(time.time() * 1000)
    data = _load(SESSIONS_PATH, {})
    data = {k: v for k, v in data.items() if now - v.get("ts", 0) < MAX_AGE_MS}
    entry = {k: v for k, v in fields.items() if v is not None}
    entry["ts"] = now
    data[session_key] = entry
    _save(SESSIONS_PATH, data)

    cfg = supabase_client.load_config()
    user_id = cfg.get("SUPABASE_USER_ID")
    if user_id:
        row = dict(entry)
        row["transcript_path"] = session_key
        row["user_id"] = user_id
        supabase_client.upsert("sessions", row, on_conflict="user_id,transcript_path")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farm/hooks && python3 test_session_track.py`
Expected: `session_track.py: tutti i controlli passati`

- [ ] **Step 5: `python3 -m py_compile`**

Run: `python3 -m py_compile hooks/session_track.py hooks/test_session_track.py`

- [ ] **Step 6: Commit**

```bash
git add hooks/session_track.py hooks/test_session_track.py
git commit -m "feat: update_session scrive anche su Supabase (doppia scrittura)"
```

---

## Task 6: `session_track.py` — doppia scrittura `subagents` (spawn/reap)

**Files:**
- Modify: `farm/hooks/session_track.py:57-77` (funzioni `spawn_subagent`, `reap_subagent`)
- Test: `farm/hooks/test_session_track.py` (estendere)

**Interfaces:**
- Consumes: `supabase_client.insert(table, row) -> int|None`, `supabase_client.delete_oldest(table, filters) -> int|None`

- [ ] **Step 1: Write the failing test**

Aggiungere a `test_session_track.py`:

```python
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


def test_reap_subagent_calls_delete_oldest():
    import supabase_client
    calls = []
    old_del = supabase_client.delete_oldest
    supabase_client.delete_oldest = lambda table, filters: calls.append((table, filters)) or 200
    old_cfg = supabase_client.load_config
    supabase_client.load_config = lambda: {"SUPABASE_USER_ID": "test-user"}
    tmp_dir = tempfile.mkdtemp()
    old_path = st.SUBAGENTS_PATH
    st.SUBAGENTS_PATH = os.path.join(tmp_dir, "subagents.json")
    try:
        st._save(st.SUBAGENTS_PATH, {"next_id": 2, "list": [{"id": 1, "room": "qa", "ts": 0}]})
        st.reap_subagent()
        assert len(calls) == 1, calls
        table, filters = calls[0]
        assert table == "subagents", table
        assert filters == {"user_id": "test-user"}, filters
    finally:
        supabase_client.delete_oldest = old_del
        supabase_client.load_config = old_cfg
        st.SUBAGENTS_PATH = old_path
```

E in `main()`: `test_spawn_subagent_calls_supabase_insert()` e `test_reap_subagent_calls_delete_oldest()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farm/hooks && python3 test_session_track.py`
Expected: `AssertionError: []` su entrambi i nuovi test

- [ ] **Step 3: Modificare `spawn_subagent` e `reap_subagent`**

Sostituisce le righe 57-77:

```python
def spawn_subagent(room, agent, task):
    """Un Task è appena partito (PreToolUse): entra in coda."""
    now = int(time.time() * 1000)
    data = _load(SUBAGENTS_PATH, {"next_id": 1, "list": []})
    data["list"] = [s for s in data.get("list", []) if now - s.get("ts", 0) < MAX_AGE_MS]
    sid = data.get("next_id", 1)
    data["list"].append({"id": sid, "room": room, "agent": agent, "task": task, "ts": now})
    data["next_id"] = sid + 1
    _save(SUBAGENTS_PATH, data)

    cfg = supabase_client.load_config()
    user_id = cfg.get("SUPABASE_USER_ID")
    if user_id:
        supabase_client.insert("subagents", {
            "user_id": user_id, "room": room, "agent": agent, "task": task,
        })


def reap_subagent():
    """Un sub-agente è rientrato (SubagentStop): toglie il più vecchio ancora
    in coda. Approssimazione onesta e voluta — l'hook non dice quale Task
    esatto è finito, quindi FIFO è la cosa più semplice che si comporta bene
    nel caso comune (i sub-agenti tendono a rientrare nell'ordine in cui sono
    partiti)."""
    data = _load(SUBAGENTS_PATH, {"next_id": 1, "list": []})
    if data.get("list"):
        data["list"].pop(0)
        _save(SUBAGENTS_PATH, data)

    cfg = supabase_client.load_config()
    user_id = cfg.get("SUPABASE_USER_ID")
    if user_id:
        supabase_client.delete_oldest("subagents", {"user_id": user_id})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farm/hooks && python3 test_session_track.py`
Expected: `session_track.py: tutti i controlli passati`

- [ ] **Step 5: `python3 -m py_compile`**

Run: `python3 -m py_compile hooks/session_track.py`

- [ ] **Step 6: Commit**

```bash
git add hooks/session_track.py hooks/test_session_track.py
git commit -m "feat: spawn/reap subagent scrivono anche su Supabase"
```

---

## Task 7: `server.py` — endpoint `/api/config`

**Files:**
- Modify: `farm/server.py:9-23` (import e costanti), aggiungere una funzione pura + una route in `do_GET`
- Test: Create `farm/test_server.py`

**Interfaces:**
- Produces: `config_payload() -> dict` (pura, testabile senza avviare il server — whitelist esplicita, non ritorna mai la service key)

- [ ] **Step 1: Write the failing test**

```python
#!/usr/bin/env python3
# farm/test_server.py
"""Controllo rapido di server.py: python3 test_server.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server


def test_config_payload_never_leaks_service_key():
    import server as srv
    old_load = srv.supabase_client.load_config
    srv.supabase_client.load_config = lambda: {
        "SUPABASE_URL": "https://x.supabase.co",
        "SUPABASE_ANON_KEY": "anon-abc",
        "SUPABASE_SERVICE_KEY": "SEGRETA-non-deve-uscire",
    }
    try:
        payload = srv.config_payload()
        assert payload == {"url": "https://x.supabase.co", "anon_key": "anon-abc"}, payload
        assert "SEGRETA-non-deve-uscire" not in str(payload), payload
    finally:
        srv.supabase_client.load_config = old_load


def test_config_payload_missing_config_returns_empty_strings():
    import server as srv
    old_load = srv.supabase_client.load_config
    srv.supabase_client.load_config = lambda: {}
    try:
        payload = srv.config_payload()
        assert payload == {"url": "", "anon_key": ""}, payload
    finally:
        srv.supabase_client.load_config = old_load


def main():
    test_config_payload_never_leaks_service_key()
    test_config_payload_missing_config_returns_empty_strings()
    print("server.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd farm && python3 test_server.py`
Expected: `AttributeError: module 'server' has no attribute 'config_payload'`

- [ ] **Step 3: Modificare `server.py`**

Aggiungere l'import (dopo riga 14 `from http.server import ...`):
```python
import sys as _sys
_sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "hooks"))
import supabase_client
```

Aggiungere la funzione pura, subito dopo `read_subagents()` (dopo riga 181):
```python
def config_payload():
    """Solo url + chiave anonima — MAI la service-role key, anche se presente
    nello stesso file di config. La chiave anonima non è un segreto nel
    modello di Supabase: la sicurezza la fa la Row Level Security lato DB."""
    cfg = supabase_client.load_config()
    return {"url": cfg.get("SUPABASE_URL", ""), "anon_key": cfg.get("SUPABASE_ANON_KEY", "")}
```

Aggiungere la route in `do_GET` (dopo la riga `elif self.path == "/api/subagents":` esistente, stesso blocco if/elif):
```python
        elif self.path == "/api/config":
            self._send_json(config_payload())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd farm && python3 test_server.py`
Expected: `server.py: tutti i controlli passati`

- [ ] **Step 5: `python3 -m py_compile`**

Run: `python3 -m py_compile server.py test_server.py`

- [ ] **Step 6: Commit**

```bash
cd /Users/rbl.vincent/my-agent/farm
git add server.py test_server.py
git commit -m "feat: endpoint /api/config (solo url + anon key, mai la service key)"
```

---

## Task 8: `baracca.html` — client Supabase dietro flag, nessun comportamento cambia

**Files:**
- Modify: `farm/baracca.html` (aggiunta script CDN nell'`<head>`, nuove funzioni vicino a `var LIVE = false...` riga 2292)

**Interfaces:**
- Produces: `loadSupabaseConfig()`, variabile `USE_SUPABASE` (bool, default `false`)

- [ ] **Step 1: Aggiungere lo script CDN Supabase**

Nell'`<head>` di `baracca.html`, prima della chiusura `</head>`, aggiungere:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

- [ ] **Step 2: Aggiungere client e flag, subito prima di `var LIVE = false...` (riga 2292)**

```javascript
/* ============================================== SUPABASE (Giro 1, dietro flag)
   USE_SUPABASE parte false: nessun comportamento visibile cambia finché non
   lo si attiva a mano dopo aver verificato che i dati arrivano davvero. */
var USE_SUPABASE = false;
var supaClient = null;

function initSupabase(cfg){
  if(!cfg || !cfg.url || !cfg.anon_key) return;
  supaClient = supabase.createClient(cfg.url, cfg.anon_key);
}

fetch("/api/config", {cache:"no-store"})
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(cfg){ if(cfg) initSupabase(cfg); })
  .catch(function(){});
```

- [ ] **Step 3: `node --check` sullo script estratto**

Estrarre lo script inline (tra `<script>` e `</script>` del blocco principale) in un file temporaneo e verificare:
```bash
cd /Users/rbl.vincent/my-agent/farm
python3 -c "
import re
html = open('baracca.html', encoding='utf-8').read()
scripts = re.findall(r'<script>(.*?)</script>', html, re.DOTALL)
open('/tmp/baracca_check.js', 'w', encoding='utf-8').write('\n'.join(scripts))
"
node --check /tmp/baracca_check.js
```
Expected: nessun output (pulito)

- [ ] **Step 4: Verifica dal vivo in Chrome**

Aprire `http://127.0.0.1:8795/baracca.html`, controllare la console: nessun errore proprio della pagina (l'unica eccezione nota è l'estensione Claude-in-Chrome). `USE_SUPABASE` resta `false`: comportamento identico a prima, poll ancora attivo.

- [ ] **Step 5: Commit**

```bash
git add baracca.html
git commit -m "feat: client Supabase caricato dietro flag USE_SUPABASE (default off)"
```

---

## Task 9: `baracca.html` — login, Realtime al posto del poll, pillola OFFLINE

**Files:**
- Modify: `farm/baracca.html:2296-2326` (funzione `poll`), `2401-2445` (`pollAux`)

**Attenzione, corregge una lacuna della spec**: le policy RLS (Task 1) richiedono `auth.uid() = user_id` — il client browser (chiave anonima) deve autenticarsi come l'utente Supabase creato al Task 1 Passo 4, altrimenti ogni `select`/sottoscrizione Realtime torna vuota (bloccata da RLS, senza errore esplicito — un bug silenzioso se non lo si aggiunge). Le scritture degli hook (Task 3-6) non ne hanno bisogno perché usano la service-role key, che bypassa RLS.

- [ ] **Step 1: Aggiungere il gate di login, prima di ogni sottoscrizione**

Aggiungere subito dopo `initSupabase()` (Task 8, Step 2), un piccolo form fisso e la funzione che lo gestisce:

```html
<!-- appena dopo <body>, o in qualunque punto statico del markup esistente -->
<div id="supaLogin" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:8px;font-family:sans-serif;color:#fff">
  <p>Accesso Baracca</p>
  <input id="supaEmail" type="email" placeholder="email" style="padding:6px">
  <input id="supaPass" type="password" placeholder="password" style="padding:6px">
  <button id="supaLoginBtn" style="padding:6px 12px">Entra</button>
  <p id="supaLoginErr" style="color:#ff5a4a;font-size:12px"></p>
</div>
```

```javascript
function showLoginGate(){
  document.getElementById("supaLogin").style.display = "flex";
}

function hideLoginGate(){
  document.getElementById("supaLogin").style.display = "none";
}

function attemptLogin(){
  var email = document.getElementById("supaEmail").value;
  var pass = document.getElementById("supaPass").value;
  supaClient.auth.signInWithPassword({email: email, password: pass}).then(function(res){
    if(res.error){
      document.getElementById("supaLoginErr").textContent = res.error.message;
      return;
    }
    hideLoginGate();
    subscribeRealtime();
  });
}

function ensureAuthThenSubscribe(){
  supaClient.auth.getSession().then(function(res){
    if(res.data && res.data.session){
      subscribeRealtime();
    } else {
      showLoginGate();
      document.getElementById("supaLoginBtn").addEventListener("click", attemptLogin);
    }
  });
}
```

Il client Supabase JS persiste la sessione da solo in `localStorage` (comportamento di default) — dopo il primo login, le riaperture successive della pagina trovano una sessione valida e saltano il form.

- [ ] **Step 2: Aggiungere la sottoscrizione Realtime e la pillola OFFLINE**

Aggiungere subito dopo `initSupabase()` (Task 8, Step 2):

```javascript
function subscribeRealtime(){
  if(!supaClient) return;
  supaClient.channel("agent_state_changes")
    .on("postgres_changes", {event:"*", schema:"public", table:"agent_state"}, function(payload){
      var s = payload.new; if(!s) return;
      try{ localStorage.setItem("baracca_last_state", JSON.stringify(s)); }catch(e){}
      if(!LIVE){ LIVE = true; var pill=document.getElementById("mode"); pill.className="pill live"; pill.textContent="LIVE"; }
      lastSeen = Date.now(); LAST_STATE = s;
      if(s.ts && s.ts !== lastTs){ lastTs = s.ts; applyLive(s); }
    })
    .subscribe(function(status){
      if(status === "SUBSCRIBED"){
        var pill = document.getElementById("mode");
        if(pill && pill.textContent === "OFFLINE"){ pill.className = "pill demo"; pill.textContent = "DEMO"; }
      } else if(status === "CHANNEL_ERROR" || status === "TIMED_OUT"){
        showOffline();
      }
    });
}

function showOffline(){
  var pill = document.getElementById("mode");
  if(pill){ pill.className = "pill offline"; pill.textContent = "OFFLINE"; }
  try{
    var cached = localStorage.getItem("baracca_last_state");
    if(cached) applyLive(JSON.parse(cached));
  }catch(e){}
}
```

- [ ] **Step 3: Aggiungere lo stile della pillola OFFLINE**

Cercare la regola CSS esistente `.pill.demo` (o `.pill.live`) e aggiungere subito dopo:
```css
.pill.offline{ background:var(--red); color:#fff; }
```

- [ ] **Step 4: Attivare `USE_SUPABASE` e sostituire l'avvio del poll**

Modificare il blocco del Task 8 Step 2 perché passi dal gate di login (Step 1), non da `subscribeRealtime()` diretto:
```javascript
fetch("/api/config", {cache:"no-store"})
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(cfg){
    if(cfg) initSupabase(cfg);
    if(supaClient){ USE_SUPABASE = true; ensureAuthThenSubscribe(); }
  })
  .catch(function(){});
```

Modificare `poll()` (riga 2296) perché non faccia nulla se `USE_SUPABASE` è vero (Realtime ha già il suo canale):
```javascript
function poll(){
  if(USE_SUPABASE) return; // Realtime se ne occupa, vedi subscribeRealtime()
  // ... corpo esistente invariato ...
}
```

- [ ] **Step 5: `node --check`**

Stesso comando del Task 8 Step 3.

- [ ] **Step 6: Verifica dal vivo — login e iniezione di una riga di test**

Con `USE_SUPABASE` forzato a `true` (basta che `~/.config/baracca/.env` esista con chiavi valide, dal Task 1):
1. Aprire `baracca.html`: deve comparire il form di login la prima volta. Login con le credenziali create al Task 1 Passo 4.
2. Dashboard Supabase → Table Editor → `agent_state` → modificare a mano la riga (status → `"thinking"`).
3. Osservare `baracca.html` in Chrome: Ultron deve reagire in tempo reale, senza ricaricare la pagina.
4. Ricaricare la pagina: il login non deve ricomparire (sessione persistita).
5. Spegnere la rete (o bloccare il dominio Supabase) per 20 secondi: la pillola deve passare a **OFFLINE** e mostrare l'ultima istantanea nota da `localStorage`.
6. Riattivare la rete: la pillola torna a DEMO/LIVE da sola.

- [ ] **Step 7: Commit**

```bash
git add baracca.html
git commit -m "feat: Realtime al posto del poll quando Supabase è configurato, pillola OFFLINE"
```

---

## Task 10: verifica end-to-end e disattivazione della doppia scrittura

**Files:**
- Modify: `farm/hooks/barracks.py`, `farm/hooks/session_track.py`, `farm/server.py`

**Checklist di verifica dal vivo (manuale, non un test automatico):**

- [ ] **Passo 1**: con una sessione Claude Code reale aperta (`--channels` o normale), verificare che ogni evento (tool call, subagente, priorità aperte) compaia sia nei file JSON locali sia nelle tabelle Supabase (confronto diretto: `cat state/state.json` vs riga in `agent_state` dashboard Supabase).
- [ ] **Passo 2**: lasciar girare così per un periodo che Vincent ritiene ragionevole (giorni, non minuti) prima di fidarsi.
- [ ] **Passo 3 (solo dopo il Passo 2, decisione di Vincent, non automatica)**: rimuovere la scrittura locale dagli hook (tornare a `write_state`/`update_session`/`spawn_subagent`/`reap_subagent` per lasciare **solo** la parte Supabase, cancellare i blocchi che scrivono su `STATE_PATH`/`SESSIONS_PATH`/`SUBAGENTS_PATH`) e rimuovere `/api/state`, `/api/sessions`, `/api/subagents` da `server.py`.
- [ ] **Passo 4**: `python3 -m py_compile` su tutti i file toccati, rilancio di tutti i test (`test_barracks.py`, `test_session_track.py`, `test_supabase_client.py`, `test_server.py`), verifica dal vivo in Chrome un'ultima volta.
- [ ] **Passo 5**: commit finale.

```bash
git add hooks/barracks.py hooks/session_track.py server.py
git commit -m "chore: rimossa la scrittura locale, Supabase è l'unica fonte di verità"
```

**Questo task NON va eseguito nella stessa sessione dei Task 1-9** — richiede che la doppia scrittura sia stata verificata stabile nel tempo reale d'uso, non solo in un test. Il rollback resta sempre disponibile: snapshot pre-migrazione su `github.com/rblvince/baracca-ultron` (commit `ce22434`).
