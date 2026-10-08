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

- `PreCompact` → i fogli del contesto volano da Ultron alla FORGIA, dove lo SPAZZINO li pressa; `SessionStart` con `source: compact` chiude la compattazione e il blocco torna a Ultron.
- `SessionStart` → il PORTINAIO apre il portellone; i terminali nuovi entrano da lì, quelli fermi escono da lì.
- `Notification` (già registrato) ora distingue il permesso (il GUARDIANO abbassa la sbarra in VERIFICHE) dall'attesa semplice (MARCONI trasmette).
- L'ECONOMO non ha bisogno di hook: legge la cache scritta dai token che già arrivano.

### Chi si muove

Camminano solo **Ultron**, i **cloni** degli altri terminali (entrano ed escono dal portellone) e i **sub-agenti**: i mini-Ultron e i tre personaggi qui sotto. Chi cammina sta portando qualcosa da un posto all'altro; tutto il resto della squadra sta fermo, ognuno nella sua stanza, e fa il suo mestiere da lì.

- **La truppa** (i dodici operativi) ha una postazione fissa (`STATION` in `baracca.html`) e non la lascia mai. Quando tocca a loro si accendono al loro posto, si girano, mostrano l'emote o l'attrezzo: il collaudo respinge alle PROVE, la sbarra del permesso scende in VERIFICHE, il contesto si pressa in FORGIA, la spesa della cache si annota allo SCHEDARIO.
- **In demo** le casse delle missioni le porta Ultron, da un reparto all'altro; l'operativo del reparto d'arrivo le riceve dal suo posto.

### Tre sub-agenti con un personaggio

Tre tipi di sub-agente hanno un aspetto loro. Il ponte li riconosce dal `subagent_type` esatto (maiuscole o minuscole non contano, `SUBAGENT_CHARACTER` in `hooks/barracks.py`) e manda alla pagina il loro id come `agent`:

| `subagent_type` | Personaggio | Reparto | Aspetto |
|---|---|---|---|
| `coder` | CODER, scrive codice, script, test e config | OFFICINA, BANCO | felpa col cappuccio, occhiali, portatile |
| `valutatore` | VALUTATORE, rilegge il codice e cerca bug veri | COLLAUDO, CONFRONTO | lente da orologiaio, barattolo col bug |
| `jev-giuria` | JEV GIURIA, mette ai voti le strade e dà il verdetto | LABORATORIO, PIANI | parrucca da giudice, martelletto |

- Il corridoio alto è loro: ognuno ha un posto fisso, col tondo del suo colore e l'attrezzo. A riposo passeggiano piano lungo il corridoio; di notte tornano al posto e restano lì. Ci sono sempre, anche in demo e senza server.
- Quando parte un sub-agente del loro tipo esce la fascia RINFORZO col nome. Il personaggio raggiunge Ultron, prende l'ordine sigillato, lo porta nel suo reparto e lavora lì, sul posto, finché il sub-agente è in corso. Poi porta il rapporto a Ultron e torna al posto. Per quel sub-agente non nasce un mini-Ultron.
- Un personaggio fa un sub-agente alla volta: il secondo dello stesso tipo resta un mini-Ultron, così il conto di quelli in corso è vero. Tutti gli altri tipi restano mini-Ultron, negli stessi reparti di prima.
- In sala comando stanno in SQUADRA, sotto il filtro «sub-agenti».

### Specialisti = skill installate

Gli specialisti sono le skill installate davvero: `/api/skills` legge le cartelle con `SKILL.md` in `~/.claude/skills`, `~/.agents/skills` e nelle stesse cartelle di `~/my-agent` (al massimo 10 in scena, prima quelle con un disegno loro: taste, guidelines, marketing, regia). Bash, letture, vault e sub-agenti li fa la truppa.

Ognuno sta fermo nella sottostanza dove il ponte manda la sua skill: le skill di revisione e verifica in COLLAUDO, REVISIONE; tutte le altre in LABORATORIO, ATTREZZI. I posti sono fissi, in righe da due (da tre con cinque o più), e con dieci specialisti nessuno copre un altro (`test_squadra.mjs`). Quando Ultron usa la loro skill esce la fascia SKILL e lo specialista gli lancia l'attrezzo dal suo posto, senza muoversi.

I nomi nella scena si leggono passando il cursore su persone, stanze, casse e portellone.

### Come si guarda

- **A RIPOSO / DEMO**: se Ultron ha già lavorato qui ma non negli ultimi 15 minuti, la base riposa (luci basse, dopo 10 minuti si dorme). La demo parte solo cliccando la pillola, o se non c'è mai stata una sessione.
- **Coda**: gli eventi passano in ordine; con la fila lunga Ultron cammina fino a 3 volte più svelto. Il ritratto dice quanti eventi sono in coda.
- **Pianta**: le stanze sono grandi il 50% in più di quelle di progetto; all'apertura la base si vede da vicino e si esplora trascinando o con la rotella. ESC mostra tutta la base (e di nuovo ESC torna da vicino).
- **U** segue Ultron di reparto in reparto; esc o trascinare smettono.
- **AVVISI**: un avviso di sistema quando Ultron ti aspetta e la pagina non è davanti (il browser chiede il permesso al primo clic).
- **Ponte** in sala comando: gli otto hook, ognuno con l'ultima volta che si è fatto vivo con un evento vero. "Mai visto" vuol dire che quell'hook non è registrato.

## Prototipo: la Baracca a strati

`http://127.0.0.1:8795/baracca-strati.html` — la base vista in sezione, di fronte, fatta di otto piani 2D in pixel-art sovrapposti nello spazio 3D (CSS 3D, nessuna libreria). Fermi combaciano, col mouse scorrono a velocità diverse; **E** li esplode. Stessi dati (`/api/events`), stessi reparti e sottostanze. La proposta completa è in `docs/redesign-strati.md`.

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
