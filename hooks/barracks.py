#!/usr/bin/env python3
"""Il ponte tra Claude Code e la baracca.

Legge l'evento dell'hook su stdin, deduce in che reparto sta lavorando
Ultron in questo momento e scrive state/barracks.json. Non tocca
state.json: la Fattoria continua a funzionare come prima.

Registrato su UserPromptSubmit (thinking), PostToolUse (il dettaglio),
SubagentStop e Stop (idle). Non solleva mai: un hook che esplode
bloccherebbe la catena delle tool call.
"""
import json
import os
import re
import sys
import time

import session_track

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_PATH = os.path.join(HERE, "..", "state", "state.json")
TOKENS_PATH = os.path.join(HERE, "..", "state", "tokens.json")
VAULT = os.path.expanduser("~/Ultron vault")
AGENT_HOME = os.path.expanduser("~/my-agent")

# --- i reparti della baracca -------------------------------------------
# vault  ARCHIVIO      qualsiasi cosa dentro il vault
# ricerca RICERCA      leggere, cercare, guardare fuori
# prod   OFFICINA      scrivere ed eseguire il lavoro
# qa     COLLAUDO      test, lint, build, diff
# pub    SPEDIZIONI    push, deploy, pubblicazione
# rs     LABORATORIO   tutto il resto

READ_TOOLS = {"Read", "Grep", "Glob", "WebFetch", "WebSearch", "NotebookRead"}
WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}

QA_WORDS = ("test", "pytest", "jest", "lint", "eslint", "ruff", "mypy",
            "build", "tsc", "vitest", "git diff", "git status", "check")
PUB_WORDS = ("git push", "deploy", "publish", "npm publish", "rsync",
             "scp ", "gh release", "vercel", "netlify")

SUBAGENT_ROOM = {
    "ricerca": "ricerca", "research": "ricerca", "explore": "ricerca",
    "produzione": "prod", "production": "prod", "general-purpose": "prod",
    "qualita": "qa", "qualità": "qa", "quality": "qa", "controllo": "qa",
    "pubblicazione": "pub", "publish": "pub",
    "ricerca-e-sviluppo": "rs", "r&s": "rs", "rs": "rs",
    "custode": "vault", "memoria": "vault", "memory": "vault",
    "orchestratore": "prod", "economo": "rs",
}
SUBAGENT_CREW = {
    "ricerca": "ricerca-1", "prod": "produzione-1", "qa": "qualita-1",
    "pub": "orchestratore", "vault": "custode", "rs": "orchestratore",
}


FOLDER_AREA = {
    "00 - Inbox": "inbox", "01 - Daily Notes": "daily", "02 - Vinland": "vinland",
    "03 - Personal": "personal", "04 - Archive": "archive", "05 - Resources": "resources",
}


def area_for_path(path):
    """Il campo della vecchia Fattoria, tenuto vivo per compatibilita."""
    if not path:
        return None
    p = os.path.abspath(os.path.expanduser(path))
    if p == os.path.join(VAULT, "Active Priorities.md"):
        return "priorities"
    if p in (os.path.join(VAULT, "VAULT-INDEX.md"), os.path.join(AGENT_HOME, "CLAUDE.md")):
        return "house"
    if p.startswith(VAULT + os.sep):
        return FOLDER_AREA.get(p[len(VAULT) + 1:].split(os.sep, 1)[0])
    return None


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


