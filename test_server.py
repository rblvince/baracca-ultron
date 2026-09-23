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


def main():
    test_parse_missions_reads_only_mission_steps()
    test_config_payload_never_leaks_service_key()
    test_config_payload_missing_config_returns_empty_strings()
    print("server.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
