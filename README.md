# La Baracca di Ultron

Dashboard locale in pixel-art che rappresenta visivamente l'attività reale di una sessione Claude Code: un robot che si sposta tra 6 settori (ricerca, produzione, test, archivio/vault, deploy, laboratorio) man mano che arrivano eventi veri dagli hook della sessione — non una demo, i dati vengono dal lavoro reale mentre succede.

**Snapshot pre-migrazione (2026-09-22):** questo commit fotografa l'app così com'è oggi, prima di iniziare a spostare il livello dati su Supabase. Serve come punto di ripristino sicuro.

## Stack

- `baracca.html` — frontend canvas/JS puro, nessuna dipendenza.
- `server.py` — server Python stdlib-only, legge lo stato locale e la sessione, nessuna dipendenza esterna. Senza Supabase manda stato, sessioni e sub-agenti alla pagina via Server-Sent Events (`/api/events`); il polling resta solo come ripiego.
- `hooks/soglie.py` — le soglie di tempo (stato fermo, LIVE, sub-agenti), in un posto solo: la pagina le riceve con `/api/config`.
- `hooks/` — script Python richiamati dagli hook di Claude Code (`PostToolUse`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Notification`, `PreToolUse`) che scrivono lo stato osservato.

## Avvio

```sh
./start.sh
```

Avvia il server (porta 8795 se non già attivo), apre la pagina in Chrome e una sessione Claude Code in un terminale.

## Test

    ./run_tests.sh

Lancia tutti i controlli: hook e server (Python), blocchi puri della pagina (Node) e, se `panels/node_modules` c'è, vitest e typecheck dei pannelli. Esce con 1 se anche uno solo fallisce.

## Migrazioni Supabase

Le migrazioni in `supabase/migrations/` si applicano a mano dall'editor SQL, in ordine; `supabase/schema.sql` è lo schema completo dopo l'ultima.

- `009_record_event_tokens_isolated.sql` — i token in un sottoblocco di `record_event`: se falliscono non si portano via stato, sessione e avviso Discord. Si può applicare con gli hook attivi.
- `010_subagents_indici.sql` — solo indici, si può rilanciare.

## Nota

Pensata per girare solo su `127.0.0.1`, mai pubblicata esternamente. I file in `state/` sono runtime, esclusi dal repo.

## Pannelli STORICO (React)

I pannelli del gruppo STORICO in DASHBOARD sono un'isola React in `panels/`, servita come un solo file `panels/dist/panels.js` (committato: la Baracca parte senza Node).

Dopo ogni modifica a `panels/src/`:

    cd panels && npm install && npm test && npm run build

e committare anche `panels/dist/panels.js`. Senza build la pagina continua a servire la versione vecchia.
