#!/usr/bin/env python3
"""Local-only server for Ultron's Farm: serves the page and two read-only
JSON endpoints, one reading the live vault, one reading the work-activity
state file written by Claude Code hooks. Hooks write the state file directly
on disk. The one exception to read-only is POST /api/talk, which launches a
Terminal.app session on this Mac (same command as farm/start.sh) so the
page's "talk on Discord" button has something to open — it reads and writes
nothing itself."""
import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sys as _sys
_sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "hooks"))
import supabase_client

HERE = os.path.dirname(os.path.abspath(__file__))
VAULT = os.path.expanduser("~/Ultron vault")
AGENT_HOME = os.path.expanduser("~/my-agent")
CLAUDE_MD = os.path.join(AGENT_HOME, "CLAUDE.md")
STATE_PATH = os.path.join(HERE, "state", "state.json")
SESSIONS_PATH = os.path.join(HERE, "state", "sessions.json")
SUBAGENTS_PATH = os.path.join(HERE, "state", "subagents.json")
PORT = 8795


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
    # "thinking"/"waiting"/"spawning" state (older than 10 minutes) as idle
    # so the character doesn't freeze forever.
    if data.get("status") in ("thinking", "waiting", "spawning") and now - data.get("ts", 0) > 10 * 60 * 1000:
        data = {"status": "idle", "area": None, "ts": now}
    data.setdefault("status", "idle")
    data.setdefault("area", None)
    return data


def read_sessions():
    """Un Ultron per terminale attivo: scarta le sessioni ferme da più di 15
    minuti, stessa soglia con cui la pagina passa da LIVE a DEMO."""
    data = {}
    try:
        with open(SESSIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    now = int(time.time() * 1000)
    return {k: v for k, v in data.items() if now - v.get("ts", 0) < 15 * 60 * 1000}


def read_subagents():
    """La coda di sub-agenti in corso: scarta le voci ferme da più di 20
    minuti (un SubagentStop mai arrivato non deve lasciare un mini-Ultron
    fantasma per sempre)."""
    data = {"next_id": 1, "list": []}
    try:
        with open(SUBAGENTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        pass
    now = int(time.time() * 1000)
    fresh = [s for s in data.get("list", []) if now - s.get("ts", 0) < 20 * 60 * 1000]
    return {"list": fresh}


def config_payload():
    """Solo url + chiave anonima — MAI la service-role key, anche se presente
    nello stesso file di config. La chiave anonima non è un segreto nel
    modello di Supabase: la sicurezza la fa la Row Level Security lato DB."""
    cfg = supabase_client.load_config()
    return {"url": cfg.get("SUPABASE_URL", ""), "anon_key": cfg.get("SUPABASE_ANON_KEY", "")}


def build_vault_snapshot():
    return {
        "identity": parse_identity(),
        "inbox": {"notes": list_notes("00 - Inbox")},
        "priorities": parse_priorities(),
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

    def do_GET(self):
        if self.path == "/api/vault":
            self._send_json(build_vault_snapshot())
        elif self.path == "/api/state":
            self._send_json(read_state())
        elif self.path == "/api/sessions":
            self._send_json(read_sessions())
        elif self.path == "/api/subagents":
            self._send_json(read_subagents())
        elif self.path == "/api/config":
            self._send_json(config_payload())
        elif self.path in ("/", "/farm.html", "/baracca.html"):
            self._send_file("baracca.html", "text/html")
        elif self.path.startswith("/assets/"):
            # scenografia Leonardo: solo .jpg piatti dentro assets/, niente sottocartelle
            name = self.path[len("/assets/"):].split("?")[0]
            if name.endswith(".jpg") and name == os.path.basename(name) and not name.startswith("."):
                self._send_file(os.path.join("assets", name), "image/jpeg")
            else:
                self.send_response(404)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/api/talk":
            script = f'tell application "Terminal" to do script "cd \'{AGENT_HOME}\' && claude --channels plugin:discord@claude-plugins-official"'
            subprocess.Popen(["osascript", "-e", script])
            self._send_json({"ok": True})
        else:
            self.send_response(404)
            self.end_headers()

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


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Ultron's Farm up: http://127.0.0.1:{PORT}/baracca.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
