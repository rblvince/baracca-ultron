#!/usr/bin/env python3
"""Server locale della Baracca (solo 127.0.0.1): serve la pagina, il bundle
React, le immagini e piccoli endpoint JSON in sola lettura (vault, stato e
sessioni scritti dagli hook, config pubblica di Supabase). Le eccezioni:
POST /api/talk, che riavvia il servizio launchd di Discord, e i TERMINALI
(/api/term...), sessioni claude o shell vere aperte dalla pagina (vedi
terminali.py). Quelli chiedono in più il gettone che il server mette nella
pagina a ogni avvio: un altro sito non lo può leggere."""
import base64
import hmac
import json
import os
import re
import secrets
import subprocess
import time
from urllib.parse import parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys as _sys
_sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "hooks"))
import supabase_client
import soglie
import terminali

HERE = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.expanduser("~/Ultron vault")
AGENT_HOME = os.path.expanduser("~/my-agent")
# Discord lo ascolta UNA sola sessione: il servizio launchd (vedi
# ~/Library/LaunchAgents/com.ultron.discord.plist). Più sessioni con
# --channels rispondono tutte allo stesso messaggio e bruciano token.
DISCORD_SERVICE = "com.ultron.discord"
CLAUDE_MD = os.path.join(AGENT_HOME, "CLAUDE.md")
STATE_PATH = os.path.join(HERE, "state", "state.json")
SESSIONS_PATH = os.path.join(HERE, "state", "sessions.json")
SUBAGENTS_PATH = os.path.join(HERE, "state", "subagents.json")
PORT = 8795
# 127.0.0.1 da solo non basta: un sito aperto nel browser può mandare POST qui
# (niente preflight per un fetch semplice) e, con il DNS rebinding, leggere
# /api/vault sotto un suo nome di dominio. Si risponde solo al proprio nome.
LOCAL_NAMES = ("127.0.0.1", "localhost")
MISSIONS_DIR = os.path.join(VAULT, "05 - Resources", "Missioni")
# /api/events: ogni quanto guardare i file degli hook, ogni quanto rimandare
# tutto anche senza modifiche (le sessioni e gli stati fermi scadono col tempo,
# non con una scrittura) e ogni quanto un commento che tiene viva la connessione
EVENTS_TICK_S = 0.15
EVENTS_REFRESH_S = 30
EVENTS_PING_S = 15
# terminali: il gettone vale fino al riavvio del server, un corpo POST non passa i 64k
TERM_TOKEN = secrets.token_urlsafe(24)
TERM_BODY_MAX = 64 * 1024
TERM_WAIT_S = 15
TERM_RE = re.compile(r"^/api/term/(t\d{1,4})/(stream|input|resize|close)$")
TERMS = terminali.Terminali(AGENT_HOME)


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def strip_wikilinks(text):
    return re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)


def first_body_line(text):
    """Skip YAML frontmatter and the H1 title, return the first real line after."""
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            body = text[end + 4:]
    skipped_heading = False
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#") and not skipped_heading:
            skipped_heading = True
            continue
        return line.lstrip("#").strip()
    return ""


def list_notes(folder, exclude_names=()):
    path = os.path.join(VAULT, folder)
    if not os.path.isdir(path):
        return []
    notes = []
    for name in sorted(os.listdir(path)):
        if not name.endswith(".md") or name in exclude_names:
            continue
        summary = first_body_line(read_text(os.path.join(path, name)))
        notes.append({"name": name[:-3], "summary": strip_wikilinks(summary)})
    return notes


def parse_identity():
    text = read_text(CLAUDE_MD)
    name_match = re.search(r"You are \*\*(.+?)\*\*, (.+?)\.", text)
    welcome_match = re.search(r'first reply of every session is "(.+?)"', text)
    return {
        "name": name_match.group(1) if name_match else "Ultron",
        "role": name_match.group(2) if name_match else "il tuo assistente",
        "welcome": welcome_match.group(1) if welcome_match else "",
    }


def parse_priorities():
    text = read_text(os.path.join(VAULT, "Active Priorities.md"))
    open_section = text.split("### Open Tasks", 1)[-1].split("### Completed Tasks", 1)[0]
    tasks = re.findall(r"- \[ \] (.+)", open_section)
    completed_section = text.split("### Completed Tasks", 1)[-1] if "### Completed Tasks" in text else ""
    completed = re.findall(r"- \[x\] (.+)", completed_section, re.IGNORECASE)
    return {
        "open": [strip_wikilinks(t.strip()) for t in tasks],
        "completed_count": len(completed),
    }


