#!/usr/bin/env python3
"""Controllo rapido di supabase_client.py: python3 test_supabase_client.py"""
import io
import json
import os
import sys
import tempfile
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supabase_client as sc


def _fake_config(tmp_path):
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write("SUPABASE_URL=https://example.supabase.co\n")
        f.write("SUPABASE_SERVICE_KEY=fake-service-key\n")
        f.write("SUPABASE_ANON_KEY=fake-anon-key\n")
        f.write("SUPABASE_USER_ID=00000000-0000-0000-0000-000000000000\n")


def test_load_config_parses_env_file():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp
    try:
        cfg = sc.load_config()
        assert cfg["SUPABASE_URL"] == "https://example.supabase.co", cfg
        assert cfg["SUPABASE_SERVICE_KEY"] == "fake-service-key", cfg
    finally:
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_load_config_missing_file_returns_empty_dict():
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = "/nonexistent/path/.env"
    try:
        assert sc.load_config() == {}
    finally:
        sc.CONFIG_PATH = old


def test_upsert_builds_correct_request(monkeypatch_urlopen):
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp
    captured = {}

    class FakeResponse:
        status = 201
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b"[]"

    def fake_urlopen(req, timeout=3):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["headers"] = dict(req.header_items())
        captured["body"] = req.data
        return FakeResponse()

    old_urlopen = sc.urllib.request.urlopen
    sc.urllib.request.urlopen = fake_urlopen
    try:
        sc.CONFIG_PATH = tmp
        status = sc.upsert("agent_state", {"status": "idle"}, on_conflict="user_id")
        assert status == 201, status
        assert captured["method"] == "POST", captured["method"]
        assert "agent_state" in captured["url"], captured["url"]
        assert "on_conflict=user_id" in captured["url"], captured["url"]
        assert json.loads(captured["body"]) == {"status": "idle"}, captured["body"]
        assert captured["headers"]["Apikey"] == "fake-service-key", captured["headers"]
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_upsert_network_error_returns_none_never_raises():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp

    def fake_urlopen(req, timeout=3):
        raise urllib.error.URLError("no network")

    old_urlopen = sc.urllib.request.urlopen
    sc.urllib.request.urlopen = fake_urlopen
    try:
        result = sc.upsert("agent_state", {"status": "idle"})
        assert result is None, result
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_upsert_missing_config_returns_none():
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = "/nonexistent/.env"
    try:
        assert sc.upsert("agent_state", {"status": "idle"}) is None
    finally:
        sc.CONFIG_PATH = old


def test_load_config_never_raises_on_non_utf8_env():
    """un .env non-UTF8 alzava UnicodeDecodeError, che `except OSError` non
    prendeva: l'hook saltava in aria al posto di ignorare la config."""
    tmp = tempfile.mktemp()
    with open(tmp, "wb") as f:
        f.write(b"SUPABASE_URL=\xff\xfe\x00rotto\n")
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp
    try:
        assert sc.load_config() == {}, "doveva ingoiare il decode error"
    finally:
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_http_error_returns_status_not_none():
    """un 409 del server deve distinguersi da "niente rete" e da "non
    configurato", che tornano entrambi None."""
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp

    def fake_urlopen(req, timeout=1):
        raise urllib.error.HTTPError(req.full_url, 409, "Conflict", {}, None)

    old_urlopen = sc.urllib.request.urlopen
    sc.urllib.request.urlopen = fake_urlopen
    try:
        assert sc.upsert("agent_state", {"status": "idle"}) == 409
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def _fake_urlopen_sequence(responses, seen):
    """Finto urlopen: registra (metodo, url, corpo) e restituisce le risposte in ordine."""
    it = iter(responses)

    def fake(req, timeout=1):
        seen.append((req.get_method(), req.full_url, req.data))
        status, body = next(it)

        class R:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return body
        r = R()
        r.status = status
        return r
    return fake


def test_patch_oldest_selects_then_patches():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(200, b'[{"id": 7}]'), (204, b"")], seen)
    try:
        status = sc.patch_oldest("subagents", {"user_id": "a b&x=eq.y"}, ["agent_id", "finished_at"], {"agent_id": "ag-1"})
        assert status == 204, status
        method, url, _ = seen[0]
        assert method == "GET", method
        assert "/rest/v1/subagents?user_id=eq.a%20b%26x%3Deq.y&agent_id=is.null&finished_at=is.null" in url, url
        assert url.endswith("&order=created_at.asc&limit=1&select=id"), url
        method, url, body = seen[1]
        assert method == "PATCH", method
        assert url.endswith("/rest/v1/subagents?id=eq.7"), url
        assert json.loads(body) == {"agent_id": "ag-1"}, body
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_patch_oldest_no_row_returns_none():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(200, b"[]")], seen)
    try:
        assert sc.patch_oldest("subagents", {"user_id": "u"}, ["finished_at"], {"finished_at": "x"}) is None
        assert len(seen) == 1, seen
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_patch_oldest_network_error_returns_none():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp

    def boom(req, timeout=1):
        raise urllib.error.URLError("rete giù")
    sc.urllib.request.urlopen = boom
    try:
        assert sc.patch_oldest("subagents", {"user_id": "u"}, ["finished_at"], {"finished_at": "x"}) is None
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_delete_oldest_is_gone():
    assert not hasattr(sc, "delete_oldest")


def main():
    test_load_config_parses_env_file()
    test_load_config_missing_file_returns_empty_dict()
    test_load_config_never_raises_on_non_utf8_env()
    test_http_error_returns_status_not_none()
    test_patch_oldest_selects_then_patches()
    test_patch_oldest_no_row_returns_none()
    test_patch_oldest_network_error_returns_none()
    test_delete_oldest_is_gone()
    test_upsert_builds_correct_request(None)
    test_upsert_network_error_returns_none_never_raises()
    test_upsert_missing_config_returns_none()
    print("supabase_client.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
