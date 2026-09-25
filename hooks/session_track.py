#!/usr/bin/env python3
"""Tracciamento per-sessione e per-sub-agente, condiviso da barracks.py e
set_state.py, per far vedere alla Baracca un Ultron per ogni terminale attivo
e un mini-Ultron per ogni sub-agente in corso. Non tocca state.json: quel
file resta l'istantanea dell'ultimo evento in assoluto, usata da tutto quello
che già funziona (dashboard, log, token, pill LIVE).

Stesso schema di write_state() in barracks.py: ogni scrittura è
un'istantanea fresca dei soli campi noti in quel momento, non un merge con
quella precedente — il client accumula sul proprio oggetto di stato lato
JS esattamente come già fa con lo stato del titolare.

Gli hook dei tool in parallelo girano insieme: ogni leggi-modifica-scrivi di
un file di stato si fa sotto locked(), o un aggiornamento si perde.

Le scritture dei sub-agenti su Supabase non si fanno nel processo che Claude
Code aspetta: finiscono in una coda locale (enqueue) e un figlio staccato la
svuota in ordine (drain), con un timeout lungo. L'ordine conta: la claim di
SubagentStart deve trovare la riga inserita dal PreToolUse di un istante
prima, e la reconcile deve venire dopo entrambe.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
import time

CLAIM_WINDOW_S = 60  # una riga PreToolUse più vecchia di questo non è più reclamabile

HERE = os.path.dirname(os.path.abspath(__file__))
SESSIONS_PATH = os.path.join(HERE, "..", "state", "sessions.json")
SUBAGENTS_PATH = os.path.join(HERE, "..", "state", "subagents.json")
QUEUE_PATH = os.path.join(HERE, "..", "state", "supabase_queue.json")
MAX_AGE_MS = 60 * 60 * 1000  # un'ora: oltre, la sessione/coda è morta per davvero
QUEUE_MAX = 200              # senza rete la coda non cresce all'infinito
NET_TIMEOUT = 10             # nel figlio staccato conviene aspettare, non perdere la riga


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def _save(path, data):
    tmp = path + ".tmp"
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except OSError:
        pass


@contextmanager
def locked(path):
    """Lock esclusivo su path + ".lock" per un leggi-modifica-scrivi. Se il
    lock non si può prendere (cartella non scrivibile) si procede senza:
    meglio una scrittura non protetta che un hook fermo."""
    fd = None
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
    except OSError:
        if fd is not None:
            os.close(fd)
        fd = None
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)   # chiudere il descrittore rilascia il lock


def in_background(job):
    """Esegue job() in un figlio staccato (nuova sessione, stdin/stdout/stderr
    su /dev/null): il padre torna subito e Claude Code non aspetta la rete."""
    try:
        pid = os.fork()
    except OSError:
        return
    if pid:
        return
    try:
        os.setsid()
        null = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(null, fd)
        job()
    except Exception:
        pass
    finally:
        os._exit(0)


def update_session(session_key, **fields):
    """Un terminale (identificato dal suo transcript_path) ha appena fatto
    qualcosa: scrive la sua istantanea, scartando le sessioni troppo vecchie
    così il file non cresce all'infinito con terminali chiusi da settimane.
    Ritorna la stessa istantanea con transcript_path, per Supabase (la manda
    barracks.sync()); None senza chiave."""
    if not session_key:
        return None
    now = int(time.time() * 1000)
    entry = {k: v for k, v in fields.items() if v is not None}
    entry["ts"] = now
    with locked(SESSIONS_PATH):
        data = _load(SESSIONS_PATH, {})
        data = {k: v for k, v in data.items() if now - v.get("ts", 0) < MAX_AGE_MS}
        data[session_key] = entry
        _save(SESSIONS_PATH, data)
    return dict(entry, transcript_path=session_key)


def last_room(session_key):
    """Il reparto dell'ultimo evento di questo terminale, o None."""
    if not session_key:
        return None
    return (_load(SESSIONS_PATH, {}).get(session_key) or {}).get("room")


# --- la coda verso Supabase -------------------------------------------------

def enqueue(op, **args):
    """Mette in coda una scrittura (op, argomenti già calcolati: orari
    compresi, così contano quelli dell'evento e non quelli dell'invio) e
    sveglia chi la svuota."""
    with locked(QUEUE_PATH):
        queue = _load(QUEUE_PATH, [])
        queue.append([op, args])
        _save(QUEUE_PATH, queue[-QUEUE_MAX:])
    KICK()


def drain():
    """Svuota la coda in ordine d'arrivo. Uno solo alla volta (lock sul
    drain): chi arriva mentre un altro sta svuotando aspetta il suo turno e
    trova la coda già vuota, o con i soli lavori arrivati dopo."""
    import supabase_client
    supabase_client.TIMEOUT = NET_TIMEOUT
    with locked(QUEUE_PATH + ".drain"):
        while True:
            with locked(QUEUE_PATH):
                queue = _load(QUEUE_PATH, [])
                if not queue:
                    return
                op, args = queue.pop(0)
                _save(QUEUE_PATH, queue)
            try:
                REMOTE[op](**args)
            except Exception:
                pass   # una scrittura rotta non ferma le altre


def _kick():
    in_background(drain)


KICK = _kick   # i test lo sostituiscono con drain, per svuotare la coda subito


def _user_id():
    import supabase_client
    return supabase_client.load_config().get("SUPABASE_USER_ID")


# --- i sub-agenti -----------------------------------------------------------