def parse_vinland():
    vinland_text = read_text(os.path.join(VAULT, "02 - Vinland", "Vinland.md"))
    body = vinland_text.split("---", 2)[-1].strip()
    description = ""
    status = ""
    status_match = re.compile(r"^\*\*Status\b[^*]*\*\*:?\s*")
    for line in body.splitlines():
        line = line.strip()
        if status_match.match(line):
            status = strip_wikilinks(status_match.sub("", line).strip()).split(". ")[0]
            if not status.endswith("."):
                status += "."
        elif line and not line.startswith("#") and not line.startswith("##"):
            description = description or strip_wikilinks(line)

    jobs = []
    jobs_dir = os.path.join(VAULT, "02 - Vinland", "Jobs")
    if os.path.isdir(jobs_dir):
        for name in sorted(os.listdir(jobs_dir)):
            if not name.endswith(".md"):
                continue
            text = read_text(os.path.join(jobs_dir, name))
            job_match = re.search(r"\*\*The job:\*\* (.+)", text)
            procedure = text.split("## The procedure", 1)[-1].split("## Quality bar", 1)[0]
            steps = re.findall(r"^\d+\.\s+(.+)$", procedure, re.MULTILINE)
            jobs.append({
                "name": name[:-3],
                "summary": strip_wikilinks(job_match.group(1)) if job_match else "",
                "steps": [strip_wikilinks(s) for s in steps[:6]],
            })

    return {"description": description, "status": status or "Planning", "jobs": jobs}


def parse_daily():
    daily_dir = os.path.join(VAULT, "01 - Daily Notes")
    dated = []
    if os.path.isdir(daily_dir):
        for root, _dirs, files in os.walk(daily_dir):
            for name in files:
                if re.match(r"\d{4}-\d{2}-\d{2}\.md$", name):
                    dated.append(name[:-3])
    dated.sort(reverse=True)
    return {"latest": dated[0] if dated else None, "count": len(dated)}


def read_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        data = {}
    now = int(time.time() * 1000)
    # a session that died mid-turn never writes "idle" — treat a stale
    # "thinking"/"waiting"/"spawning"/"compacting" state as idle so the character doesn't
    # freeze forever.
    if data.get("status") in ("thinking", "waiting", "spawning", "compacting") and now - data.get("ts", 0) > soglie.STATO_FERMO_MS:
        data = {"status": "idle", "area": None, "ts": now}
    data.setdefault("status", "idle")
    data.setdefault("area", None)
    return data


