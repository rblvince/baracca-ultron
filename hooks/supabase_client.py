#!/usr/bin/env python3
# farm/hooks/supabase_client.py
"""Client HTTP minimale per Supabase REST, stdlib-only (urllib) — coerente
col principio "server Python stdlib-only" già in uso nella Baracca, nessuna
dipendenza pip nuova. Le scritture usano sempre la service-role key (bypassa
RLS, lato server); il file di config non è mai committato.

Non solleva mai: un hook che esplode bloccherebbe la tool call reale."""
import functools
import json
import os
import urllib.error
import urllib.parse
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.config/baracca/.env")


def load_config():
    return dict(_parse_config(CONFIG_PATH))


@functools.lru_cache(maxsize=None)
def _parse_config(path):
    """Letto una volta sola per processo (prima fino a sei volte per hook);
    la chiave è il percorso, così un test che cambia CONFIG_PATH rilegge."""
    cfg = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    except Exception:
        # volutamente larghissimo: un .env non UTF-8 alza UnicodeDecodeError,
        # non OSError. Questa funzione è chiamata fuori dai try dei chiamanti,
        # quindi deve essere davvero incapace di sollevare.
        pass
    return cfg


def _headers(key):
    return {
        "Apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }


def _do_request(method, url, key, body=None, extra_headers=None, timeout=1):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in _headers(key).items():
        req.add_header(k, v)
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        # un rifiuto del server (400/409/...) non è "non configurato" né
        # "niente rete": lo status torna su, così una scrittura rotta si vede
        return e.code, None
    except (urllib.error.URLError, OSError):
        return None, None


def insert(table, row):
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    status, _ = _do_request("POST", url + "/rest/v1/" + table, key, body=row,
                             extra_headers={"Prefer": "return=minimal"})
    return status


def record_event(user_id, state, session=None, tokens=None):
    """Un evento degli hook in UNA chiamata (migrazione 008): stato del titolare,
    sessione e token insieme, invece di tre giri HTTPS in fila. Il database
    scarta uno stato più vecchio di quello che ha già (guardia su ts), così
    due eventi mandati in parallelo non si scavalcano."""
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    # gira nel figlio staccato, fuori dal tempo che Claude Code aspetta: con la
    # rete lenta conviene aspettare invece di perdere l'evento
    status, _ = _do_request("POST", url + "/rest/v1/rpc/record_event", key, timeout=10,
                            body={"p_user_id": user_id, "p_state": state, "p_session": session, "p_tokens": tokens})
    return status


def select(table, filters, columns):
    """Le righe (lista di dict) che soddisfano i filtri di uguaglianza, con
    le sole colonne chieste. None se manca la config, la rete non risponde o
    il server rifiuta."""
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    parts = [k + "=eq." + urllib.parse.quote(str(v), safe="") for k, v in filters.items()]
    status, body = _do_request("GET", url + "/rest/v1/" + table + "?" + "&".join(parts)
                               + "&select=" + columns, key)
    if status != 200 or not body:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return None


def patch(table, row_id, values):
    """Aggiorna una riga per id. Ritorna lo stato HTTP, None se non configurato."""
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    status, _ = _do_request("PATCH", url + "/rest/v1/" + table + "?id=eq." + str(row_id), key,
                            body=values, extra_headers={"Prefer": "return=minimal"})
    return status


def patch_oldest(table, filters, null_columns, values, extra=None):
    """Aggiorna la riga più vecchia (per created_at) che soddisfa i filtri di
    uguaglianza (dict campo->valore), ha NULL in tutte le null_columns e (se
    passati) soddisfa i filtri grezzi PostgREST in `extra` (es.
    ["created_at=gte." + urllib.parse.quote(iso, safe="")] — già URL-encoded
    dal chiamante). Due chiamate REST, perché PostgREST non supporta "update +
    limit 1": select dell'id più vecchio, poi PATCH per id. Ritorna lo stato
    HTTP del PATCH, oppure None se manca la config, la rete non risponde o
    nessuna riga corrisponde."""
    cfg = load_config()
    url, key = cfg.get("SUPABASE_URL"), cfg.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        return None
    parts = [k + "=eq." + urllib.parse.quote(str(v), safe="") for k, v in filters.items()]
    parts += [c + "=is.null" for c in null_columns]
    parts += list(extra or [])
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
