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
"""
import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SESSIONS_PATH = os.path.join(HERE, "..", "state", "sessions.json")
SUBAGENTS_PATH = os.path.join(HERE, "..", "state", "subagents.json")
MAX_AGE_MS = 60 * 60 * 1000  # un'ora: oltre, la sessione/coda è morta per davvero


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


def update_session(session_key, **fields):
    """Un terminale (identificato dal suo transcript_path) ha appena fatto
    qualcosa: scrive la sua istantanea, scartando le sessioni troppo vecchie
    così il file non cresce all'infinito con terminali chiusi da settimane."""
    if not session_key:
        return
    now = int(time.time() * 1000)
    data = _load(SESSIONS_PATH, {})
    data = {k: v for k, v in data.items() if now - v.get("ts", 0) < MAX_AGE_MS}
    entry = {k: v for k, v in fields.items() if v is not None}
    entry["ts"] = now
    data[session_key] = entry
    _save(SESSIONS_PATH, data)


def spawn_subagent(room, agent, task):
    """Un Task è appena partito (PreToolUse): entra in coda."""
    now = int(time.time() * 1000)
    data = _load(SUBAGENTS_PATH, {"next_id": 1, "list": []})
    data["list"] = [s for s in data.get("list", []) if now - s.get("ts", 0) < MAX_AGE_MS]
    sid = data.get("next_id", 1)
    data["list"].append({"id": sid, "room": room, "agent": agent, "task": task, "ts": now})
    data["next_id"] = sid + 1
    _save(SUBAGENTS_PATH, data)


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
