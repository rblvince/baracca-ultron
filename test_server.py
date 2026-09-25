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
        assert payload == {"url": "https://x.supabase.co", "anon_key": "anon-abc",
                           "soglie": {"live_ms": 900000, "subagente_ms": 1200000},
                           "home": srv.home_prefix()}, payload
        assert srv.home_prefix("/Users/rbl.vincent") == "-Users-rbl-vincent"
        assert "SEGRETA-non-deve-uscire" not in str(payload), payload
    finally:
        srv.supabase_client.load_config = old_load


def test_config_payload_missing_config_returns_empty_strings():
    import server as srv
    old_load = srv.supabase_client.load_config
    srv.supabase_client.load_config = lambda: {}
    try:
        payload = srv.config_payload()
        assert payload["url"] == "" and payload["anon_key"] == "", payload
    finally:
        srv.supabase_client.load_config = old_load


def test_read_skills_lists_installed_skills():
    """Gli specialisti della Baracca: una cartella con SKILL.md, nome e descrizione dal frontmatter."""
    import tempfile
    base = tempfile.mkdtemp()
    for d, body in (("taste-skill", "---\nname: taste\ndescription: \"anti-slop frontend\"\n---\n# x"),
                    ("senza-frontmatter", "# solo testo"), ("vuota", None), (".nascosta", "---\nname: no\n---")):
        os.makedirs(os.path.join(base, d))
        if body is not None:
            with open(os.path.join(base, d, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(body)
    got = server.read_skills([base, os.path.join(base, "non-esiste")], os.path.join(base, "nessun-conteggio.json"))
    assert got == [{"name": "senza-frontmatter", "description": "", "uses": 0},
                   {"name": "taste", "description": "anti-slop frontend", "uses": 0}], got
    # con i conteggi: prima le più usate, anche quelle dei plugin senza cartella
    used = os.path.join(base, "skills_used.json")
    with open(used, "w", encoding="utf-8") as f:
        f.write('{"superpowers:brainstorming": 15, "taste": 3}')
    got = server.read_skills([base], used)
    assert [(s["name"], s["uses"]) for s in got] == [("superpowers:brainstorming", 15), ("taste", 3),
                                                     ("senza-frontmatter", 0)], got


def test_page_defaults_match_the_thresholds():
    """I valori di partenza di SOGLIE nella pagina (usati se la config non
    arriva) devono essere quelli di hooks/soglie.py."""
    import re
    import soglie
    html = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "baracca.html"), encoding="utf-8").read()
    m = re.search(r"var SOGLIE = \{([^}]*)\}", html)
    assert m, "var SOGLIE non trovata in baracca.html"
    page = {k: eval(v, {}) for k, v in re.findall(r"(\w+):\s*([\d*]+)", m.group(1))}
    assert page == soglie.per_la_pagina(), (page, soglie.per_la_pagina())


def test_parse_missions_reads_only_mission_steps():
    import tempfile
    import server as srv
    old = srv.MISSIONS_DIR
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "M.md"), "w", encoding="utf-8") as f:
            f.write("---\ntype: mission\n---\n# Prova\n\n## Passi\n\n- [x] Passo 0 — fatto\n"
                    "- [ ] Passo 1 — [[Nota]] da fare\n  - primo: tocca [[File]]\n  - secondo\n"
                    "\n## Parcheggiato\n\n- [ ] non è un passo\n  - nemmeno questo\n")
        with open(os.path.join(d, "Indice.md"), "w", encoding="utf-8") as f:
            f.write("---\ntype: index\n---\n# Indice\n- [ ] ignorata\n")
        srv.MISSIONS_DIR = d
        try:
            got = srv.parse_missions()
        finally:
            srv.MISSIONS_DIR = old
    assert got == [{"title": "Prova", "steps": [
        {"done": True, "text": "Passo 0 — fatto", "todo": []},
        {"done": False, "text": "Passo 1 — Nota da fare", "todo": ["primo: tocca File", "secondo"]}]}], got


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


def test_talk_restarts_the_single_discord_service():
    """Il pulsante non deve mai aprire un'altra sessione con --channels
    (risposte doppie su Discord): riavvia il servizio launchd."""
    import io
    import server as srv
    calls = []
    old_run = srv.subprocess.run
    srv.subprocess.run = lambda args, **k: calls.append(args) or type("R", (), {"returncode": 0})()
    h = srv.Handler.__new__(srv.Handler)
    h.path = "/api/talk"
    h.server = type("S", (), {"server_address": ("127.0.0.1", 8795)})()
    h.headers = {"Host": "127.0.0.1:8795", "Origin": "http://127.0.0.1:8795"}
    sent = []
    h._send_json = lambda obj: sent.append(obj)
    try:
        h.do_POST()
        assert calls == [["launchctl", "kickstart", "-k", "gui/%d/com.ultron.discord" % os.getuid()]], calls
        assert sent == [{"ok": True}], sent
    finally:
        srv.subprocess.run = old_run
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py")).read()
    src += open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "start.sh")).read()
    assert "claude --channels" not in src, "nessun lancio di Claude con --channels"


