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


def main():
    test_config_payload_never_leaks_service_key()
    test_config_payload_missing_config_returns_empty_strings()
    print("server.py: tutti i controlli passati")


if __name__ == "__main__":
    main()
