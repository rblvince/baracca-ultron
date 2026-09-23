# La Baracca di Ultron — Giro 2, sotto-progetto 1: pannelli STORICO in React

Status: design approvato a sezioni da Vincent (2026-09-23), in attesa della revisione di questa spec scritta.

## Scope

Il Giro 2 (React sulla UI a pannelli, mai sul canvas) è diviso in tre sotto-progetti, ognuno con spec → piano → esecuzione:

1. **Questo:** guscio React + 3 pannelli nuovi (consumo token, diario subagenti, timeline sessioni) nella Baracca privata, su dati veri.
2. Porting in React dei pannelli esistenti della DASHBOARD (sessione, lavoro, memoria).
3. Gemello pubblico (`baracca-ultron-demo`): stessi componenti, dati finti, progetto Supabase separato.

**Fuori scope qui:** qualunque modifica al motore canvas, ai pannelli DASHBOARD esistenti, a RLS o a Realtime, e il Task 10 del Giro 1 (rimozione della doppia scrittura locale).

## Perché

- I dati storici su Supabase non si vedono da nessuna parte. `token_usage` accumula già per giorno/reparto.
- I pannelli nuovi scritti subito in React non vanno riscritti nel sotto-progetto 2 e passano pari pari al gemello pubblico.
- Stack React + Supabase + TypeScript = portfolio per il Master Boolean.

## Decisioni prese (con Vincent)

| Decisione | Scelta | Scartato |
|---|---|---|
| Dove vivono i pannelli | Nuovo gruppo `STORICO` in fondo alla DASHBOARD, con un contenitore React tutto suo | Terza tab separata |
| Freschezza | Query all'apertura della DASHBOARD + ogni 60s mentre è aperta, stop quando si esce | Realtime sulle 3 tabelle (flusso continuo, tocca la pubblicazione live) |
| Tooling | Vite + React + TS come "isola", buildata in un solo `panels.js` | React da CDN senza build; tutta la Baracca come app Vite |
| Diario e timeline | Inclusi, con modifica allo schema e a un hook | Solo storico token in questo giro |

Verificato nel codice che il DOM della DASHBOARD viene aggiornato solo per `id` (mai `#dashv` riscritto intero), quindi un contenitore React dentro la dashboard non entra in conflitto con `renderDashLive`.

## Architettura

```
farm/
  baracca.html            +contenitore #storico, +<script src="/panels/panels.js">, +mount
  server.py               +route GET /panels/panels.js (solo quel file)
  panels/                 NUOVO: Vite + React + TypeScript
    package.json          versioni esatte, typescript@5.9.3
    vite.config.ts        library mode, formato IIFE
    src/
      mount.tsx           window.mountStorico(el, supaClient, {rooms})
      types.ts            tipi delle tabelle scritti a mano da schema.sql
      useTable.ts         query al mount + ogni 60s, stop all'unmount, ultimo dato buono in caso di errore
      logic.ts            funzioni pure (aggregazioni, resa cache, posizioni timeline, durate)
      TokenHistory.tsx
      SubagentLog.tsx
      SessionTimeline.tsx
    dist/panels.js        bundle committato: start.sh resta identico, niente Node per avviare
  supabase/
    schema.sql            aggiornato con le colonne nuove
    migrations/002_history.sql
  hooks/
    supabase_client.py    +finish_oldest(), −delete_oldest() (nessun altro chiamante)
    session_track.py      reap_subagent() chiude la riga invece di cancellarla
```

**Confine vanilla ↔ React, in una sola direzione.** Il vanilla resta padrone della pagina. Appena la sessione Supabase è autenticata (non serve aspettare Realtime: i pannelli usano solo query) chiama `window.mountStorico(el, supaClient, {rooms})`: React riceve lo stesso client già autenticato (niente secondo login, niente seconda connessione) e la lista reparti `{id, n, colore}` derivata da `ROOMS`. React non legge variabili globali del canvas; il canvas non sa che React esiste. `showView()` avvisa React quando si entra o si esce dalla DASHBOARD, tramite un metodo `setActive(bool)` restituito da `mountStorico`, per avviare o fermare il refresh.

Se `panels.js` manca o fallisce il caricamento, `baracca.html` controlla `if (window.mountStorico)` e la Baracca funziona come oggi.

supabase-js **non** entra nel bundle: il tipo del client è importato solo come tipo.

## Modifiche al database — `002_history.sql`

```sql
-- sessions: ora di inizio. Aggiunta SENZA default, poi default solo per le nuove righe,
-- così le sessioni esistenti restano NULL ("inizio non registrato") invece di
-- ricevere tutte l'ora della migrazione.
alter table sessions add column created_at timestamptz;
alter table sessions alter column created_at set default now();

-- subagents: da coda a storico. NULL = ancora in corso.
alter table subagents add column finished_at timestamptz;
```

L'upsert di `update_session` (merge-duplicates) invia solo le colonne che conosce, quindi `created_at` resta quello dell'inserimento: gli hook delle sessioni non cambiano. Le policy RLS di sola lettura coprono già le colonne nuove. Lo storico dei subagenti parte dal giorno della migrazione: le righe già cancellate non si recuperano.

