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
                           "soglie": {"live_ms": 900000, "subagente_ms": 1200000}}, payload
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


def main():
    test_talk_restarts_the_single_discord_service()
    test_parse_missions_reads_only_mission_steps()
    test_page_defaults_match_the_thresholds()
    test_config_payload_never_leaks_service_key()
    test_config_payload_missing_config_returns_empty_strings()
    test_panels_route_serves_only_the_bundle()
    test_foreign_host_and_origin_are_refused()
    print("server.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