def spawn_subagent(room, agent, task, tool_use_id=None):
    """Un Task è appena partito (PreToolUse): entra in coda. tool_use_id
    serve a reconcile_subagent() per accoppiare la riga al sub-agente vero."""
    now = int(time.time() * 1000)
    with locked(SUBAGENTS_PATH):
        data = _load(SUBAGENTS_PATH, {"next_id": 1, "list": []})
        data["list"] = [s for s in data.get("list", []) if now - s.get("ts", 0) < MAX_AGE_MS]
        sid = data.get("next_id", 1)
        data["list"].append({"id": sid, "room": room, "agent": agent, "task": task, "ts": now})
        data["next_id"] = sid + 1
        _save(SUBAGENTS_PATH, data)
    enqueue("spawn", room=room, agent=agent, task=task, tool_use_id=tool_use_id)


def _remote_spawn(room, agent, task, tool_use_id):
    import supabase_client
    user_id = _user_id()
    if user_id:
        row = {"user_id": user_id, "room": room, "agent": agent, "task": task}
        if tool_use_id:
            row["tool_use_id"] = tool_use_id
        supabase_client.insert("subagents", row)


def claim_subagent(agent_id):
    """Un sub-agente è appena partito (SubagentStart): la riga creata un istante
    prima da PreToolUse (la più vecchia ancora senza agent_id, tra quelle degli
    ultimi CLAIM_WINDOW_S secondi) prende il suo id, così al rientro si chiude
    la riga giusta anche con più sub-agenti insieme. Il filtro temporale
    esclude le righe orfane (PreToolUse il cui sub-agente non è mai partito:
    permesso negato, Esc, un altro hook che blocca): senza, restando sempre le
    più vecchie, si beccherebbero ogni claim successiva, spostando di una
    posizione ogni riga del diario da lì in poi.
    SubagentStart porta solo agent_id/agent_type, quindi dentro la finestra la
    claim resta per ordine d'arrivo e due partenze ravvicinate possono
    scambiarsi i compiti: lo scambio lo corregge reconcile_subagent() al
    PostToolUse del tool Agent, che ha la coppia esatta."""
    if not agent_id:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=CLAIM_WINDOW_S)
    enqueue("claim", agent_id=agent_id, cutoff=cutoff.isoformat())


def _remote_claim(agent_id, cutoff):
    import supabase_client
    import urllib.parse
    user_id = _user_id()
    if user_id:
        extra = ["created_at=gte." + urllib.parse.quote(cutoff, safe="")]
        supabase_client.patch_oldest("subagents", {"user_id": user_id},
                                     ["agent_id", "finished_at"], {"agent_id": agent_id}, extra=extra)


def reconcile_subagent(tool_use_id, agent_id):
    """PostToolUse del tool Agent: il risultato porta agentId, il payload il
    tool_use_id salvato al lancio. Se la claim per ordine d'arrivo ha dato a
    questa riga l'id di un altro sub-agente, le due righe si scambiano id e
    ora di fine (per un sub-agente in primo piano lo stop è già arrivato,
    ed è finito sulla riga sbagliata insieme all'id)."""
    if not tool_use_id or not agent_id:
        return
    enqueue("reconcile", tool_use_id=tool_use_id, agent_id=agent_id)


def _remote_reconcile(tool_use_id, agent_id):
    import supabase_client
    user_id = _user_id()
    if not user_id:
        return
    cols = "id,agent_id,finished_at"
    mine = supabase_client.select("subagents", {"user_id": user_id, "tool_use_id": tool_use_id}, cols)
    if not mine or mine[0]["agent_id"] == agent_id:
        return
    row = mine[0]
    other = supabase_client.select("subagents", {"user_id": user_id, "agent_id": agent_id}, cols)
    if other:
        o = other[0]
        supabase_client.patch("subagents", o["id"], {"agent_id": row["agent_id"], "finished_at": row["finished_at"]})
        supabase_client.patch("subagents", row["id"], {"agent_id": agent_id, "finished_at": o["finished_at"]})
    else:
        supabase_client.patch("subagents", row["id"], {"agent_id": agent_id})


def reap_subagent(agent_id=None):
    """Un sub-agente è rientrato (SubagentStop). In locale toglie il più vecchio
    ancora in coda (FIFO, come sempre: il file serve solo alla scena). Su
    Supabase la riga non si cancella più: si chiude con finished_at, così resta
    nel diario. Con agent_id si chiude la riga esatta; senza, o se nessuna riga
    ha quell'id, la più vecchia ancora aperta."""
    with locked(SUBAGENTS_PATH):
        data = _load(SUBAGENTS_PATH, {"next_id": 1, "list": []})
        if data.get("list"):
            data["list"].pop(0)
            _save(SUBAGENTS_PATH, data)
    enqueue("reap", agent_id=agent_id, finished_at=datetime.now(timezone.utc).isoformat())


def _remote_reap(agent_id, finished_at):
    import supabase_client
    user_id = _user_id()
    if user_id:
        now = {"finished_at": finished_at}
        done = None
        if agent_id:
            done = supabase_client.patch_oldest("subagents", {"user_id": user_id, "agent_id": agent_id},
                                                ["finished_at"], now)
        if done is None:
            # fallback FIFO: mai chiudere una riga già in mano a un altro
            # sub-agente ancora in corso (agent_id non NULL), o la sua
            # durata verrebbe troncata da uno stop che non è il suo
            supabase_client.patch_oldest("subagents", {"user_id": user_id}, ["finished_at", "agent_id"], now)


REMOTE = {"spawn": _remote_spawn, "claim": _remote_claim,
          "reconcile": _remote_reconcile, "reap": _remote_reap}