## Modifiche agli hook

- `supabase_client.finish_oldest(table, filters, column)`: stesso schema a due chiamate di `delete_oldest` (select dell'id più vecchio per `created_at` con `column=is.null`, poi `PATCH ?id=eq.<id>` impostando `column` a now in ISO 8601). Non solleva mai eccezioni, ritorna lo stato HTTP o `None`.
- `session_track.reap_subagent()` chiama `finish_oldest("subagents", {"user_id": ...}, "finished_at")` al posto di `delete_oldest`. La coda locale `state/subagents.json` (quella che legge la pagina via `/api/subagents`) non cambia: continua a togliere l'elemento più vecchio.
- `delete_oldest` viene rimossa insieme al suo test (nessun altro chiamante, verificato con grep).

## I tre pannelli

Tutti dentro un nuovo `<div class="dgroup">STORICO</div>` in fondo a `#dashv`, con le classi esistenti (`.dp`, `h4`, `.dtag real`, griglia `c12`/`c6`). La regola responsive esistente li porta a tutta larghezza sugli schermi stretti.

### CONSUMO TOKEN (`c12`)
- Ultimi 30 giorni. Una barra per giorno, segmentata per reparto (input + output).
- Riga di sintesi: totale del periodo, reparto che consuma di più, resa della cache = `cache_read / (input + cache_read)` (mostrata come "—" se il denominatore è 0).
- Al passaggio del mouse o al focus da tastiera su una barra: numeri del giorno per reparto.
- SVG fatto a mano, nessuna libreria di grafici.
- RICERCA e LABORATORIO condividono `P.cyan` sul canvas: nel grafico LABORATORIO usa un motivo a righe per restare distinguibile. Il canvas non si tocca.
- I giorni senza dati mostrano uno spazio vuoto sull'asse, non spariscono.

### DIARIO SUBAGENTI (`c6`)
- Ultimi 7 giorni, raggruppati per giorno, dal più recente.
- Riga: ora di partenza, chip del reparto, agente, task (troncato, testo completo nel `title`), durata (`finished_at − created_at`) oppure "in corso".
- Vuoto: "Il diario parte dal <data della migrazione>".

### TIMELINE SESSIONI (`c6`)
- Ultimi 7 giorni, una riga per giorno su un asse di 24 ore (ora locale).
- Barra da `created_at` a `ts` (l'ultimo segnale), colorata col reparto registrato. Una sessione che scavalca la mezzanotte viene spezzata sulle due righe.
- Sessioni con `created_at` NULL: un punto su `ts`, con "inizio non registrato" nel `title`.

### Comportamento comune
- Caricamento quando la DASHBOARD diventa visibile, poi ogni 60s; nessuna query mentre si guarda il canvas.
- Query fallita: il tag `REALE` diventa `ERRORE`, resta visibile l'ultimo dato buono. Un pannello in errore non tocca gli altri due.
- Prima del primo caricamento: "caricamento…", non un pannello vuoto.

## Test (TDD)

- **`logic.ts`**: aggregazione per giorno/reparto con giorni mancanti, resa cache con zero, posizioni sull'asse delle 24h, sessione oltre la mezzanotte, durata chiusa contro "in corso", `created_at` NULL.
- **Componenti** (Vitest + Testing Library, client finto): stato di caricamento, dati, vuoto, errore con ultimo dato buono mantenuto, `setActive(false)` ferma il refresh.
- **`types.ts` contro `schema.sql`**: un test legge `schema.sql` ed estrae le colonne delle 3 tabelle usate; fallisce se non corrispondono ai tipi.
- **Python**: `finish_oldest` costruisce la select con `is.null` e il PATCH corretto, non solleva in caso di errore di rete; `reap_subagent` chiama `finish_oldest` e mai una DELETE.
- **`server.py`**: `/panels/panels.js` servito con il content type JS; qualunque altro path sotto `/panels/` → 404.

## Rilascio

1. Worktree isolato, come nel Giro 1.
2. Migrazione `002_history.sql` applicata sul progetto Supabase reale (solo colonne aggiunte, niente di distruttivo), poi il cambio all'hook.
3. Verifica dal vivo con dati veri: un subagente reale lanciato, riga controllata via `curl` con `finished_at` compilato, poi visibile nel diario in Chrome; storico token e timeline controllati contro le righe lette via `curl`.
4. Skill `dataviz` per il grafico, `/impeccable audit` e `polish` sui pannelli.
5. Risultato mostrato a Vincent nel browser **prima** di merge e push. Merge solo col suo ok.

## Rischi noti

- **Bundle committato:** se si modifica `panels/src` e si dimentica la build, la pagina serve la versione vecchia. Mitigazione: lo script `npm run build` è l'unico modo documentato, e il README del repo lo dice.
- **Subagenti senza rientro:** se `SubagentStop` non arriva mai, la riga resta "in corso" per sempre. Accettato: è lo stesso limite FIFO già dichiarato per la coda locale.
