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
