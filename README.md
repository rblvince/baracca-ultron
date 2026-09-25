# La Baracca di Ultron

Dashboard locale in pixel-art che rappresenta visivamente l'attività reale di una sessione Claude Code: un robot che si sposta tra 6 settori (ricerca, produzione, test, archivio/vault, deploy, laboratorio) man mano che arrivano eventi veri dagli hook della sessione — non una demo, i dati vengono dal lavoro reale mentre succede.

**Snapshot pre-migrazione (2026-09-22):** questo commit fotografa l'app così com'è oggi, prima di iniziare a spostare il livello dati su Supabase. Serve come punto di ripristino sicuro.

## Stack

- `baracca.html` — frontend canvas/JS puro, nessuna dipendenza.
- `server.py` — server Python stdlib-only, legge lo stato locale e la sessione, nessuna dipendenza esterna. Senza Supabase manda stato, sessioni e sub-agenti alla pagina via Server-Sent Events (`/api/events`); il polling resta solo come ripiego.
- `hooks/soglie.py` — le soglie di tempo (stato fermo, LIVE, sub-agenti), in un posto solo: la pagina le riceve con `/api/config`.
- `hooks/` — script Python richiamati dagli hook di Claude Code (`PostToolUse`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Notification`, `PreToolUse`, `PreCompact`, `SessionStart`) che scrivono lo stato osservato.

### Hook da aggiungere (26/09)

Due personaggi nuovi vivono di hook che prima non erano registrati. In `settings.json`, accanto agli altri che chiamano `set_state.py` (percorso come per quelli):

```json
"PreCompact":   [{"hooks": [{"type": "command", "command": "python3 <baracca>/hooks/set_state.py compacting"}]}],
"SessionStart": [{"hooks": [{"type": "command", "command": "python3 <baracca>/hooks/set_state.py idle"}]}]
```

- `PreCompact` → lo SPAZZINO pressa il contesto; `SessionStart` con `source: compact` chiude la compattazione.
- `SessionStart` → il PORTINAIO apre il portellone; i terminali nuovi entrano da lì, quelli fermi escono da lì.
- `Notification` (già registrato) ora distingue il permesso (GUARDIANO con la sbarra) dall'attesa semplice (MARCONI trasmette).
- L'ECONOMO non ha bisogno di hook: legge la cache scritta dai token che già arrivano.

### Specialisti = skill installate

Gli specialisti in fila nel corridoio sono le skill installate davvero: `/api/skills` legge le cartelle con `SKILL.md` in `~/.claude/skills`, `~/.agents/skills` e nelle stesse cartelle di `~/my-agent` (al massimo 10 in scena, prima quelle con un disegno loro: taste, guidelines, marketing, regia). Si muovono solo quando Ultron usa la loro skill: lo raggiungono nel reparto e restano finché il reparto lavora. Bash, letture, vault e sub-agenti li fa la truppa.

I nomi nella scena si leggono passando il cursore su persone, stanze, casse e portellone.

### Come si guarda

- **A RIPOSO / DEMO**: se Ultron ha già lavorato qui ma non negli ultimi 15 minuti, la base riposa (luci basse, truppa alle postazioni, dopo 10 minuti si dorme). La demo parte solo cliccando la pillola, o se non c'è mai stata una sessione.
- **Coda**: gli eventi passano in ordine; con la fila lunga Ultron cammina fino a 3 volte più svelto. Il ritratto dice quanti eventi sono in coda.
- **Pianta**: le stanze sono grandi il 50% in più di quelle di progetto; all'apertura la base si vede da vicino e si esplora trascinando o con la rotella. ESC mostra tutta la base (e di nuovo ESC torna da vicino).
- **U** segue Ultron di reparto in reparto; esc o trascinare smettono.
- **AVVISI**: un avviso di sistema quando Ultron ti aspetta e la pagina non è davanti (il browser chiede il permesso al primo clic).
- **Ponte** in sala comando: gli otto hook, ognuno con l'ultima volta che si è fatto vivo con un evento vero. "Mai visto" vuol dire che quell'hook non è registrato.

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