def load_tokens():
    try:
        with open(TOKENS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def save_tokens(data):
    tmp = TOKENS_PATH + ".tmp"
    try:
        os.makedirs(os.path.dirname(TOKENS_PATH), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, TOKENS_PATH)
    except OSError:
        pass


def last_assistant_usage(transcript_path):
    """(uuid, usage) dell'ultimo messaggio assistant nel transcript, o (None, None).
    ponytail: rilegge il file intero ad ogni hook — passare a lettura in coda
    (offset salvato) se una sessione molto lunga lo rendesse misurabilmente lento."""
    if not transcript_path:
        return None, None
    try:
        with open(transcript_path, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return None, None
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("type") != "assistant":
            continue
        usage = (entry.get("message") or {}).get("usage")
        if usage:
            return entry.get("uuid"), usage
    return None, None


def accumulate_tokens(room, transcript_path):
    """Somma i token dell'ultimo turno assistant nel reparto dato, deduplicando
    per uuid così un turno con più tool in parallelo non si conta più volte.
    Ritorna il totale cumulativo per reparto, o None se non c'è nulla da sommare."""
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
    r["in"] += usage.get("input_tokens", 0) or 0
    r["out"] += usage.get("output_tokens", 0) or 0
    r["cread"] += usage.get("cache_read_input_tokens", 0) or 0
    r["cwrite"] += usage.get("cache_creation_input_tokens", 0) or 0
    if uuid:
        tokens["_last"] = uuid
    save_tokens(tokens)
    return bucket


def tool_input(payload):
    return payload.get("tool_input") or payload.get("toolInput") or {}


def file_of(payload):
    ti = tool_input(payload)
    for key in ("file_path", "path", "notebook_path"):
        if isinstance(ti.get(key), str):
            return ti[key]
    return None


def note_name(path):
    """Un file del vault diventa il nome del nodo che si accende."""
    if not path:
        return None
    p = os.path.abspath(os.path.expanduser(path))
    if p.startswith(VAULT + os.sep) or p == os.path.join(AGENT_HOME, "CLAUDE.md"):
        return os.path.basename(p)[:-3] if p.endswith(".md") else os.path.basename(p)
    return None


def subagent_room_agent_task(ti):
    """A quale reparto/operativo appartiene un Task, dedotto da subagent_type/description.
    Condivisa fra la classificazione a fine Task (PostToolUse) e l'annuncio
    di partenza (PreToolUse, vedi 'spawning' in main()): stesso identico reparto."""
    raw = str(ti.get("subagent_type") or ti.get("description") or "").lower()
    room = "prod"
    for key, value in SUBAGENT_ROOM.items():
        if key in raw:
            room = value
            break
    task = ti.get("description") or ti.get("prompt", "")[:60]
    return room, SUBAGENT_CREW.get(room), task


def classify(payload):
    """(status, room, node, agent, task) per un PostToolUse."""
    tool = payload.get("tool_name") or payload.get("toolName") or ""
    ti = tool_input(payload)
    path = file_of(payload)
    node = note_name(path)
    in_vault = node is not None

    # un subagente: è il reparto a lavorare, non lui
    if tool == "Task":
        room, agent, task = subagent_room_agent_task(ti)
        return "delegating", room, None, agent, task

    if tool == "Bash":
        cmd = str(ti.get("command", "")).lower()
        if any(w in cmd for w in PUB_WORDS):
            return "delegating", "pub", None, "orchestratore", cmd[:50]
        if any(w in cmd for w in QA_WORDS):
            return "thinking", "qa", None, "qualita-1", cmd[:50]
        return "writing", "prod", None, "produzione-1", cmd[:50]

    if tool in WRITE_TOOLS:
        return "writing", ("vault" if in_vault else "prod"), node, \
               ("custode" if in_vault else "produzione-1"), None

    if tool in READ_TOOLS:
        if in_vault:
            return "reading", "vault", node, "custode", None
        return "reading", "ricerca", None, "ricerca-1", str(ti.get("pattern") or ti.get("query") or "")[:50]

    return "thinking", "rs", None, None, None


def main():
    # modalità fissa: barracks.py thinking | idle
    if len(sys.argv) > 1 and sys.argv[1] in ("thinking", "idle"):
        write_state(status=sys.argv[1], room=None)
        return

    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        payload = {}

    transcript_path = payload.get("transcript_path")
    event = payload.get("hook_event_name") or payload.get("hookEventName") or ""
    if event == "SubagentStop":
        write_state(status="thinking", room="prod", line="reparto rientrato")
        session_track.reap_subagent()
        session_track.update_session(transcript_path, status="thinking", room="prod")
        return

    # PreToolUse su Task (matcher in settings.json): il momento vero in cui un
    # sub-agente parte, non quando finisce. classify() gestisce Task solo a
    # PostToolUse (a lavoro già fatto), quindi qui serve un annuncio a parte.
    if event == "PreToolUse":
        if (payload.get("tool_name") or payload.get("toolName")) == "Task":
            room, agent, task = subagent_room_agent_task(tool_input(payload))
            write_state(status="spawning", room=room, agent=agent, task=task)
            session_track.spawn_subagent(room, agent, task)
            session_track.update_session(transcript_path, status="spawning", room=room)
        return

    status, room, node, agent, task = classify(payload)

    # un tool andato male è una rilavorazione: il collaudo respinge
    resp = payload.get("tool_response") or payload.get("toolResponse") or {}
    if isinstance(resp, dict) and (resp.get("is_error") or resp.get("isError")):
        status, room = "failing", "prod"

    tokens = accumulate_tokens(room, transcript_path)

    write_state(status=status, room=room, node=node, agent=agent, task=task,
                area=area_for_path(file_of(payload)),
                tool=payload.get("tool_name") or payload.get("toolName"),
                tokens=tokens)
    session_track.update_session(transcript_path, status=status, room=room, node=node)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
