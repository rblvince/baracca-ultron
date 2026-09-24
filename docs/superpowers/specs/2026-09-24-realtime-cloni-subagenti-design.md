# La Baracca di Ultron — Task 10, passo 1: cloni e mini-Ultron da Supabase

Status: design approvato da Vincent in chat (2026-09-24), in attesa della revisione di questa spec scritta.

**Rapporto col piano `2026-09-22-supabase-migration.md`:** il Task 10 ("togliere la doppia scrittura") è stato diviso in due, su decisione di Vincent del 2026-09-24. Questa spec è il **passo 1**: finire la migrazione dei lettori. Il **passo 2** (togliere le scritture locali dagli hook e `/api/state`, `/api/sessions`, `/api/subagents` da `server.py`) resta fuori scope e si fa dopo qualche giorno d'uso vero, quando l'altra sessione avrà chiuso il suo lavoro Discord su `server.py`.

## Perché

Verificato sul codice il 2026-09-24: la "doppia scrittura" è in realtà una migrazione a metà.

- `baracca.html` legge i cloni per terminale da `/api/sessions` e i mini-Ultron da `/api/subagents`, **sempre e solo dai file locali**. Su Supabase `sessions` e `subagents` li leggono solo i pannelli STORICO (poll ogni 60 s).
- Togliere le scritture locali oggi spegnerebbe cloni e mini-Ultron.
- In locale un SubagentStop toglie sempre il sub-agente più vecchio (FIFO), quindi con più sub-agenti insieme può sparire il mini-Ultron sbagliato. Su Supabase la riga chiusa è quella esatta (`agent_id`, `reconcile_subagent`).

## Scope

**Dentro:** migrazione `006`, `supabase/schema.sql`, il blocco SDOPPIAMENTO e il canale Realtime di `baracca.html`.

**Fuori:** hook Python, `server.py`, i file in `state/`, i pannelli React, il motore canvas, `talk.sh` e la parte Discord.

## Criterio di "fatto"

Con la pagina in LIVE via Realtime (`USE_SUPABASE = true`), un secondo terminale e un sub-agente veri compaiono e spariscono sulla scena **presi da Supabase**. Nessuna richiesta a `/api/sessions` o `/api/subagents` mentre Realtime è attivo. Se Realtime cade, il poll locale riprende da solo.

## 1. Database — `supabase/migrations/006_realtime_sessions_subagents.sql`

```sql
alter publication supabase_realtime add table sessions, subagents;
alter table sessions replica identity full;
alter table subagents replica identity full;
```

- Senza la publication Supabase risponde SUBSCRIBED ma non emette mai `postgres_changes` (lezione già scritta in `schema.sql` per `agent_state`). `replica identity full` serve perché Realtime valuti la RLS sulla riga.
- Le policy di select "solo il proprietario" su `sessions` e `subagents` esistono già: nessuna policy nuova.
- Le stesse tre istruzioni si aggiungono in `schema.sql`, accanto a quelle di `agent_state`, così il file resta lo schema vero. `schema.test.ts` confronta solo le colonne e non cambia.
- Applicazione: SQL Editor della dashboard Supabase, dal browser, come per la 003-005. Si naviga dalla barra laterale, non per URL (così si evita il blocco "Vuoi uscire dal sito?").

## 2. Pagina — `baracca.html`

**Disegno separato dalla fonte.** I due `.then` di `pollAux()` diventano `renderSessions(sessions)` e `renderSubagents(data)`, con il corpo spostato così com'è. Le forme restano quelle degli endpoint di oggi:

- sessions: `{ <transcript_path>: {status, room, node, ts} }`
- subagents: `{ list: [{id, room, agent, task, ts}] }`

`pollAux()` diventa: `if (USE_SUPABASE) return;` poi fetch locale e le due render. Il disegno non cambia.

**Ascolto.** In `subscribeRealtime()`, sullo stesso canale `agent_state_changes`, si aggiungono due `.on("postgres_changes", …)` per `sessions` e `subagents` (`event: "*"`). Ognuno chiama `scheduleAuxReload()`, che raggruppa le raffiche in un solo `reloadAux()` dopo 300 ms. Un canale solo, quindi un solo stato SUBSCRIBED/CHANNEL_ERROR e un solo interruttore: `USE_SUPABASE`.

**Rilettura — `reloadAux()`.** Con la sessione Auth corrente (`user.id`), due select:

- `sessions`: `user_id = uid`, `ts >= now − 15 min` → oggetto indicizzato per `transcript_path` → `renderSessions`.
- `subagents`: `user_id = uid`, `finished_at is null`, `created_at >= now − 20 min` → `{list: [{id, room, agent, task, ts: Date.parse(created_at)}]}` → `renderSubagents`.

Sono le stesse soglie di `read_sessions()` e `read_subagents()` in `server.py`. Un errore in una select lascia la scena com'è: niente render con dati vuoti, così un buco di rete non fa sparire tutti i cloni.

**Quando.**

- Al callback `SUBSCRIBED` subito dopo `USE_SUPABASE = true`: `reloadAux()`, così la scena è giusta subito e non solo al primo evento.
- Ogni 60 s, solo se `USE_SUPABASE`: `reloadAux()`, per far scadere le sessioni ferme anche senza eventi.
- `CHANNEL_ERROR`/`TIMED_OUT` e il watchdog dei 15 minuti mettono già `USE_SUPABASE = false`: `pollAux()` riprende da solo al giro dopo (1,2 s).

## 3. Prove

- `node --check` sullo script estratto da `baracca.html`, e `python3 test_server.py`, i test degli hook e `vitest` invariati e verdi.
- Dal vivo, nel Chrome di Vincent dove il login della Baracca è già salvato (nessuna password inserita da Ultron):
  1. pagina in LIVE, `USE_SUPABASE === true`;
  2. un sub-agente vero lanciato da una sessione Claude Code: il mini-Ultron compare e sparisce al rientro;
  3. una riga scritta a mano in `sessions` via REST (service key dal file di config, mai stampata): compare un clone; riga cancellata: il clone sparisce;
  4. richieste di rete: niente `/api/sessions` o `/api/subagents` mentre Realtime è attivo.

## 4. Commit

Solo `supabase/migrations/006_realtime_sessions_subagents.sql`, `supabase/schema.sql`, questa spec e **le sole righe di Ultron** in `baracca.html`, messe nell'indice con una patch parziale (`git apply --cached`). La modifica non committata dell'altra sessione (il `title` del pulsante PARLA) resta fuori, nel working tree. Push solo con l'ok di Vincent.

## Rischi

- **La migrazione non applicata:** la pagina va in SUBSCRIBED ma non arriva nessun evento su `sessions`/`subagents`. È coperto in parte dalla rilettura ogni 60 s, e la prova 3 lo scopre.
- **Conflitto con l'altra sessione su `baracca.html`:** si tocca un blocco diverso da quello di PARLA. Il commit parziale tiene separati i due lavori.