def read_sessions():
    """Un Ultron per terminale attivo: scarta le sessioni ferme da più di
    soglie.LIVE_MS, stessa soglia con cui la pagina passa da LIVE a DEMO."""
    data = {}
    try:
        with open(SESSIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    now = int(time.time() * 1000)
    return {k: v for k, v in data.items() if now - v.get("ts", 0) < soglie.LIVE_MS}


def read_subagents():
    """La coda di sub-agenti in corso: scarta le voci ferme da più di
    soglie.SUBAGENTE_MS (un SubagentStop mai arrivato non deve lasciare un
    mini-Ultron fantasma per sempre)."""
    data = {"next_id": 1, "list": []}
    try:
        with open(SUBAGENTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    now = int(time.time() * 1000)
    fresh = [s for s in data.get("list", []) if now - s.get("ts", 0) < soglie.SUBAGENTE_MS]
    return {"list": fresh}


def _mtime(path):
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


def event_sources():
    """(nome evento, file scritto dagli hook, lettura servita) per /api/events."""
    return (("state", STATE_PATH, read_state),
            ("sessions", SESSIONS_PATH, read_sessions),
            ("subagents", SUBAGENTS_PATH, read_subagents))


def config_payload():
    """Solo url + chiave anonima — MAI la service-role key, anche se presente
    nello stesso file di config. La chiave anonima non è un segreto nel
    modello di Supabase: la sicurezza la fa la Row Level Security lato DB.
    Con le soglie di tempo, così la pagina non ne tiene una copia sua."""
    cfg = supabase_client.load_config()
    return {"url": cfg.get("SUPABASE_URL", ""), "anon_key": cfg.get("SUPABASE_ANON_KEY", ""),
            "soglie": soglie.per_la_pagina(), "home": home_prefix()}


def home_prefix(home=None):
    """La home come la scrive Claude Code nei nomi delle cartelle dei transcript (ogni carattere
    che non è lettera o cifra diventa "-"): /Users/rbl.vincent → -Users-rbl-vincent. La pagina
    lo toglie per ricavare il nome del progetto di un terminale."""
    return re.sub(r"[^A-Za-z0-9]", "-", home or os.path.expanduser("~"))


# dove Claude Code e `npx skills` le installano (utente e progetto dell'agente); i doppioni per nome contano una volta
SKILL_DIRS = [os.path.expanduser("~/.claude/skills"), os.path.join(AGENT_HOME, ".claude", "skills"),
              os.path.expanduser("~/.agents/skills"), os.path.join(AGENT_HOME, ".agents", "skills")]


SKILLS_USED_PATH = os.path.join(HERE, "state", "skills_used.json")


def read_skills(dirs=None, used_path=None):
    """Le skill installate davvero (una cartella con SKILL.md in ~/.claude/skills o nel
    progetto dell'agente) più quelle usate (state/skills_used.json, scritto dagli hook:
    ci sono anche le skill dei plugin, che non hanno una cartella qui). Nome e descrizione
    dal frontmatter (la cartella se manca). Ordinate per usi, poi per nome: la Baracca
    mette nel corridoio le prime. Sola lettura, niente altro del file."""
    try:
        with open(used_path or SKILLS_USED_PATH, encoding="utf-8") as f:
            used = json.load(f)
    except (OSError, ValueError):
        used = {}
    if not isinstance(used, dict):
        used = {}
    out, seen = [], set()
    for base in dirs or SKILL_DIRS:
        try:
            names = sorted(os.listdir(base))
        except OSError:
            continue
        for d in names:
            text = read_text(os.path.join(base, d, "SKILL.md"))
            if not text or d.startswith("."):
                continue
            meta = {}
            m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
            for line in (m.group(1).splitlines() if m else []):
                k, _, v = line.partition(":")
                if k.strip() in ("name", "description") and v.strip():
                    meta[k.strip()] = v.strip().strip("\"'")
            name = meta.get("name") or d
            if name in seen:
                continue
            seen.add(name)
            out.append({"name": name, "description": (meta.get("description") or "")[:140]})
    out += [{"name": n, "description": ""} for n in used if n not in seen]
    for it in out:
        it["uses"] = used.get(it["name"], 0) if isinstance(used.get(it["name"]), int) else 0
    out.sort(key=lambda it: (-it["uses"], it["name"]))
    return out


def parse_missions():
    """Note `type: mission` in 05 - Resources/Missioni: titolo + passi a
    checkbox (sezione "## Passi" se c'è). Sola lettura: il pannello mostra,
    l'avanzamento si fa spuntando la nota nel vault."""
    out = []
    try:
        names = sorted(os.listdir(MISSIONS_DIR))
    except OSError:
        return out
    for name in names:
        if not name.endswith(".md"):
            continue
        text = read_text(os.path.join(MISSIONS_DIR, name))
        front = text.split("\n---", 1)[0] if text.startswith("---") else ""
        if not re.search(r"^type:\s*mission\s*$", front, re.M):
            continue
        body = text.split("## Passi", 1)[1].split("\n## ", 1)[0] if "## Passi" in text else text
        steps = []
        for line in body.splitlines():
            m = re.match(r"^- \[( |x|X)\] (.+)$", line)
            if m:
                steps.append({"done": m.group(1) != " ", "text": strip_wikilinks(m.group(2).strip()), "todo": []})
                continue
            sub_item = re.match(r"^\s{2,}- (.+)$", line)   # riassunto "cosa fare" sotto il passo
            if sub_item and steps:
                steps[-1]["todo"].append(strip_wikilinks(sub_item.group(1).strip()))
        title = re.search(r"^# (.+)$", text, re.M)
        out.append({"title": title.group(1).strip() if title else name[:-3], "steps": steps})
    return out


def build_vault_snapshot():
    return {
        "identity": parse_identity(),
        "inbox": {"notes": list_notes("00 - Inbox")},
        "priorities": parse_priorities(),
        "missions": parse_missions(),
        "vinland": parse_vinland(),
        "personal": {"notes": list_notes("03 - Personal", exclude_names=("Personal.md",))},
        "resources": {"notes": list_notes("05 - Resources", exclude_names=("Resources.md",))},
        "archive": {"notes": list_notes("04 - Archive")},
        "daily": parse_daily(),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; errors still raise normally

    def _send_json(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _forbidden(self):
        self.send_response(403)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _trusted(self, need_origin=False):
        """Host nostro sempre; per le scritture anche l'Origin, se il browser lo
        manda (lo manda sempre su una POST; curl no, e curl non è un sito)."""
        hosts = {"%s:%d" % (n, self.server.server_address[1]) for n in LOCAL_NAMES}
        if self.headers.get("Host") not in hosts:
            return False
        origin = self.headers.get("Origin")
        return not (need_origin and origin is not None and origin not in {"http://" + h for h in hosts})

    def do_GET(self):
        if not self._trusted():
            return self._forbidden()
        path = self.path.split("?", 1)[0]   # "/baracca.html?v=2" è la stessa pagina
        if path == "/api/vault":
            self._send_json(build_vault_snapshot())
        elif path == "/api/state":
            self._send_json(read_state())
        elif path == "/api/sessions":
            self._send_json(read_sessions())
        elif path == "/api/subagents":
            self._send_json(read_subagents())
        elif path == "/api/events":
            self._stream_events()
        elif path == "/api/config":
            self._send_json(config_payload())
        elif path == "/api/skills":
            self._send_json(read_skills())
        elif path == "/api/term":
            if not self._term_ok():
                return self._forbidden()
            self._send_json({"terms": TERMS.list()})
        elif TERM_RE.match(path) and TERM_RE.match(path).group(2) == "stream":
            if not self._term_ok():
                return self._forbidden()
            self._stream_term(TERM_RE.match(path).group(1))
        elif path in ("/", "/baracca.html"):
            self._send_page()
        elif path.startswith("/vendor/xterm/") and path[len("/vendor/xterm/"):] in VENDOR:
            name = path[len("/vendor/xterm/"):]
            self._send_file(os.path.join("vendor", "xterm", name), VENDOR[name])
        elif path == "/panels/panels.js":
            # isola React dei pannelli STORICO: solo il bundle, nient'altro di panels/
            self._send_file(os.path.join("panels", "dist", "panels.js"), "text/javascript")
        elif path.startswith("/assets/"):
            # scenografia Leonardo: solo .jpg piatti dentro assets/, niente sottocartelle
            name = path[len("/assets/"):]
            if name.endswith(".jpg") and name == os.path.basename(name) and not name.startswith("."):
                self._send_file(os.path.join("assets", name), "image/jpeg")
            else:
                self.send_response(404)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if not self._trusted(need_origin=True):
            return self._forbidden()
        if self.path == "/api/talk":
            # riavvia l'unico ascoltatore Discord invece di aprirne un altro
            r = subprocess.run(["launchctl", "kickstart", "-k", f"gui/{os.getuid()}/{DISCORD_SERVICE}"],
                               capture_output=True, timeout=10)
            self._send_json({"ok": r.returncode == 0})
        elif self.path == "/api/term" or TERM_RE.match(self.path):
            self._term_post()
        else:
            self.send_response(404)
            self.end_headers()

    # --- terminali ------------------------------------------------------------

    def _term_ok(self):
        """Il gettone arriva nell'intestazione (fetch) o nella query (EventSource non ne manda)."""
        given = self.headers.get("X-Baracca-Token")
        if given is None and "?" in self.path:
            given = (parse_qs(self.path.split("?", 1)[1]).get("t") or [None])[0]
        return given is not None and hmac.compare_digest(given, TERM_TOKEN)

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if n < 0 or n > TERM_BODY_MAX:
            return None
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, UnicodeDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def _term_post(self):
        if not self._term_ok():
            return self._forbidden()
        body = self._body()
        if body is None:
            self.send_response(400)
            self.end_headers()
            return
        if self.path == "/api/term":
            try:
                t = TERMS.new(str(body.get("kind", "claude")), body.get("cols", 100), body.get("rows", 30))
            except (ValueError, TypeError):
                self.send_response(400)
                self.end_headers()
                return
            except OverflowError:
                self.send_response(429)
                self.end_headers()
                return
            return self._send_json(t.info())
        tid, what = TERM_RE.match(self.path).groups()
        t = TERMS.get(tid)
        if t is None:
            self.send_response(404)
            self.end_headers()
            return
        if what == "input":
            data = body.get("data")
            ok = isinstance(data, str) and t.write(data.encode("utf-8"))
            return self._send_json({"ok": bool(ok)})
        if what == "resize":
            try:
                t.resize(body.get("cols", 100), body.get("rows", 30))
            except (TypeError, ValueError):
                pass
            return self._send_json({"ok": True})
        if what == "close":
            return self._send_json({"ok": TERMS.drop(tid)})
        self.send_response(404)
        self.end_headers()

    def _stream_term(self, tid):
        """L'uscita del terminale come Server-Sent Events, in base64 (i byte
        della tty non sono per forza UTF-8 interi). L'id di ogni evento è la
        posizione raggiunta: al ricollegamento EventSource la rimanda in
        Last-Event-ID e si riprende da lì, senza doppioni."""
        t = TERMS.get(tid)
        if t is None:
            self.send_response(404)
            self.end_headers()
            return
        q = parse_qs(self.path.split("?", 1)[1]) if "?" in self.path else {}
        start = self.headers.get("Last-Event-ID") or (q.get("from") or ["0"])[0]
        try:
            pos = max(0, int(start))
        except ValueError:
            pos = 0
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(b"retry: 1500\n\n")
            self.wfile.flush()
            while True:
                pos, data = t.read_from(pos, TERM_WAIT_S)
                if data:
                    self.wfile.write(("event: out\nid: %d\ndata: %s\n\n"
                                      % (pos, base64.b64encode(data).decode("ascii"))).encode("ascii"))
                elif t.alive:
                    self.wfile.write(b": ping\n\n")
                if not t.alive and pos >= t.end:
                    self.wfile.write(("event: exit\ndata: %s\n\n" % json.dumps({"code": t.code})).encode("ascii"))
                    self.wfile.flush()
                    return
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def _send_page(self):
        """baracca.html col gettone dei terminali dentro: solo chi apre la pagina
        da qui lo legge (un altro sito non può leggere le risposte di questo)."""
        try:
            with open(os.path.join(HERE, "baracca.html"), "rb") as f:
                body = f.read()
        except OSError:
            self.send_response(404)
            self.end_headers()
            return
        body = body.replace(b'<meta name="baracca-term" content="">',
                            b'<meta name="baracca-term" content="' + TERM_TOKEN.encode("ascii") + b'">', 1)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream_events(self):
        """Server-Sent Events: stato, sessioni e sub-agenti appena gli hook
        riscrivono i loro file, invece di una pagina che chiede /api/state
        due volte e mezzo al secondo anche quando non succede niente. Si
        guarda solo la data di modifica dei file; la connessione resta aperta
        finché la pagina non la chiude (il ping trova la pipe rotta)."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        seen = {}
        last_full = None
        last_write = time.monotonic()
        try:
            self.wfile.write(b"retry: 2000\n\n")
            while True:
                now = time.monotonic()
                full = last_full is None or now - last_full >= EVENTS_REFRESH_S
                for name, path, read in event_sources():
                    m = _mtime(path)
                    if full or m != seen.get(name):
                        seen[name] = m
                        data = json.dumps(read())
                        self.wfile.write(("event: %s\ndata: %s\n\n" % (name, data)).encode("utf-8"))
                        last_write = now
                if full:
                    last_full = now
                if now - last_write >= EVENTS_PING_S:
                    self.wfile.write(b": ping\n\n")
                    last_write = now
                self.wfile.flush()
                time.sleep(EVENTS_TICK_S)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def _send_file(self, name, content_type):
        path = os.path.join(HERE, name)
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


VENDOR = {"xterm.js": "text/javascript", "addon-fit.js": "text/javascript", "xterm.css": "text/css"}


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.daemon_threads = True      # i flussi aperti non tengono vivo il server alla chiusura
    print(f"Ultron's Farm up: http://127.0.0.1:{PORT}/baracca.html")
    try:
        server.serve_forever()
    finally:
        TERMS.close_all()


if __name__ == "__main__":
    main()
