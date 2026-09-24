# Cloni e mini-Ultron da Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** far leggere a `baracca.html` i cloni per terminale e i mini-Ultron da Supabase (Realtime come campanello + rilettura), lasciando i file locali come ripiego.

**Architecture:** migrazione `006` mette `sessions` e `subagents` nella publication Realtime. In `baracca.html` il disegno di cloni/mini viene separato dalla fonte (`renderSessions`/`renderSubagents`); due ascoltatori sul canale Realtime esistente chiamano `reloadAux()` (debounce 300 ms), che fa due select e passa i dati alle render. `USE_SUPABASE` decide la fonte: vero → Supabase, falso → poll locale di sempre.

**Tech Stack:** HTML/JS vanilla (ES5) in `baracca.html`, supabase-js 2.117.1 da CDN, Postgres Supabase, Node (solo per il check dei convertitori), Python stdlib per i test esistenti.

**Spec:** `docs/superpowers/specs/2026-09-24-realtime-cloni-subagenti-design.md`

## Global Constraints

- Non toccare: hook Python, `server.py`, `start.sh`, `test_server.py`, `talk.sh`, `state/`, `panels/`, motore canvas (sono in parte lavoro non committato di un'altra sessione).
- `baracca.html` contiene una modifica non committata di un'altra sessione (riga ~379, `title` del pulsante `talkBtn`): **mai** metterla nell'indice, mai annullarla.
- Soglie identiche a `server.py`: sessioni `ts >= now − 15 min`; sub-agenti `created_at >= now − 20 min` e `finished_at is null`.
- Stile JS della pagina: `var`, `function`, niente arrow function né `let/const` (coerente col resto dello script).
- Mai stampare o scrivere in chiaro la service key (`~/.config/baracca/.env`); leggerla solo dentro i comandi.
- Nessuna password inserita da Ultron: la prova dal vivo usa il Chrome di Vincent già loggato.
- Commit solo locali; push solo con ok esplicito di Vincent.

## Review Focus

1. **Realtime SUBSCRIBED ma migrazione non applicata** → nessun evento su `sessions`/`subagents`; atteso: la scena si aggiorna comunque entro 60 s (rilettura periodica). Coperto dal Task 1 Step 4 (verifica publication) e dal Task 3 Step 3.
2. **Select che fallisce (rete, RLS)** → atteso: la scena resta com'è, nessun clone sparisce. Coperto dal guard `!r.error && r.data` nel Task 2 e dal check in `test_aux.mjs` che `sessionsFromRows(null)` non esplode.
3. **Sub-agente il cui SubagentStop non arriva mai** → atteso: il mini-Ultron sparisce dopo 20 min. Coperto dal filtro `created_at` in `reloadAux()` + rilettura ogni 60 s (Task 2).
4. **Watchdog dei 15 min o CHANNEL_ERROR** mette `USE_SUPABASE = false` → atteso: il poll locale riprende entro 1,2 s. Coperto da `pollAux()` che esce solo se `USE_SUPABASE` (Task 2), verificato al Task 3 Step 5.
5. **Pagina senza login Supabase** → `USE_SUPABASE` resta falso, tutto come oggi dai file locali. Nessun codice nuovo gira senza `supaClient` e sessione Auth (guard in `reloadAux()`).

---

### Task 1: migrazione 006 — `sessions` e `subagents` in Realtime

**Files:**
- Create: `supabase/migrations/006_realtime_sessions_subagents.sql`
- Modify: `supabase/schema.sql:75-79` (blocco Realtime)

**Interfaces:**
- Consumes: tabelle `sessions`, `subagents` e policy di select già esistenti.
- Produces: eventi `postgres_changes` su `public.sessions` e `public.subagents` per il client autenticato.

- [ ] **Step 1: Scrivere la migrazione**

`supabase/migrations/006_realtime_sessions_subagents.sql`:

```sql
-- Task 10 passo 1: cloni e mini-Ultron della Baracca letti da Supabase.
-- Senza la publication Supabase risponde SUBSCRIBED ma non emette mai
-- postgres_changes; replica identity full serve per valutare la RLS sulla riga.
alter publication supabase_realtime add table sessions, subagents;
alter table sessions replica identity full;
alter table subagents replica identity full;
```

- [ ] **Step 2: Allineare `schema.sql`**

In `supabase/schema.sql`, sostituire:

```sql
alter publication supabase_realtime add table agent_state;
alter table agent_state replica identity full;
```

con:

```sql
alter publication supabase_realtime add table agent_state;
alter table agent_state replica identity full;
-- migrazione 006: cloni e mini-Ultron della Baracca via Realtime
alter publication supabase_realtime add table sessions, subagents;
alter table sessions replica identity full;
alter table subagents replica identity full;
```

Poi: `cd panels && npx vitest run src/schema.test.ts` → PASS (confronta solo le colonne).

- [ ] **Step 3: Applicare la migrazione su Supabase**

Nel Chrome di Vincent (claude-in-chrome), dashboard Supabase del progetto della Baracca → **SQL Editor dalla barra laterale** (non per URL: evita il blocco "Vuoi uscire dal sito?") → nuova query → incollare il contenuto di `006_realtime_sessions_subagents.sql` → Run. Atteso: "Success. No rows returned".

- [ ] **Step 4: Verificare la publication**

Nello stesso SQL Editor:

```sql
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' order by tablename;
```

Atteso: `agent_state`, `sessions`, `subagents`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/006_realtime_sessions_subagents.sql supabase/schema.sql
git commit -m "feat(supabase): sessions e subagents in Realtime (migrazione 006)"
```

---

### Task 2: `baracca.html` — cloni e mini-Ultron da Supabase

**Files:**
- Create: `test_aux.mjs`
- Modify: `baracca.html` — funzione `subscribeRealtime()` (~riga 2362) e blocco SDOPPIAMENTO (`pollAux`, ~righe 2519-2571)

**Interfaces:**
- Consumes: `supaClient`, `USE_SUPABASE`, `CLONES`, `MINIS`, `ghost()`, `goTo()`, `puff()`, `R()`, `P` (già nella pagina); eventi Realtime del Task 1.
- Produces:
  - `sessionsFromRows(rows) -> {<transcript_path>: {status, room, node, ts}}`
  - `subagentsFromRows(rows) -> {list: [{id, room, agent, task, ts}]}`
  - `renderSessions(sessions)`, `renderSubagents(data)`, `reloadAux()`, `scheduleAuxReload()`

- [ ] **Step 1: Scrivere il test dei convertitori (fallisce)**

`test_aux.mjs` nella radice di `farm/`:

```js
// Check dei convertitori righe Supabase -> forme di /api/sessions e /api/subagents.
// Estrae il blocco AUX-PURE da baracca.html: la pagina non ha un build.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
const m = html.match(/\/\* AUX-PURE-START \*\/([\s\S]*?)\/\* AUX-PURE-END \*\//);
assert.ok(m, 'blocco AUX-PURE non trovato in baracca.html');
const { sessionsFromRows, subagentsFromRows } =
  new Function(m[1] + '; return { sessionsFromRows, subagentsFromRows };')();

// sessioni: indicizzate per transcript_path, campi null lasciati null
assert.deepEqual(
  sessionsFromRows([
    { transcript_path: '/a.jsonl', status: 'writing', room: 'prod', node: null, ts: 10 },
    { transcript_path: '/b.jsonl', status: 'idle', room: null, node: null, ts: 20 },
  ]),
  {
    '/a.jsonl': { status: 'writing', room: 'prod', node: null, ts: 10 },
    '/b.jsonl': { status: 'idle', room: null, node: null, ts: 20 },
  });
assert.deepEqual(sessionsFromRows([]), {});
assert.deepEqual(sessionsFromRows(null), {});

// sub-agenti: ts in millisecondi da created_at
assert.deepEqual(
  subagentsFromRows([
    { id: 7, room: 'ricerca', agent: 'ricerca-1', task: 'cerca', created_at: '2026-09-24T10:00:00+00:00' },
  ]),
  { list: [{ id: 7, room: 'ricerca', agent: 'ricerca-1', task: 'cerca', ts: Date.parse('2026-09-24T10:00:00Z') }] });
assert.deepEqual(subagentsFromRows(null), { list: [] });

console.log('test_aux: tutti i controlli passati');
```

Run: `node test_aux.mjs`
Atteso: FAIL con `blocco AUX-PURE non trovato in baracca.html`.

- [ ] **Step 2: Aggiungere i convertitori in `baracca.html`**

Subito prima della riga `var CLONES = [], MINIS = [];` (blocco SDOPPIAMENTO):

```js
/* AUX-PURE-START */
/* righe Supabase -> le stesse forme di /api/sessions e /api/subagents,
   così il disegno non sa da dove arrivano i dati */
function sessionsFromRows(rows){
  var out = {};
  (rows||[]).forEach(function(r){
    out[r.transcript_path] = {status:r.status, room:r.room, node:r.node, ts:r.ts};
  });
  return out;
}
function subagentsFromRows(rows){
  return {list: (rows||[]).map(function(r){
    return {id:r.id, room:r.room, agent:r.agent, task:r.task, ts:Date.parse(r.created_at)};
  })};
}
/* AUX-PURE-END */
```

Run: `node test_aux.mjs`
Atteso: `test_aux: tutti i controlli passati`.

- [ ] **Step 3: Separare il disegno dalla fonte**

Sostituire l'intera funzione `pollAux()` e le due righe seguenti (`setInterval(pollAux, 1200);` `pollAux();`) con:

```js
function renderSessions(sessions){
  var keys = Object.keys(sessions);
  if(!keys.length){ CLONES = []; return; }
  /* il titolare è la sessione con l'evento più recente in assoluto —
     è già lui a guidare ULTRON via agent_state, non gli serve un clone */
  var primary = keys.reduce(function(a,b){ return sessions[a].ts >= sessions[b].ts ? a : b; });
  var live = {};
  keys.forEach(function(key){
    if(key === primary) return;
    live[key] = true;
    var s = sessions[key];
    var c = CLONES.filter(function(x){ return x.key===key; })[0];
    if(!c){ c = ghost(2.6); c.key = key; CLONES.push(c); }
    if(s.status) c.status = s.status;
    if(s.room && R(s.room) && c.room !== s.room){ c.room = s.room; goTo(c, s.room, .3+Math.random()*.4, .5); }
  });
  CLONES = CLONES.filter(function(c){
    if(live[c.key]) return true;
    puff(c.x, c.y-20, P.violet, 10); return false;
  });
}

function renderSubagents(data){
  var ids = {};
  (data.list||[]).forEach(function(s){
    ids[s.id] = true;
    var m = MINIS.filter(function(x){ return x.id===s.id; })[0];
    if(!m){
      m = ghost(1.4); m.id = s.id; m.status = "delegating"; MINIS.push(m);
      if(s.room && R(s.room)) goTo(m, s.room, .2+Math.random()*.5, .6);
    }
  });
  MINIS = MINIS.filter(function(m){
    if(ids[m.id]) return true;
    puff(m.x, m.y-14, P.violet, 8); return false;
  });
}

/* ripiego locale: gira solo finché Realtime non ha preso il comando */
function pollAux(){
  if(USE_SUPABASE) return; // Realtime + reloadAux() se ne occupano
  fetch("/api/sessions", {cache:"no-store"}).then(function(r){ return r.ok?r.json():null; })
    .then(function(s){ if(s) renderSessions(s); }).catch(function(){});
  fetch("/api/subagents", {cache:"no-store"}).then(function(r){ return r.ok?r.json():null; })
    .then(function(d){ if(d) renderSubagents(d); }).catch(function(){});
}
setInterval(pollAux, 1200);
pollAux();

/* Supabase: una raffica di eventi Realtime diventa una sola rilettura */
var AUX_TIMER = null;
function scheduleAuxReload(){
  if(AUX_TIMER) return;
  AUX_TIMER = setTimeout(function(){ AUX_TIMER = null; reloadAux(); }, 300);
}

/* stesse soglie di read_sessions()/read_subagents() in server.py. Una select
   fallita non ridisegna niente: un buco di rete non deve svuotare la scena. */
function reloadAux(){
  if(!supaClient) return;
  supaClient.auth.getSession().then(function(res){
    var session = res.data && res.data.session;
    if(!session) return;
    var uid = session.user.id, now = Date.now();
    supaClient.from("sessions").select("transcript_path,status,room,node,ts")
      .eq("user_id", uid).gte("ts", now - 15*60*1000)
      .then(function(r){ if(r && !r.error && r.data) renderSessions(sessionsFromRows(r.data)); })
      .catch(function(){});
    supaClient.from("subagents").select("id,room,agent,task,created_at")
      .eq("user_id", uid).is("finished_at", null)
      .gte("created_at", new Date(now - 20*60*1000).toISOString())
      .then(function(r){ if(r && !r.error && r.data) renderSubagents(subagentsFromRows(r.data)); })
      .catch(function(){});
  }).catch(function(){});
}
/* senza eventi le sessioni ferme non scadrebbero mai: rilettura ogni minuto */
setInterval(function(){ if(USE_SUPABASE) reloadAux(); }, 60000);
```

Aggiornare anche il commento in testa al blocco SDOPPIAMENTO: sostituire `(sessions.json, scritto da` … `(subagents.json)` con la frase: `Fonte: Supabase (tabelle sessions/subagents via Realtime) quando USE_SUPABASE, altrimenti i file locali via /api/sessions e /api/subagents.` lasciando invariato il resto del commento.

- [ ] **Step 4: Ascoltare `sessions` e `subagents` sul canale esistente**

In `subscribeRealtime()`, sostituire:

```js
  supaClient.channel("agent_state_changes")
    .on("postgres_changes", {event:"*", schema:"public", table:"agent_state"}, function(payload){
      acceptLiveRow(payload.new);
    })
```

con:

```js
  supaClient.channel("agent_state_changes")
    .on("postgres_changes", {event:"*", schema:"public", table:"agent_state"}, function(payload){
      acceptLiveRow(payload.new);
    })
    /* cloni e mini-Ultron: l'evento è solo un campanello, reloadAux() rilegge */
    .on("postgres_changes", {event:"*", schema:"public", table:"sessions"}, scheduleAuxReload)
    .on("postgres_changes", {event:"*", schema:"public", table:"subagents"}, scheduleAuxReload)
```

e, nel ramo `if(status === "SUBSCRIBED"){`, subito dopo `USE_SUPABASE = true;`, aggiungere:

```js
        reloadAux(); // scena giusta subito, non solo al primo evento
```

- [ ] **Step 5: Controlli**

```bash
python3 -c "import re;h=open('baracca.html').read();[open('$TMPDIR/b%d.js'%i,'w').write(s) for i,s in enumerate(re.findall(r'<script>([\s\S]*?)</script>',h))]"
for f in "$TMPDIR"/b*.js; do node --check "$f" || echo "SINTASSI ROTTA: $f"; done
node test_aux.mjs
python3 test_server.py
(cd hooks && for t in test_*.py; do python3 "$t" || echo "FAIL $t"; done)
(cd panels && npx vitest run)
grep -c "AUX-PURE-START" baracca.html
```

Atteso: nessun "SINTASSI ROTTA", `test_aux` ok, `test_server.py` ok, nessun `FAIL`, vitest tutto verde, `1`.

- [ ] **Step 6: Commit parziale (solo le righe di questo task)**

La riga ~379 (`talkBtn`) è dell'altra sessione e resta fuori:

```bash
git diff -U0 baracca.html > "$TMPDIR/all.patch"
python3 - "$TMPDIR/all.patch" "$TMPDIR/mine.patch" <<'EOF'
import re, sys
src = open(sys.argv[1]).read()
head, *hunks = re.split(r'(?m)^(?=@@ )', src)
keep = [h for h in hunks if 'talkBtn' not in h]
assert len(keep) == len(hunks) - 1, "attesa esattamente una hunk talkBtn da escludere"
open(sys.argv[2], 'w').write(head + ''.join(keep))
EOF
git apply --cached --unidiff-zero "$TMPDIR/mine.patch"
git diff --cached --stat
git diff baracca.html | grep -c talkBtn   # atteso 2: la riga dell'altra sessione resta nel working tree
git add test_aux.mjs
git commit -m "feat(baracca): cloni e mini-Ultron letti da Supabase via Realtime, file locali come ripiego"
```

---

### Task 3: prova dal vivo e documentazione

**Files:**
- Modify (vault): `05 - Resources/La Baracca di Ultron - Design.md`, `Active Priorities.md`, daily note del giorno

**Interfaces:**
- Consumes: Task 1 (publication) e Task 2 (pagina).
- Produces: evidenza che il criterio di "fatto" della spec è soddisfatto.

- [ ] **Step 1: Server e pagina**

Se il server sulla 8795 non risponde (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8795/baracca.html`), avviarlo con `python3 server.py` in background dalla cartella `farm/`. Aprire `http://127.0.0.1:8795/baracca.html` nel Chrome di Vincent (claude-in-chrome, scheda nuova), ricaricare.

- [ ] **Step 2: Realtime attivo**

Con `javascript_tool` sulla scheda: `USE_SUPABASE` → atteso `true`; pillola `#mode` → `LIVE` (o `DEMO` se nessun evento negli ultimi 15 min: in quel caso lanciare un tool qualsiasi e ricontrollare).

- [ ] **Step 3: Clone da una riga scritta a mano**

```bash
set -a; . ~/.config/baracca/.env; set +a
NOW=$(python3 -c 'import time;print(int(time.time()*1000))')
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SUPABASE_URL/rest/v1/sessions" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d "{\"user_id\":\"$SUPABASE_USER_ID\",\"transcript_path\":\"/prova-task10.jsonl\",\"status\":\"writing\",\"room\":\"qa\",\"ts\":$NOW}"
```

Atteso `201`. Entro ~1 s, con `javascript_tool`: `CLONES.map(function(c){return c.key})` contiene `/prova-task10.jsonl` (e screenshot: clone nel COLLAUDO). Poi:

```bash
set -a; . ~/.config/baracca/.env; set +a
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE \
  "$SUPABASE_URL/rest/v1/sessions?transcript_path=eq.%2Fprova-task10.jsonl&user_id=eq.$SUPABASE_USER_ID" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

Atteso `204`; entro ~1 s il clone sparisce.

- [ ] **Step 4: Mini-Ultron da un sub-agente vero**

Da questa sessione, lanciare un sub-agente breve (Explore, "elenca i file in farm/supabase/migrations"). Durante il lavoro: `MINIS.length >= 1`; al rientro: il mini sparisce entro ~1 s. Con `read_network_requests` (pattern `api/(sessions|subagents)`): dopo che `USE_SUPABASE` è diventato vero non compare più nessuna richiesta nuova (quelle dei primi secondi dopo il caricamento, prima del SUBSCRIBED, sono normali).

- [ ] **Step 5: Ripiego locale**

Con `javascript_tool`: `USE_SUPABASE = false` → entro 2 s `read_network_requests` mostra di nuovo `/api/sessions` e `/api/subagents`. Ricaricare la pagina per tornare allo stato normale.

- [ ] **Step 6: Vault**

- `La Baracca di Ultron - Design.md`: sotto il paragrafo "Task 10, cosa c'è davvero sotto", aggiungere lo stato del passo 1 (commit, migrazione 006 applicata, prove passate) e che il passo 2 resta aperto.
- `Active Priorities.md`: nella voce della Baracca, "togliere la doppia scrittura" → passo 1 FATTO con commit; passo 2 aperto (dopo qualche giorno d'uso e dopo il lavoro Discord su `server.py`).
- Daily note: sezione della sessione con commit e esito prove.
- Rileggere i tre file per confermare che le modifiche ci sono.
