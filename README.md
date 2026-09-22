# La Baracca di Ultron

Dashboard locale in pixel-art che rappresenta visivamente l'attività reale di una sessione Claude Code: un robot che si sposta tra 6 settori (ricerca, produzione, test, archivio/vault, deploy, laboratorio) man mano che arrivano eventi veri dagli hook della sessione — non una demo, i dati vengono dal lavoro reale mentre succede.

**Snapshot pre-migrazione (2026-09-22):** questo commit fotografa l'app così com'è oggi, prima di iniziare a spostare il livello dati su Supabase. Serve come punto di ripristino sicuro.

## Stack

- `baracca.html` — frontend canvas/JS puro, nessuna dipendenza.
- `server.py` — server Python stdlib-only, legge lo stato locale e la sessione, nessuna dipendenza esterna.
- `hooks/` — script Python richiamati dagli hook di Claude Code (`PostToolUse`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Notification`, `PreToolUse`) che scrivono lo stato osservato.

## Avvio

```sh
./start.sh
```

Avvia il server (porta 8795 se non già attivo), apre la pagina in Chrome e una sessione Claude Code in un terminale.

## Nota

Pensata per girare solo su `127.0.0.1`, mai pubblicata esternamente. I file in `state/` sono runtime, esclusi dal repo.