def test_foreign_host_and_origin_are_refused():
    """DNS rebinding (Host estraneo) e POST da un altro sito (Origin estraneo):
    403, e il servizio Discord non si tocca."""
    import threading
    import urllib.error
    import urllib.request
    from http.server import HTTPServer
    import server as srv
    calls = []
    old_run = srv.subprocess.run
    srv.subprocess.run = lambda args, **k: calls.append(args) or type("R", (), {"returncode": 0})()
    httpd = HTTPServer(("127.0.0.1", 0), srv.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    port = httpd.server_address[1]
    base = "http://127.0.0.1:%d" % port

    def status(path, method="GET", headers=None):
        req = urllib.request.Request(base + path, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    try:
        assert status("/api/state") == 200
        assert status("/api/state", headers={"Host": "localhost:%d" % port}) == 200
        assert status("/api/vault", headers={"Host": "attacker.example:%d" % port}) == 403
        assert status("/api/vault", headers={"Host": "127.0.0.1"}) == 403
        assert status("/api/talk", "POST", {"Origin": "https://attacker.example"}) == 403
        assert calls == [], calls
        assert status("/api/talk", "POST", {"Origin": "http://127.0.0.1:%d" % port}) == 200
        assert status("/api/talk", "POST") == 200   # curl dal terminale: niente Origin
        assert len(calls) == 2, calls
    finally:
        httpd.shutdown()
        httpd.server_close()
        srv.subprocess.run = old_run


def test_events_stream_pushes_what_the_hooks_write():
    """/api/events manda subito stato, sessioni e sub-agenti, poi di nuovo lo
    stato appena un hook riscrive state.json, senza che la pagina chieda."""
    import http.client
    import json
    import tempfile
    import threading
    import time
    from http.server import ThreadingHTTPServer
    import server as srv
    tmp = tempfile.mkdtemp()
    old = (srv.STATE_PATH, srv.SESSIONS_PATH, srv.SUBAGENTS_PATH)
    srv.STATE_PATH, srv.SESSIONS_PATH, srv.SUBAGENTS_PATH = (
        os.path.join(tmp, "state.json"), os.path.join(tmp, "sessions.json"), os.path.join(tmp, "subagents.json"))

    def write_state(status):
        with open(srv.STATE_PATH + ".tmp", "w") as f:
            json.dump({"status": status, "ts": int(time.time() * 1000)}, f)
        os.replace(srv.STATE_PATH + ".tmp", srv.STATE_PATH)

    write_state("thinking")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
    try:
        conn.request("GET", "/api/events")
        resp = conn.getresponse()
        assert resp.status == 200 and resp.getheader("Content-Type") == "text/event-stream"

        def next_event():
            name = data = None
            while True:
                line = resp.fp.readline().decode("utf-8").rstrip("\n")
                if line.startswith("event: "):
                    name = line[7:]
                elif line.startswith("data: "):
                    data = json.loads(line[6:])
                elif line == "" and name:
                    return name, data

        first = [next_event() for _ in range(3)]
        assert [n for n, _ in first] == ["state", "sessions", "subagents"], first
        assert first[0][1]["status"] == "thinking", first[0]
        assert first[2][1] == {"list": []}, first[2]
        time.sleep(0.05)
        write_state("writing")
        name, data = next_event()
        assert (name, data["status"]) == ("state", "writing"), (name, data)
    finally:
        conn.close()
        httpd.shutdown()
        httpd.server_close()
        srv.STATE_PATH, srv.SESSIONS_PATH, srv.SUBAGENTS_PATH = old


def main():
    test_talk_restarts_the_single_discord_service()
    test_parse_missions_reads_only_mission_steps()
    test_page_defaults_match_the_thresholds()
    test_events_stream_pushes_what_the_hooks_write()
    test_config_payload_never_leaks_service_key()
    test_config_payload_missing_config_returns_empty_strings()
    test_read_skills_lists_installed_skills()
    test_panels_route_serves_only_the_bundle()
    test_foreign_host_and_origin_are_refused()
    print("server.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
