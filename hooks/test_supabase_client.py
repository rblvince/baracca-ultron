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


def test_insert_builds_correct_request():
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
        status = sc.insert("subagents", {"room": "qa"})
        assert status == 201, status
        assert captured["method"] == "POST", captured["method"]
        assert captured["url"].endswith("/rest/v1/subagents"), captured["url"]
        assert json.loads(captured["body"]) == {"room": "qa"}, captured["body"]
        assert captured["headers"]["Apikey"] == "fake-service-key", captured["headers"]
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_insert_network_error_returns_none_never_raises():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp

    def fake_urlopen(req, timeout=3):
        raise urllib.error.URLError("no network")

    old_urlopen = sc.urllib.request.urlopen
    sc.urllib.request.urlopen = fake_urlopen
    try:
        result = sc.insert("subagents", {"room": "qa"})
        assert result is None, result
    finally:
        sc.urllib.request.urlopen = old_urlopen
        sc.CONFIG_PATH = old
        os.remove(tmp)


def test_insert_missing_config_returns_none():
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = "/nonexistent/.env"
    try:
        assert sc.insert("subagents", {"room": "qa"}) is None
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
        assert sc.insert("subagents", {"room": "qa"}) == 409
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


def test_patch_oldest_extra_filter_in_select_url():
    """extra passa filtri PostgREST grezzi (già URL-encoded dal chiamante) che
    finiscono nella select ma non nel PATCH: serve a claim_subagent per
    escludere le righe orfane più vecchie di 60s."""
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(200, b'[{"id": 9}]'), (204, b"")], seen)
    try:
        cutoff_encoded = sc.urllib.parse.quote("2026-09-23T12:00:00+00:00", safe="")
        status = sc.patch_oldest("subagents", {"user_id": "u1"}, ["agent_id"], {"agent_id": "ag-1"},
                                  extra=["created_at=gte." + cutoff_encoded])
        assert status == 204, status
        method, select_url, _ = seen[0]
        assert method == "GET", method
        assert "created_at=gte." + cutoff_encoded in select_url, select_url
        assert select_url.index("agent_id=is.null") < select_url.index("created_at=gte."), select_url
        assert select_url.endswith("&order=created_at.asc&limit=1&select=id"), select_url
        method, patch_url, body = seen[1]
        assert method == "PATCH", method
        assert "created_at" not in patch_url, patch_url
        assert json.loads(body) == {"agent_id": "ag-1"}, body
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_record_event_is_one_rpc_call():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(204, b"")], seen)
    try:
        assert sc.record_event("u1", {"status": "idle", "ts": 5}, {"transcript_path": "/t", "ts": 5}) == 204
        assert len(seen) == 1, seen
        method, url, body = seen[0]
        assert method == "POST" and url.endswith("/rest/v1/rpc/record_event"), (method, url)
        assert json.loads(body) == {"p_user_id": "u1", "p_state": {"status": "idle", "ts": 5},
                                    "p_session": {"transcript_path": "/t", "ts": 5}, "p_tokens": None}, body
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_load_config_reads_the_file_once_per_path():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old = sc.CONFIG_PATH
    sc.CONFIG_PATH = tmp
    try:
        first = sc.load_config()
        os.remove(tmp)                       # file sparito: la config resta quella letta
        assert sc.load_config() == first
        sc.load_config()["SUPABASE_URL"] = "sporcata"
        assert sc.load_config()["SUPABASE_URL"] == "https://example.supabase.co", "copia, non la cache"
    finally:
        sc.CONFIG_PATH = old


def test_select_returns_rows():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(200, b'[{"id": 3, "agent_id": null}]')], seen)
    try:
        rows = sc.select("subagents", {"user_id": "u1", "tool_use_id": "toolu_1"}, "id,agent_id")
        assert rows == [{"id": 3, "agent_id": None}], rows
        method, url, _ = seen[0]
        assert method == "GET", method
        assert url.endswith("/rest/v1/subagents?user_id=eq.u1&tool_use_id=eq.toolu_1&select=id,agent_id"), url
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_select_failure_returns_none():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp

    def boom(req, timeout=1):
        raise urllib.error.HTTPError(req.full_url, 400, "Bad", {}, None)
    sc.urllib.request.urlopen = boom
    try:
        assert sc.select("subagents", {"user_id": "u"}, "id") is None
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def test_patch_by_id():
    tmp = tempfile.mktemp()
    _fake_config(tmp)
    old_cfg, old_open = sc.CONFIG_PATH, sc.urllib.request.urlopen
    sc.CONFIG_PATH = tmp
    seen = []
    sc.urllib.request.urlopen = _fake_urlopen_sequence([(204, b"")], seen)
    try:
        assert sc.patch("subagents", 5, {"agent_id": "ag-1", "finished_at": None}) == 204
        method, url, body = seen[0]
        assert method == "PATCH" and url.endswith("/rest/v1/subagents?id=eq.5"), (method, url)
        assert json.loads(body) == {"agent_id": "ag-1", "finished_at": None}, body
    finally:
        sc.CONFIG_PATH, sc.urllib.request.urlopen = old_cfg, old_open
        os.remove(tmp)


def main():
    test_record_event_is_one_rpc_call()
    test_load_config_reads_the_file_once_per_path()
    test_select_returns_rows()
    test_select_failure_returns_none()
    test_patch_by_id()
    test_load_config_parses_env_file()
    test_load_config_missing_file_returns_empty_dict()
    test_load_config_never_raises_on_non_utf8_env()
    test_http_error_returns_status_not_none()
    test_patch_oldest_selects_then_patches()
    test_patch_oldest_no_row_returns_none()
    test_patch_oldest_network_error_returns_none()
    test_patch_oldest_extra_filter_in_select_url()
    test_insert_builds_correct_request()
    test_insert_network_error_returns_none_never_raises()
    test_insert_missing_config_returns_none()
    print("supabase_client.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
