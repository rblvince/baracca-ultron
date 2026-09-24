# Porting DASHBOARD in React — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riscrivere la vista DASHBOARD (`#dashv`) di `baracca.html` come isola React in `panels/`, identica a occhio a oggi, con tipi stretti e test, cancellando il codice vanilla che la disegna.

**Architecture:** Il vanilla costruisce a ogni giro un'istantanea tipizzata con la funzione pura `dashSnapshot(m)` (blocco `DASH-PURE` in `baracca.html`, testato da Node) e la pubblica con `DASH.publish(...)`. Un'unica radice React (`mountDashboard`) disegna i tre gruppi dentro tre "slot" della griglia `#dashv` con `createPortal`; uno store tiene per sezione l'ultimo valore strutturalmente diverso, così i pannelli si ridisegnano solo quando cambiano. Gli sprite pixel-art e le schede di dettaglio restano del motore e arrivano a React come funzioni, una volta al montaggio.

**Tech Stack:** React 19.3, TypeScript 5.9.3, Vite 8.3 (bundle IIFE `panels/dist/panels.js`), Vitest 5 + Testing Library + jsdom; Node per i blocchi puri di `baracca.html`; Python per gli altri test del repo.

**Spec:** `farm/docs/superpowers/specs/2026-09-24-dashboard-react-design.md` (commit `c4756dd`).

## Global Constraints

- Scopo: solo portfolio. Niente dati da Supabase per la dashboard, niente telefono/gemello pubblico, niente funzioni nuove, niente restyling.
- Aspetto identico: i componenti usano le stesse classi CSS, gli stessi `id` e gli stessi testi del vanilla di oggi. Nessuna regola CSS esistente si modifica; si aggiunge solo `.dslot{display:contents;}`.
- Tipi stretti: niente `any`; `npx tsc --noEmit` pulito.
- Restano vanilla: schede di dettaglio (`openItemDetail`, `showMissionDetail`, `showTaskDetail`), pannello missioni a destra (`renderMissions`), motore, sprite, `server.py`, vista BASE (compreso il suo mini-segnale `spx`).
- Nessun HTML costruito da React passa al vanilla: le schede si aprono con funzioni specifiche (`openPriority(text)`, `openMission(index)`, `openTask(id)`, `openDelivered(name)`), l'escape resta nel vanilla.
- Commit locali, uno per task. Push solo su ok di Vincent.
- Coordinamento: `baracca.html` è condiviso con un'altra sessione. Prima di ogni task che tocca `baracca.html`: `git -C ~/my-agent/farm status --short baracca.html` deve essere vuoto; se non lo è, fermarsi e chiedere. Mandare all'altra sessione (SendMessage, nome da ListAgents) "tocco `#dashv`, `renderDashLive` e le funzioni della dashboard in baracca.html, non il resto".

**Scostamenti dalla spec (dettagli emersi scrivendo il piano, da confermare con Vincent insieme al piano):**
1. `mountDashboard(slots, engine)` al posto di `mountDashboard(el, client, opts)`: i gruppi migrano uno alla volta e stanno in punti diversi della griglia, quindi una radice sola con tre slot (portal). Il client Supabase arriva dopo, con `attachStorico(client)` (Task 7), perché la dashboard deve funzionare anche in DEMO senza login.
2. Le schede si aprono con quattro funzioni specifiche invece di un `openDetail(title, sub, html)` generico: così React non costruisce mai HTML.
3. `shelf` (lo scaffale) è una sezione a sé dell'istantanea, sempre presente con sei righe, perché lo scaffale si disegna anche a vault giù (a zero).

## Review Focus

1. Dashboard aperta prima che il vault risponda → testi di attesa di oggi ("in attesa del vault…", identità "Ultron"), mai un pannello vuoto o un errore (Task 1 `vault: null`; Task 3 e 4 test "loading").
2. Vault che cade dopo essere stato letto → "vault non raggiungibile · avvia start.sh", identità "Ultron · in attesa del vault", scaffale a zero; la bacheca continua a mostrare le missioni dell'ultimo vault buono come oggi (Task 1 test `vaultDown`; Task 3/4 test "down").
3. Istantanee identiche ogni 110 ms → nessun ridisegno dei pannelli (Task 2 test sullo store: stessa identità di oggetto per sezione uguale).
4. Un pannello che lancia un'eccezione → "pannello non disponibile" al suo posto, il resto della dashboard e la scena vivi (Task 2 test boundary).
5. Dashboard chiusa → animazione del ritratto ferma, nessun `requestAnimationFrame` attivo (Task 6 test `setActive(false)`).

---

## File Structure

| File | Responsabilità |
|---|---|
| `baracca.html` | blocco `DASH-PURE` (`dashSnapshot`), `VAULT_DOWN`, motore→ponte (`dashEngine()`, `dashOnce()`, `dashState()`), slot al posto dei gruppi, cancellazioni |
| `test_dash.mjs` (nuovo) | test Node del blocco `DASH-PURE` |
| `panels/src/dash/types.ts` | `DashSnapshot` e sezioni, `Engine`, `Slots` |
| `panels/src/dash/store.ts` | store per sezione con uguaglianza strutturale + hook `useSection` |
| `panels/src/dash/Boundary.tsx` | error boundary dei pannelli |
| `panels/src/dash/SpriteSlot.tsx` | inserisce una volta il canvas sprite dato dal motore |
| `panels/src/dash/mountDashboard.tsx` | radice React, portal negli slot, API `publish/setActive/attachStorico/unmount` |
| `panels/src/dash/fmt.ts` | `mmss`, `pct` |
| `panels/src/dash/shelf.ts`, `pulse.ts` | geometria pura di scaffale e segnale |
| `panels/src/dash/Memoria.tsx` | `Archivio`, `Diario`, `Vinland` |
| `panels/src/dash/Lavoro.tsx` | `Operativi`, `BachecaMissioni`, `PrioritaAperte`, `Specialisti`, `TempoPerReparto` |
| `panels/src/dash/Sessione.tsx` | `Testata` (ritratto), `Segnale`, `PonteHook` |
| `panels/src/dash/fixture.ts` | istantanea finta per i test |
| `panels/src/mount.tsx` | entry del bundle: importa `dash/mountDashboard` (e, a fine Task 7, non esporta più `mountStorico`) |

Comandi di prova (tutti da `~/my-agent/farm`):
- `node test_dash.mjs` · `node test_aux.mjs`
- `(cd panels && npx vitest run && npx tsc --noEmit)`
- `for f in hooks/test_*.py test_server.py; do python3 $f | tail -1; done`
- build: `(cd panels && npm run build)`

---

### Task 1: L'istantanea (`dashSnapshot`, tipi, `VAULT_DOWN`)

**Files:**
- Create: `panels/src/dash/types.ts`, `test_dash.mjs`
- Modify: `baracca.html` (nuovo blocco `DASH-PURE` subito prima di `/* AUX-PURE-START */`; `refreshVault` riga ~2795)

**Interfaces:**
- Produces (JS, `baracca.html`): `dashSnapshot(m) -> DashSnapshot`; globale `VAULT_DOWN` (boolean).
- Produces (TS): tipi `DashSnapshot`, `DashHeader`, `DashSignal`, `DashLink`, `CrewCard`, `DashBoard`, `SkillCard`, `RoomTimeRow`, `ShelfRow`, `VaultSnap`, `Engine`, `Slots`.

- [ ] **Step 1: Scrivi i tipi**

`panels/src/dash/types.ts`:

```ts
// Istantanea della sala comando pubblicata dal vanilla (dashSnapshot in
// baracca.html, blocco DASH-PURE). Oggetti semplici: niente funzioni, niente DOM.

export type LinkKey = 'prompt' | 'tool' | 'sub' | 'stop';

export type DashHeader = {
  status: string;          // parola dello stato (stateWord)
  rawStatus: string;       // STATE.status grezzo, per l'animazione del ritratto
  color: string;           // stColor()
  where: string;           // "in OFFICINA", "nel corridoio", …
  whereBold: string | null; // nodo o compito, in grassetto dopo " · "
  identity: string;        // "Ultron · chief of staff…", "Ultron · in attesa del vault", "Ultron"
  clock: string;           // testo di #coreClock
  live: boolean;
  lastSeenS: number | null; // secondi dall'ultimo segnale se LIVE, altrimenti null ("demo")
  moving: boolean;
};

export type DashSignal = {
  pulse: number[];         // pulseHist, 48 valori 0..1
  events: number;
  perMin: string | null;   // "3.4" oppure null ("—")
  lastTool: string;        // nome grezzo (title)
  lastToolLabel: string;   // toolLabel(LAST_TOOL)
  node: string;            // già tagliato a 14 caratteri
};

export type DashLink = { hit: Record<LinkKey, boolean>; last: LinkKey | null; hot: boolean };

export type CrewCard = {
  id: string; name: string; color: string;
  role: string;            // nome del reparto, "IN CAMMINO" o "PORTA CASSA"
  busy: boolean;
  tokens: [number, number, number, number] | null; // in, out, cache-r, cache-w (solo LIVE)
};

export type RealPaper = { index: number; title: string; done: number; total: number; nextTag: string | null };
export type ScenePaper = { id: number; text: string; p: number; stage: string; qa: boolean };
export type DashBoard = {
  real: RealPaper[];
  scene: ScenePaper[];     // già vuoto se LIVE
  delivered: string[];     // già vuoto se LIVE
  deliveredCount: number;
  live: boolean;
  sub: string;             // "2 ATTIVE" oppure "3 IN CORSO · 5 CONSEGNATE"
};

export type SkillCard = { id: string; name: string; color: string; desc: string; uses: number; hot: boolean; where: string };
export type RoomTimeRow = { id: string; name: string; color: string; ms: number }; // già ordinate, dalla più alta
export type ShelfRow = { label: string; count: number; color: string };

export type VaultSnap = {
  priorities: { open: string[]; completed: number }; // testi già ripuliti dal Markdown
  vinland: { status: string | null; jobs: { name: string; steps: number }[] };
  daily: { latest: string | null; count: number };
};

export type Palette = { gold: string; cyan: string; violet: string; green: string; red: string };

export type DashSnapshot = {
  header: DashHeader;
  signal: DashSignal;
  link: DashLink;
  crew: CrewCard[];
  board: DashBoard;
  skills: SkillCard[];
  roomTime: RoomTimeRow[];
  shelf: ShelfRow[];                  // sempre 6 righe
  vault: VaultSnap | 'down' | null;   // null = non ancora letto
  debugRaw: { label: string; json: string } | null; // solo con #debug
  palette: Palette;
};

/** Quello che solo il motore sa fare, passato una volta al montaggio. */
export type Engine = {
  sprites: {
    bust(status: string, blink: boolean, talk: boolean): CanvasImageSource;
    crew(id: string): HTMLCanvasElement;  // canvas 24×30 già disegnato
    spec(id: string): HTMLCanvasElement;  // canvas 22×32 già disegnato
  };
  openPriority(text: string): void;
  openMission(index: number): void;
  openTask(id: number): void;
  openDelivered(name: string): void;
};

export type Slots = { sessione?: HTMLElement; lavoro?: HTMLElement; memoria?: HTMLElement; storico?: HTMLElement };
```

- [ ] **Step 2: Scrivi il test Node che fallisce**

`test_dash.mjs`:

```js
// Check di dashSnapshot (blocco DASH-PURE di baracca.html): l'istantanea che
// il vanilla pubblica alla dashboard React. Stesso metodo di test_aux.mjs.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
const m = html.match(/\/\* DASH-PURE-START \*\/([\s\S]*?)\/\* DASH-PURE-END \*\//);
assert.ok(m, 'blocco DASH-PURE non trovato in baracca.html');
const { dashSnapshot } = new Function(m[1] + '; return { dashSnapshot };')();

const ROOMS = [{ id: 'ricerca', n: 'RICERCA', c: '#111' }, { id: 'prod', n: 'OFFICINA', c: '#222' }];
const R = (id) => ROOMS.find((r) => r.id === id) || ROOMS[0];
const P = { gold: '#g', cyan: '#c', violet: '#v', green: '#gr', red: '#r', blue: '#b' };
const mission = { title: 'Supabase', steps: [{ done: true, text: 'a' }, { done: false, text: 'Passo 2 — fare: perché' }] };

function base(over = {}) {
  return {
    now: 120000, startTs: 0, hash: '', live: false, lastSeen: 0,
    state: { status: 'writing', room: 'prod', node: null, task: null, target: null, tokens: null },
    statusWord: 'scrive', statusColor: '#gold', taskText: '', clock: '01:02',
    moving: false, skfxName: null,
    events: 6, lastTool: 'Edit', lastToolLabel: 'modifica', lastNode: 'Active Priorities.md', lastState: null,
    crew: [{ id: 'ricerca-1', n: 'RIC-1', col: '#a', room: 'ricerca', home: 'ricerca', moving: false }],
    tasks: [{ id: 7, t: 'vetrina · revisione', p: 0.5, stage: 1, st: 'work', carrier: 'ricerca-1' }],
    skills: [{ id: 'taste', n: 'TASTE', c: '#s', d: 'gusto', uses: 2, last: 119000, escort: null, moving: false }],
    rooms: ROOMS, roomTime: { ricerca: 1000, prod: 5000 }, stages: ['ricerca', 'prod'],
    deliveredLog: ['recapito · script'], delivered: 1,
    pulse: [0, 0.5, 1], link: { hit: { tool: true }, last: 'tool', at: 119000 },
    vault: null, vaultDown: false, P,
    R, activeMissions: (v) => (v && v.missions || []).filter((x) => x.steps.some((s) => !s.done)),
    nextStep: (x) => x.steps.findIndex((s) => !s.done),
    missionStepParts: (s) => ({ tag: s.text.split(' — ')[0] }),
    plainMd: (t) => t.replace(/\*\*/g, ''),
    ...over,
  };
}

// DEMO, vault non ancora letto
{
  const s = dashSnapshot(base());
  assert.equal(s.header.where, 'in OFFICINA');
  assert.equal(s.header.identity, 'Ultron');
  assert.equal(s.header.lastSeenS, null);
  assert.equal(s.vault, null);
  assert.equal(s.signal.perMin, '3.0');                 // 6 eventi in 2 minuti
  assert.equal(s.signal.node, 'Active Priorit');         // 14 caratteri
  assert.deepEqual(s.link, { hit: { prompt: false, tool: true, sub: false, stop: false }, last: 'tool', hot: true });
  assert.deepEqual(s.crew[0], { id: 'ricerca-1', name: 'RIC-1', color: '#a', role: 'PORTA CASSA', busy: true, tokens: null });
  assert.deepEqual(s.board.scene, [{ id: 7, text: 'vetrina · revisione', p: 0.5, stage: 'OFFICINA', qa: false }]);
  assert.deepEqual(s.board.delivered, ['recapito · script']);
  assert.equal(s.board.sub, '1 IN CORSO · 1 CONSEGNATE');
  assert.deepEqual(s.skills[0], { id: 'taste', name: 'TASTE', color: '#s', desc: 'gusto', uses: 2, hot: true, where: 'al posto' });
  assert.deepEqual(s.roomTime.map((r) => r.id), ['prod', 'ricerca']);   // dalla più alta
  assert.equal(s.shelf.length, 6);
  assert.ok(s.shelf.every((r) => r.count === 0));
  assert.equal(s.debugRaw, null);
}

// LIVE con vault letto, token per reparto, #debug
{
  const vault = {
    identity: { name: 'Ultron', role: 'chief of staff' },
    priorities: { open: ['**uno**', 'due'], completed_count: 4 },
    vinland: { status: 'Planning', jobs: [{ name: 'trend', steps: [1, 2] }] },
    daily: { latest: '2026-09-24', count: 18 },
    inbox: { notes: [1] }, personal: { notes: [] }, resources: { notes: [1, 2] }, archive: { notes: [] },
    missions: [mission],
  };
  const s = dashSnapshot(base({
    live: true, lastSeen: 117000, hash: '#debug', vault,
    state: { status: 'writing', room: null, node: 'x.md', task: null, target: null, tokens: { ricerca: { in: 1, out: 2, cread: 3, cwrite: 4 } } },
    lastState: { status: 'writing' },
  }));
  assert.equal(s.header.lastSeenS, 3);
  assert.equal(s.header.where, 'nel corridoio');
  assert.equal(s.header.whereBold, 'x.md');
  assert.equal(s.header.identity, 'Ultron · chief of staff');
  assert.deepEqual(s.vault.priorities, { open: ['uno', 'due'], completed: 4 });
  assert.deepEqual(s.vault.vinland, { status: 'planning', jobs: [{ name: 'trend', steps: 2 }] });
  assert.deepEqual(s.shelf.map((r) => r.count), [1, 18, 1, 0, 2, 0]);
  assert.deepEqual(s.crew[0].tokens, [1, 2, 3, 4]);
  assert.deepEqual(s.board.real, [{ index: 0, title: 'Supabase', done: 1, total: 2, nextTag: 'Passo 2' }]);
  assert.deepEqual(s.board.scene, []);
  assert.deepEqual(s.board.delivered, []);
  assert.equal(s.board.sub, '1 ATTIVE');
  assert.deepEqual(s.debugRaw, { label: 'state.json', json: '{"status":"writing"}' });
}

// vault caduto dopo una lettura buona: pannelli "down", bacheca tiene le missioni
{
  const s = dashSnapshot(base({ vault: { missions: [mission], identity: {} }, vaultDown: true }));
  assert.equal(s.vault, 'down');
  assert.equal(s.header.identity, 'Ultron · in attesa del vault');
  assert.equal(s.board.real.length, 1);
  assert.ok(s.shelf.every((r) => r.count === 0));
}

// in cammino verso l'arsenale, pochi secondi dall'avvio (perMin "—"), compito in grassetto
{
  const s = dashSnapshot(base({ now: 5000, moving: true, skfxName: 'TASTE', taskText: 'Bash', state: { status: 'thinking', room: null, node: null, task: 't', target: null, tokens: null } }));
  assert.equal(s.header.where, "verso l'arsenale · TASTE");
  assert.equal(s.header.whereBold, 'Bash');
  assert.equal(s.signal.perMin, null);
}

console.log('test_dash: tutti i controlli passati');
```

- [ ] **Step 3: Verifica che fallisca**

Run: `node test_dash.mjs`
Expected: `AssertionError … blocco DASH-PURE non trovato in baracca.html`

- [ ] **Step 4: Scrivi `dashSnapshot` e `VAULT_DOWN`**

In `baracca.html`, subito prima di `/* AUX-PURE-START */`:

```js
/* DASH-PURE-START */
/* L'istantanea della sala comando per l'isola React (panels/src/dash). Legge
   solo quello che le passa il chiamante (m, vedi dashState()), mai le globali:
   così test_dash.mjs la prova da Node. */
function dashSnapshot(m){
  var st = m.state || {}, live = !!m.live;
  var vaultOk = m.vault && !m.vaultDown ? m.vault : null;
  var where = m.moving
    ? (m.skfxName ? "verso l'arsenale · "+m.skfxName : st.target ? "in cammino verso "+m.R(st.target).n : "nel corridoio")
    : (st.room ? "in "+m.R(st.room).n : "nel corridoio");
  var id = vaultOk && vaultOk.identity || {};
  var identity = vaultOk ? (id.name||"Ultron") + (id.role ? " · "+id.role : "")
    : m.vaultDown ? "Ultron · in attesa del vault" : "Ultron";
  var mins = (m.now - m.startTs)/60000;
  var hit = m.link.hit || {};
  var realMs = m.activeMissions(m.vault);
  var scene = live ? [] : m.tasks;
  function n(o){ return o && o.notes ? o.notes.length : 0; }
  var v = vaultOk;
  return {
    header: {
      status: m.statusWord, rawStatus: st.status, color: m.statusColor,
      where: where, whereBold: st.node ? st.node : st.task ? m.taskText : null,
      identity: identity, clock: m.clock, live: live,
      lastSeenS: live ? Math.max(0, Math.round((m.now - m.lastSeen)/1000)) : null,
      moving: !!m.moving
    },
    signal: {
      pulse: m.pulse.slice(), events: m.events,
      perMin: mins > .2 ? (m.events/mins).toFixed(1) : null,
      lastTool: m.lastTool, lastToolLabel: m.lastToolLabel, node: String(m.lastNode).slice(0,14)
    },
    link: {
      hit: {prompt: !!hit.prompt, tool: !!hit.tool, sub: !!hit.sub, stop: !!hit.stop},
      last: m.link.last || null, hot: m.now - m.link.at < 1600
    },
    crew: m.crew.map(function(a){
      var carrying = m.tasks.filter(function(k){ return k.carrier === a.id; })[0];
      var td = live && st.tokens && st.tokens[a.home];
      return {id: a.id, name: a.n, color: a.col,
              role: carrying ? "PORTA CASSA" : a.moving ? "IN CAMMINO" : m.R(a.room).n,
              busy: !!carrying || !!a.moving,
              tokens: td ? [td.in||0, td.out||0, td.cread||0, td.cwrite||0] : null};
    }),
    board: {
      real: realMs.map(function(ms, i){
        var nx = m.nextStep(ms);
        return {index: i, title: ms.title, done: ms.steps.filter(function(s){ return s.done; }).length,
                total: ms.steps.length, nextTag: nx > -1 ? m.missionStepParts(ms.steps[nx]).tag : null};
      }),
      scene: scene.map(function(k){
        return {id: k.id, text: k.t, p: k.p, stage: m.stages[k.stage] ? m.R(m.stages[k.stage]).n : "—", qa: k.st === "qa"};
      }),
      delivered: live ? [] : m.deliveredLog.slice(),
      deliveredCount: m.delivered, live: live,
      sub: live ? realMs.length+" ATTIVE" : m.tasks.length+" IN CORSO · "+m.delivered+" CONSEGNATE"
    },
    skills: m.skills.map(function(sk){
      return {id: sk.id, name: sk.n, color: sk.c, desc: sk.d, uses: sk.uses||0,
              hot: !!(sk.last && m.now - sk.last < 4000),
              where: sk.escort ? "al seguito · "+m.R(sk.escort).n.toLowerCase() : sk.moving ? "in cammino" : "al posto"};
    }),
    roomTime: m.rooms.map(function(r){ return {id: r.id, name: r.n, color: r.c, ms: m.roomTime[r.id]||0}; })
      .sort(function(a,b){ return b.ms - a.ms; }),
    shelf: [
      {label:"00 INBOX",     count: v ? n(v.inbox) : 0, color: m.P.cyan},
      {label:"01 DAILY",     count: v ? (v.daily && v.daily.count)||0 : 0, color: m.P.violet},
      {label:"02 VINLAND",   count: v ? ((v.vinland && v.vinland.jobs)||[]).length : 0, color: m.P.gold},
      {label:"03 PERSONAL",  count: v ? n(v.personal) : 0, color: m.P.green},
      {label:"05 RESOURCES", count: v ? n(v.resources) : 0, color: m.P.blue},
      {label:"04 ARCHIVE",   count: v ? n(v.archive) : 0, color: "#7d715c"}
    ],
    vault: m.vaultDown ? "down" : !v ? null : {
      priorities: {open: ((v.priorities && v.priorities.open) || []).map(m.plainMd),
                   completed: (v.priorities && v.priorities.completed_count) || 0},
      vinland: {status: v.vinland && v.vinland.status ? v.vinland.status.toLowerCase() : null,
                jobs: ((v.vinland && v.vinland.jobs) || []).map(function(j){ return {name: j.name, steps: (j.steps||[]).length}; })},
      daily: {latest: (v.daily && v.daily.latest) || null, count: (v.daily && v.daily.count) || 0}
    },
    debugRaw: m.hash !== "#debug" ? null : {
      label: live ? "state.json" : "simulato",
      json: live && m.lastState ? JSON.stringify(m.lastState) : JSON.stringify({status: st.status, room: st.room, node: st.node||null})
    },
    palette: {gold: m.P.gold, cyan: m.P.cyan, violet: m.P.violet, green: m.P.green, red: m.P.red}
  };
}
/* DASH-PURE-END */
```

In `refreshVault` (riga ~2795), segna se il vault è giù senza cancellare l'ultimo buono:

```js
var VAULT_DOWN = false;
function refreshVault(){
  if(Date.now()-vaultTs < 15000 && VAULT) { renderVault(VAULT); return; }
  fetch("/api/vault", {cache:"no-store"})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(v){ if(v){ VAULT = v; VAULT_DOWN = false; vaultTs = Date.now(); renderVault(v); } else { VAULT_DOWN = true; renderVault(null); } })
    .catch(function(){ VAULT_DOWN = true; renderVault(null); });
}
```

- [ ] **Step 5: Verifica che passi, e che il resto non si sia rotto**

Run: `node test_dash.mjs && node test_aux.mjs`
Expected: `test_dash: tutti i controlli passati` e `test_aux: tutti i controlli passati`

- [ ] **Step 6: Commit**

```bash
git add baracca.html test_dash.mjs panels/src/dash/types.ts
git commit -m "feat(dashboard): istantanea tipizzata della sala comando (DASH-PURE)"
```

---

### Task 2: Il ponte React (store, boundary, `mountDashboard`, pubblicazione dal vanilla)

**Files:**
- Create: `panels/src/dash/store.ts`, `panels/src/dash/Boundary.tsx`, `panels/src/dash/SpriteSlot.tsx`, `panels/src/dash/mountDashboard.tsx`, `panels/src/dash/fixture.ts`, `panels/src/dash/store.test.ts`, `panels/src/dash/mountDashboard.test.tsx`
- Modify: `panels/src/mount.tsx` (una riga di import), `baracca.html` (motore→ponte e chiamata a `publish` dentro `renderDashLive`)

**Interfaces:**
- Consumes: `DashSnapshot`, `Engine`, `Slots` (Task 1); `dashSnapshot(m)` e `VAULT_DOWN` (Task 1).
- Produces (TS): `createStore()`, `useSection(key)`, `StoreCtx`, `EngineCtx`, `ActiveCtx`, `useEngine()`, `useActive()`, `PanelBoundary`, `SpriteSlot`, `fakeSnap(over?)`, `fakeEngine()`, `mountDashboard(slots, engine): DashHandle`, `DashHandle = { publish(s), setActive(b), attachStorico(client, rooms), unmount() }`, `window.mountDashboard`.
- Produces (JS, `baracca.html`): `DASH` (handle o null), `dashOnce()`, `dashEngine()`, `dashState()`.
- I tre gruppi (`Sessione`, `Lavoro`, `Memoria`) non esistono ancora: in questo task `mountDashboard` rende un portal solo per gli slot passati, e nessuno slot è ancora nella pagina. Nessun cambiamento visibile.

- [ ] **Step 1: Test dello store (fallisce)**

`panels/src/dash/store.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';
import { fakeSnap } from './fixture';

describe('store della dashboard', () => {
  it('prima della prima istantanea ogni sezione è null', () => {
    expect(createStore().get('crew')).toBeNull();
  });
  it('una sezione uguale nel contenuto mantiene lo stesso oggetto: niente ridisegno', () => {
    const s = createStore();
    s.publish(fakeSnap());
    const crew = s.get('crew'), header = s.get('header');
    s.publish(fakeSnap({ header: { ...fakeSnap().header, clock: '09:99' } }));
    expect(s.get('crew')).toBe(crew);           // stessa identità
    expect(s.get('header')).not.toBe(header);   // cambiata davvero
    expect(s.get('header')!.clock).toBe('09:99');
  });
  it('avvisa gli abbonati solo se qualcosa è cambiato', () => {
    const s = createStore(), cb = vi.fn();
    s.subscribe(cb);
    s.publish(fakeSnap());
    s.publish(fakeSnap());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/store.test.ts`
Expected: FAIL, `Failed to resolve import "./store"`

- [ ] **Step 3: Store e fixture**

`panels/src/dash/store.ts`:

```ts
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DashSnapshot, Engine } from './types';

type Key = keyof DashSnapshot;

/** Tiene l'ultima istantanea sezione per sezione. Una sezione uguale nel
 *  contenuto (JSON) conserva il vecchio oggetto: useSyncExternalStore vede la
 *  stessa identità e il pannello non si ridisegna. Il vanilla pubblica ogni
 *  110 ms, quindi è questo che tiene ferma la dashboard quando niente cambia. */
export function createStore() {
  let snap: Partial<DashSnapshot> = {};
  const json: Partial<Record<Key, string>> = {};
  const listeners = new Set<() => void>();
  return {
    publish(next: DashSnapshot) {
      let changed = false;
      const merged: Partial<DashSnapshot> = { ...snap };
      for (const k of Object.keys(next) as Key[]) {
        const j = JSON.stringify(next[k]);
        if (j !== json[k]) { json[k] = j; (merged as Record<Key, unknown>)[k] = next[k]; changed = true; }
      }
      if (!changed) return;
      snap = merged;
      listeners.forEach((l) => l());
    },
    get<K extends Key>(k: K): DashSnapshot[K] | null { return (snap[k] as DashSnapshot[K] | undefined) ?? null; },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}
export type DashStore = ReturnType<typeof createStore>;

export const StoreCtx = createContext<DashStore | null>(null);
export const EngineCtx = createContext<Engine | null>(null);
export const ActiveCtx = createContext(false);

export function useSection<K extends Key>(k: K): DashSnapshot[K] | null {
  const store = useContext(StoreCtx)!;
  return useSyncExternalStore(store.subscribe, () => store.get(k));
}
export const useEngine = () => useContext(EngineCtx)!;
export const useActive = () => useContext(ActiveCtx);
```

`panels/src/dash/fixture.ts` (solo per i test: non è raggiungibile da `mount.tsx`, quindi non entra nel bundle):

```ts
import { vi } from 'vitest';
import type { DashSnapshot, Engine } from './types';

/** Motore finto: sprite riconoscibili dal data-sprite, schede spiate. */
export const fakeEngine = (): Engine => ({
  sprites: {
    bust: () => document.createElement('canvas'),
    crew: (id) => { const c = document.createElement('canvas'); c.dataset.sprite = id; return c; },
    spec: (id) => { const c = document.createElement('canvas'); c.dataset.sprite = id; return c; },
  },
  openPriority: vi.fn(), openMission: vi.fn(), openTask: vi.fn(), openDelivered: vi.fn(),
});

/** Istantanea finta ma completa, per i test dei pannelli. */
export function fakeSnap(over: Partial<DashSnapshot> = {}): DashSnapshot {
  return {
    header: { status: 'scrive', rawStatus: 'writing', color: '#e08a4a', where: 'in OFFICINA', whereBold: 'x.md',
              identity: 'Ultron · chief of staff', clock: '01:02', live: true, lastSeenS: 3, moving: false },
    signal: { pulse: [0, 0.5, 1], events: 6, perMin: '3.0', lastTool: 'Edit', lastToolLabel: 'modifica', node: 'x.md' },
    link: { hit: { prompt: true, tool: true, sub: false, stop: false }, last: 'tool', hot: true },
    crew: [{ id: 'ricerca-1', name: 'RIC-1', color: '#229fb3', role: 'RICERCA', busy: false, tokens: [1, 2, 3, 4] },
           { id: 'produzione-1', name: 'PRD-1', color: '#2aa883', role: 'PORTA CASSA', busy: true, tokens: null }],
    board: { real: [{ index: 0, title: 'Supabase', done: 1, total: 2, nextTag: 'Passo 2' }],
             scene: [], delivered: [], deliveredCount: 0, live: true, sub: '1 ATTIVE' },
    skills: [{ id: 'taste', name: 'TASTE', color: '#9c6fc4', desc: 'gusto', uses: 2, hot: true, where: 'al posto' }],
    roomTime: [{ id: 'prod', name: 'OFFICINA', color: '#2aa883', ms: 65000 }, { id: 'ricerca', name: 'RICERCA', color: '#229fb3', ms: 0 }],
    shelf: [{ label: '00 INBOX', count: 1, color: '#229fb3' }, { label: '01 DAILY', count: 18, color: '#9c6fc4' },
            { label: '02 VINLAND', count: 1, color: '#e08a4a' }, { label: '03 PERSONAL', count: 0, color: '#2aa883' },
            { label: '05 RESOURCES', count: 2, color: '#4f8fc4' }, { label: '04 ARCHIVE', count: 0, color: '#7d715c' }],
    vault: { priorities: { open: ['uno', 'due'], completed: 4 },
             vinland: { status: 'planning', jobs: [{ name: 'ricerca trend settimanale', steps: 3 }] },
             daily: { latest: '2026-09-24', count: 18 } },
    debugRaw: null,
    palette: { gold: '#e08a4a', cyan: '#229fb3', violet: '#9c6fc4', green: '#2aa883', red: '#d9483a' },
    ...over,
  };
}
```

- [ ] **Step 4: Verifica che passi**

Run: `cd panels && npx vitest run src/dash/store.test.ts`
Expected: 3 passed

- [ ] **Step 5: Test di `mountDashboard` (fallisce)**

`panels/src/dash/mountDashboard.test.tsx`:

```tsx
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mountDashboard } from './mountDashboard';
import { PanelBoundary } from './Boundary';
import { render, screen } from '@testing-library/react';
import { fakeEngine } from './fixture';

describe('mountDashboard', () => {
  it('si registra su window e si smonta pulito', () => {
    expect(window.mountDashboard).toBe(mountDashboard);
    let h!: ReturnType<typeof mountDashboard>;
    act(() => { h = mountDashboard({}, fakeEngine()); });
    act(() => { h.unmount(); });
  });
  it('un pannello che esplode diventa "pannello non disponibile", il resto resta', () => {
    const Boom = () => { throw new Error('rotto'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<><PanelBoundary cls="dp c4" title="OPERATIVI"><Boom /></PanelBoundary><p>vivo</p></>);
    spy.mockRestore();
    expect(screen.getByText('pannello non disponibile')).toBeTruthy();
    expect(screen.getByText('vivo')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/mountDashboard.test.tsx`
Expected: FAIL, `Failed to resolve import "./mountDashboard"`

- [ ] **Step 7: Boundary, SpriteSlot, mountDashboard**

`panels/src/dash/Boundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';

/** Un pannello che lancia non spegne la dashboard né la scena: al suo posto
 *  resta la cornice con "pannello non disponibile". */
export class PanelBoundary extends Component<{ cls: string; title: string; children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <div className={this.props.cls}>
        <h4>{this.props.title} <span className="dtag err">ERRORE</span></h4>
        <div className="empty">pannello non disponibile</div>
      </div>
    );
  }
}
```

`panels/src/dash/SpriteSlot.tsx`:

```tsx
import { useEffect, useRef } from 'react';

/** Mette nel DOM, una volta sola, il canvas sprite già disegnato dal motore
 *  (come facevano buildCrew/buildSkills). Il CSS di .cc/.sk canvas lo impagina. */
export function SpriteSlot({ make }: { make: () => HTMLCanvasElement }) {
  const ref = useRef<HTMLSpanElement>(null);
  const makeRef = useRef(make);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren(makeRef.current());
    return () => host.replaceChildren();
  }, []);
  return <span ref={ref} style={{ display: 'contents' }} />;
}
```

Nota per l'implementatore: lo `<span>` con `display:contents` non conta per l'impaginazione, quindi il canvas si comporta come figlio diretto di `.cc` / `.sk` e i selettori `.cc canvas` / `.sk canvas` funzionano. Il canvas si crea una volta al montaggio (le card hanno come chiave l'id) e si toglie allo smontaggio: React non tocca mai un nodo che non ha creato lui.

`panels/src/dash/mountDashboard.tsx`:

```tsx
import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { ActiveCtx, createStore, EngineCtx, StoreCtx } from './store';
import type { DashSnapshot, Engine, Slots } from './types';
import type { Room } from '../types';

export type DashHandle = {
  publish(s: DashSnapshot): void;
  setActive(active: boolean): void;
  attachStorico(client: SupabaseClient, rooms: Room[]): void;
  unmount(): void;
};

type View = { active: boolean; storico: { client: SupabaseClient; rooms: Room[] } | null };

/** Unico punto d'ingresso dal vanilla per la sala comando. Una radice sola:
 *  ogni gruppo va nel suo slot della griglia #dashv con un portal. */
export function mountDashboard(slots: Slots, engine: Engine): DashHandle {
  const store = createStore();
  let view: View = { active: false, storico: null };
  const viewListeners = new Set<() => void>();
  const setView = (v: View) => { view = v; viewListeners.forEach((l) => l()); };
  const host = document.createElement('div');
  const root = createRoot(host);

  function App() {
    const v = useSyncExternalStore((l) => { viewListeners.add(l); return () => { viewListeners.delete(l); }; }, () => view);
    return (
      <StoreCtx.Provider value={store}>
        <EngineCtx.Provider value={engine}>
          <ActiveCtx.Provider value={v.active}>
            {/* i gruppi si aggiungono qui, uno per task: SESSIONE, LAVORO, MEMORIA, STORICO */}
          </ActiveCtx.Provider>
        </EngineCtx.Provider>
      </StoreCtx.Provider>
    );
  }
  root.render(<App />);
  void createPortal; void slots;   // usati dai task dei gruppi

  return {
    publish: (s) => store.publish(s),
    setActive: (active) => setView({ ...view, active }),
    attachStorico: (client, rooms) => setView({ ...view, storico: { client, rooms } }),
    unmount: () => root.unmount(),
  };
}

declare global {
  interface Window { mountDashboard?: typeof mountDashboard }
}
window.mountDashboard = mountDashboard;
```

In `panels/src/mount.tsx` aggiungi in cima, sotto gli import esistenti:

```ts
import './dash/mountDashboard';   // registra window.mountDashboard nello stesso bundle
```

- [ ] **Step 8: Verifica che passi**

Run: `cd panels && npx vitest run && npx tsc --noEmit`
Expected: tutti i test verdi, tsc pulito

- [ ] **Step 9: Il vanilla pubblica (nessun cambiamento visibile)**

In `baracca.html`, subito sopra `function renderDashLive(t){`:

```js
/* isola React della sala comando (panels/src/dash): montata una volta, al primo
   giro della dashboard. Se il bundle manca o esplode, DASH resta null e il
   vanilla continua da solo. */
var DASH = null, DASH_TRIED = false;
function dashEngine(){
  function sprite(w, h, img){
    var c = cvs(w, h);
    c.getContext("2d").drawImage(img, Math.round((w-img.width)/2), h-img.height);
    return c;
  }
  function crewById(id){ return CREW.filter(function(a){ return a.id === id; })[0]; }
  function skillById(id){ return SKILLS.filter(function(s){ return s.id === id; })[0]; }
  return {
    sprites: {
      bust: function(st, blink, talk){ return bustSprite(st, blink, talk); },
      crew: function(id){ var a = crewById(id); return sprite(24, 30, a.costume ? cameoSprite(a.costume, 0) : crewSprite(a, 0, false)); },
      spec: function(id){ var s = skillById(id), c = cvs(22, 32);
        c.getContext("2d").drawImage(s.costume ? cameoSprite(s.costume, 0) : specSprite(s, 0, false), 0, 0); return c; }
    },
    openPriority: function(t){
      openItemDetail("PRIORITÀ APERTA", "ACTIVE PRIORITIES.MD · SOLA LETTURA",
        "<div style='white-space:pre-wrap;line-height:1.5;color:var(--ink-soft);max-width:480px;'>"+esc(t)+"</div>");
    },
    openMission: function(i){ var m = activeMissions(VAULT)[i]; if(m) showMissionDetail(m); },
    openTask: function(id){ var k = TASKS.filter(function(x){ return x.id === id; })[0]; if(k) showTaskDetail(k); },
    openDelivered: function(nm){
      openItemDetail(esc(nm), "MISSIONE", "<div class='tele'><div class='k'>Stato</div><div class='v'>consegnata</div></div>"+
        (LIVE ? "" : "<div class='dphint'>scena/decorativa — non è un task reale, nessun file o progetto collegato.</div>"));
    }
  };
}
function dashSlots(){
  return {
    sessione: document.getElementById("dashSessione") || undefined,
    lavoro: document.getElementById("dashLavoro") || undefined,
    memoria: document.getElementById("dashMemoria") || undefined,
    storico: document.getElementById("storico") || undefined
  };
}
function dashOnce(){
  if(DASH_TRIED) return;
  DASH_TRIED = true;
  if(!window.mountDashboard) return;
  try{ DASH = window.mountDashboard(dashSlots(), dashEngine()); DASH.setActive(VIEW === "dash"); }
  catch(e){ DASH = null; }
}
/* tutto quello che dashSnapshot legge, preso dalle globali del motore */
function dashState(){
  return {
    now: Date.now(), startTs: startTs, hash: location.hash, live: LIVE, lastSeen: lastSeen,
    state: STATE, statusWord: stateWord(), statusColor: stColor(), taskText: taskText(),
    clock: document.getElementById("coreClock").textContent,
    moving: ULTRON.moving, skfxName: SKFX ? SKFX.sk.n : null,
    events: EVENTS.length, lastTool: LAST_TOOL, lastToolLabel: toolLabel(LAST_TOOL), lastNode: LAST_NODE, lastState: LAST_STATE,
    crew: CREW, tasks: TASKS, skills: SKILLS, rooms: ROOMS, roomTime: ROOMTIME, stages: STAGES,
    deliveredLog: DELIVERED_LOG, delivered: delivered,
    pulse: pulseHist, link: {hit: LINK_HIT, last: LINK_LAST, at: LINK_AT},
    vault: VAULT, vaultDown: VAULT_DOWN, P: P,
    R: R, activeMissions: activeMissions, nextStep: nextStep, missionStepParts: missionStepParts, plainMd: plainMd
  };
}
```

All'inizio di `renderDashLive(t)`, subito dopo `t = t || 0;`:

```js
  dashOnce();
  if(DASH){ try{ DASH.publish(dashSnapshot(dashState())); }catch(e){} }
```

In `showView(v)`, accanto a `if(STORICO) STORICO.setActive(v === "dash");`:

```js
  if(DASH) DASH.setActive(v === "dash");
```

- [ ] **Step 10: Verifica tutto e la pagina vera**

Run: `(cd panels && npx vitest run && npx tsc --noEmit && npm run build) && node test_dash.mjs && node test_aux.mjs && for f in hooks/test_*.py test_server.py; do python3 $f | tail -1; done`
Expected: tutto verde.

Poi nella Baracca vera (Chrome del gruppo di Claude **in primo piano**, `http://127.0.0.1:8795/baracca.html`, tab DASHBOARD): la dashboard è identica a prima; in console nessun errore; `javascript_tool` con `typeof window.mountDashboard` restituisce `"function"`.

- [ ] **Step 11: Commit**

```bash
git add baracca.html panels/src/mount.tsx panels/src/dash panels/dist/panels.js
git commit -m "feat(dashboard): ponte React (store per sezione, boundary, mountDashboard) alimentato dal vanilla"
```

---

### Task 3: Gruppo MEMORIA (`Archivio`, `Diario`, `Vinland`)

**Files:**
- Create: `panels/src/dash/shelf.ts`, `panels/src/dash/shelf.test.ts`, `panels/src/dash/Memoria.tsx`, `panels/src/dash/Memoria.test.tsx`
- Modify: `panels/src/dash/mountDashboard.tsx` (portal MEMORIA), `baracca.html` (HTML del gruppo MEMORIA → slot; CSS `.dslot`; `renderVault` senza scaffale/Vinland/diario; cancella `renderVinland`, `renderCal`, `drawShelf`)

**Interfaces:**
- Consumes: `useSection('shelf' | 'vault')`, `fakeSnap`, slot `memoria`.
- Produces: `shelfLayout(rows: ShelfRow[], width: number): ShelfLine[]`, componente `Memoria`.

- [ ] **Step 1: Test della geometria dello scaffale (fallisce)**

`panels/src/dash/shelf.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shelfLayout } from './shelf';

const row = (count: number) => ({ label: '00 INBOX', count, color: '#c' });

describe('shelfLayout (lo scaffale di ARCHIVIO)', () => {
  it('una fila ogni 25 px, etichetta "NOME conteggio"', () => {
    const l = shelfLayout([row(0), row(3)], 300);
    expect(l.map((x) => x.y)).toEqual([2, 27]);
    expect(l[1].text).toBe('00 INBOX 3');
    expect(l[0].spines).toEqual([]);
  });
  it('dorsi larghi 3-5 px, uno su quattro nel colore della cartella', () => {
    const s = shelfLayout([row(4)], 300)[0].spines;
    expect(s.map((d) => d.w)).toEqual([3, 4, 5, 3]);
    expect(s.map((d) => d.x)).toEqual([4, 10, 17, 25]);
    expect(s[0].color).toBe('#c');
    expect(s[3].color).toBe('#a37b47');     // k%3===0 e non k%4===0
  });
  it('al massimo 22 dorsi e mai sopra l’etichetta (x oltre width-90)', () => {
    expect(shelfLayout([row(500)], 300)[0].spines.length).toBeLessThanOrEqual(22);
    const narrow = shelfLayout([row(500)], 120)[0].spines;
    expect(narrow.length).toBeLessThan(22);
    expect(narrow[narrow.length - 2].x).toBeLessThanOrEqual(120 - 90);
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/shelf.test.ts`
Expected: FAIL, `Failed to resolve import "./shelf"`

- [ ] **Step 3: `shelfLayout`**

`panels/src/dash/shelf.ts`:

```ts
import type { ShelfRow } from './types';

export type Spine = { x: number; w: number; color: string };
export type ShelfLine = { y: number; text: string; color: string; spines: Spine[] };

const RH = 25;

/** Geometria dello scaffale di ARCHIVIO, identica a drawShelf del vanilla:
 *  una fila per cartella, dorsi larghi 3-5 px, al massimo 22, fermi prima
 *  dell'etichetta a destra. */
export function shelfLayout(rows: ShelfRow[], width: number): ShelfLine[] {
  return rows.map((row, i) => {
    const spines: Spine[] = [];
    let x = 4;
    for (let k = 0; k < Math.min(row.count, 22); k++) {
      const w = 3 + (k % 3);
      spines.push({ x, w, color: k % 4 === 0 ? row.color : k % 3 === 0 ? '#a37b47' : '#7a5a33' });
      x += w + 3;
      if (x > width - 90) break;
    }
    return { y: 2 + i * RH, text: `${row.label} ${row.count}`, color: row.color, spines };
  });
}

export function drawShelf(g: CanvasRenderingContext2D, lines: ShelfLine[], width: number, height: number) {
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#3a2a18'; g.fillRect(0, 0, width, height);
  for (const l of lines) {
    g.fillStyle = '#2e2114'; g.fillRect(0, l.y, width, RH - 2);
    g.fillStyle = '#7a5a33'; g.fillRect(0, l.y + RH - 5, width, 3);
    g.fillStyle = '#12100c'; g.fillRect(0, l.y + RH - 2, width, 2);
    for (const s of l.spines) {
      g.fillStyle = '#12100c'; g.fillRect(s.x, l.y + 3, s.w + 2, RH - 8);
      g.fillStyle = s.color; g.fillRect(s.x + 1, l.y + 4, s.w, RH - 10);
    }
    g.font = "8px 'Silkscreen', monospace"; g.textBaseline = 'middle';
    g.fillStyle = '#12100c'; g.fillText(l.text, width - 79, l.y + RH / 2 + 1);
    g.fillStyle = l.color; g.fillText(l.text, width - 80, l.y + RH / 2);
  }
}
```

- [ ] **Step 4: Verifica che passi**

Run: `cd panels && npx vitest run src/dash/shelf.test.ts`
Expected: 3 passed

- [ ] **Step 5: Test dei pannelli MEMORIA (fallisce)**

`panels/src/dash/Memoria.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Memoria } from './Memoria';
import { createStore, StoreCtx } from './store';
import { fakeSnap } from './fixture';
import type { DashSnapshot } from './types';

function show(snap: DashSnapshot | null) {
  const store = createStore();
  if (snap) store.publish(snap);
  return render(<StoreCtx.Provider value={store}><Memoria /></StoreCtx.Provider>).container;
}

describe('MEMORIA', () => {
  it('tre pannelli con le classi e gli id di oggi', () => {
    const c = show(fakeSnap());
    expect(c.querySelector('.dgroup')!.textContent).toBe('MEMORIA');
    expect(c.querySelector('.dp.wood.c4 canvas#dArch')!.getAttribute('width')).toBe('300');
    expect(c.querySelector('.dp.cal.c2')).toBeTruthy();
    expect(c.querySelector('#dVinJobs')).toBeTruthy();
  });
  it('diario e Vinland col vault letto', () => {
    const c = show(fakeSnap());
    expect(c.querySelector('#dDay')!.textContent).toBe('24');
    expect(c.querySelector('#dMon')!.textContent).toBe('SET 2026');
    expect(c.querySelector('#dDailySub')!.textContent).toBe('18 daily notes');
    expect(c.querySelector('#dVinStatus')!.textContent).toBe('planning');
    const job = c.querySelector('#dVinJobs > div')!;
    expect(job.querySelector('span')!.textContent).toBe('ricerca trend ');     // 14 caratteri
    expect((job.querySelector('b') as HTMLElement).style.width).toBe('50%');   // 3/6
    expect(job.querySelector('small')!.textContent).toBe('3 st');
  });
  it('vault non ancora letto o giù: testi di oggi', () => {
    for (const vault of [null, 'down'] as const) {
      const c = show(fakeSnap({ vault }));
      expect(c.querySelector('#dDay')!.textContent).toBe('—');
      expect(c.querySelector('#dMon')!.textContent).toBe('nessuna nota');
      expect(c.querySelector('#dDailySub')!.textContent).toBe('0 daily notes');
      expect(c.querySelector('#dVinStatus')!.textContent).toBe('—');
      expect(c.querySelector('#dVinJobs')!.textContent).toBe('nessun job nel vault');
    }
  });
  it('nessuna istantanea ancora: i pannelli ci sono, vuoti', () => {
    const c = show(null);
    expect(c.querySelector('#dDay')!.textContent).toBe('—');
  });
});
```

- [ ] **Step 6: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/Memoria.test.tsx`
Expected: FAIL, `Failed to resolve import "./Memoria"`

- [ ] **Step 7: `Memoria`**

`panels/src/dash/Memoria.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { PanelBoundary } from './Boundary';
import { drawShelf, shelfLayout } from './shelf';
import { useSection } from './store';

const MESI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const GOLD = '#e08a4a'; // P.gold, colore fisso delle barre di Vinland come nel vanilla

function Archivio() {
  const shelf = useSection('shelf');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext('2d');
    if (!cv || !g || !shelf) return;          // jsdom non ha canvas: niente disegno nei test
    drawShelf(g, shelfLayout(shelf, cv.width), cv.width, cv.height);
  }, [shelf]);
  return (
    <div className="dp wood c4"><h4>ARCHIVIO <span className="dtag real">REALE</span><em>vault</em></h4>
      <canvas id="dArch" ref={ref} width={300} height={150} /></div>
  );
}

function Diario() {
  const v = useSection('vault');
  const d = v && v !== 'down' ? v.daily : null;
  const latest = d?.latest ?? null;
  return (
    <div className="dp cal c2"><h4>DIARIO <span className="dtag real">REALE</span></h4>
      <div className="day" id="dDay">{latest ? latest.slice(8, 10) : '—'}</div>
      <div className="mon" id="dMon">{latest ? `${MESI[+latest.slice(5, 7) - 1]} ${latest.slice(0, 4)}` : 'nessuna nota'}</div>
      <div className="cnt" id="dDailySub">{`${d?.count ?? 0} daily notes`}</div></div>
  );
}

function Vinland() {
  const v = useSection('vault');
  const vin = v && v !== 'down' ? v.vinland : null;
  const jobs = vin?.jobs ?? [];
  return (
    <div className="dp c3"><h4>VINLAND <span className="dtag real">REALE</span><em id="dVinStatus">{vin?.status ?? '—'}</em></h4>
      <div className="bars" id="dVinJobs">
        {!jobs.length
          ? <div style={{ color: 'var(--ink-dim)', fontSize: '12px' }}>nessun job nel vault</div>
          : jobs.slice(0, 5).map((j, i) => (
              <div key={i}><span>{j.name.slice(0, 14)}</span>
                <i><b style={{ width: `${Math.min(100, (j.steps / 6) * 100)}%`, background: GOLD }} /></i>
                <small>{j.steps} st</small></div>
            ))}
      </div></div>
  );
}

export function Memoria() {
  return (
    <>
      <div className="dgroup">MEMORIA</div>
      <PanelBoundary cls="dp wood c4" title="ARCHIVIO"><Archivio /></PanelBoundary>
      <PanelBoundary cls="dp cal c2" title="DIARIO"><Diario /></PanelBoundary>
      <PanelBoundary cls="dp c3" title="VINLAND"><Vinland /></PanelBoundary>
    </>
  );
}
```

In `mountDashboard.tsx`: aggiungi `import { Memoria } from './Memoria';` e sostituisci il commento dei gruppi con:

```tsx
            {slots.memoria && createPortal(<Memoria />, slots.memoria)}
```

(e togli `void createPortal; void slots;`).

- [ ] **Step 8: Verifica che passi**

Run: `cd panels && npx vitest run && npx tsc --noEmit`
Expected: tutto verde

- [ ] **Step 9: Il vanilla cede MEMORIA**

Prima: `git status --short baracca.html` vuoto; messaggio all'altra sessione (vedi Global Constraints).

In `baracca.html`:
1. CSS, accanto a `#storico{display:contents;}`: `.dslot{display:contents;}`
2. Sostituisci il blocco da `<div class="dgroup">MEMORIA</div>` fino alla riga del pannello VINLAND inclusa con:
   ```html
   <div class="dslot" id="dashMemoria"></div>
   ```
3. In `renderVault(v)`: togli `drawShelf(null); renderVinland(null); renderCal(null);` nel ramo `!v` e `drawShelf(v); renderVinland(v.vinland); renderCal(v.daily);` alla fine.
4. Cancella le funzioni `renderVinland`, `renderCal`, `drawShelf` (commento "lo scaffale" compreso).
5. `grep -n "drawShelf\|renderVinland\|renderCal\|dArch\|dVinJobs\|dDay" baracca.html` → nessun risultato.

- [ ] **Step 10: Verifica tutto e a schermo**

Run: `(cd panels && npx vitest run && npx tsc --noEmit && npm run build) && node test_dash.mjs && node test_aux.mjs && for f in hooks/test_*.py test_server.py; do python3 $f | tail -1; done`
Expected: tutto verde.

A schermo (Chrome in primo piano, DASHBOARD): screenshot a 1400 e a 700 px del gruppo MEMORIA, prima (dal commit precedente, `git stash` non serve: fai lo screenshot "prima" all'inizio del task) e dopo. Scaffale, diario e Vinland identici; in DEMO (senza login) idem.

- [ ] **Step 11: Commit**

```bash
git add baracca.html panels/src/dash panels/dist/panels.js
git commit -m "feat(dashboard): gruppo MEMORIA in React (archivio, diario, Vinland)"
```

---

### Task 4: LAVORO, parte 1 (`PrioritaAperte`, `BachecaMissioni`, `TempoPerReparto`)

**Files:**
- Create: `panels/src/dash/fmt.ts`, `panels/src/dash/Lavoro.tsx`, `panels/src/dash/Lavoro.test.tsx`
- Modify: nessun file del vanilla in questo task (il gruppo LAVORO passa a React tutto insieme nel Task 5)

**Interfaces:**
- Consumes: `useSection('vault' | 'board' | 'roomTime' | 'header' | 'palette')`, `useEngine().openPriority/openMission/openTask/openDelivered`, `fakeSnap`, `fakeEngine` (da `fixture.ts`).
- Produces: `mmss(ms: number): string`; componenti `PrioritaAperte`, `BachecaMissioni`, `TempoPerReparto`, `DTag` (etichetta REALE/SCENA).

- [ ] **Step 1: Test (fallisce)**

`panels/src/dash/Lavoro.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BachecaMissioni, PrioritaAperte, TempoPerReparto } from './Lavoro';
import { mmss } from './fmt';
import { createStore, EngineCtx, StoreCtx } from './store';
import { fakeEngine, fakeSnap } from './fixture';
import type { DashSnapshot, Engine } from './types';
import type { ReactNode } from 'react';

function show(ui: ReactNode, snap: DashSnapshot | null, engine: Engine = fakeEngine()) {
  const store = createStore();
  if (snap) store.publish(snap);
  return render(<StoreCtx.Provider value={store}><EngineCtx.Provider value={engine}>{ui}</EngineCtx.Provider></StoreCtx.Provider>).container;
}

describe('mmss', () => {
  it('minuti:secondi', () => { expect(mmss(65000)).toBe('1:05'); expect(mmss(0)).toBe('0:00'); });
});

describe('PRIORITÀ APERTE', () => {
  it('fino a 9 voci, "+N altre", totali, clic apre la scheda', () => {
    const e = fakeEngine();
    const open = Array.from({ length: 11 }, (_, i) => `p${i}`);
    const c = show(<PrioritaAperte />, fakeSnap({ vault: { ...(fakeSnap().vault as object), priorities: { open, completed: 4 } } as DashSnapshot['vault'] }), e);
    const li = c.querySelectorAll('#dPrio li');
    expect(li).toHaveLength(10);
    expect(li[9].textContent).toBe('+2 altre — vedi Active Priorities.md');
    expect(li[0].getAttribute('title')).toBe('p0');
    expect(c.querySelector('#dPrioSub')!.textContent).toBe('11 APERTE · 4 COMPLETATE');
    fireEvent.click(li[1]);
    expect(e.openPriority).toHaveBeenCalledWith('p1');
  });
  it('in attesa, vault giù, nessuna aperta', () => {
    expect(show(<PrioritaAperte />, fakeSnap({ vault: null })).querySelector('#dPrio')!.textContent).toBe('in attesa del vault…');
    expect(show(<PrioritaAperte />, fakeSnap({ vault: 'down' })).querySelector('#dPrio')!.textContent).toBe('vault non raggiungibile · avvia start.sh');
    const none = fakeSnap({ vault: { ...(fakeSnap().vault as object), priorities: { open: [], completed: 0 } } as DashSnapshot['vault'] });
    expect(show(<PrioritaAperte />, none).querySelector('#dPrio')!.textContent).toBe('nessuna priorità aperta');
  });
});

describe('BACHECA MISSIONI', () => {
  it('LIVE: missioni vere con avanzamento, clic apre la missione', () => {
    const e = fakeEngine();
    const c = show(<BachecaMissioni />, fakeSnap(), e);
    const p = c.querySelector('.paper.real')!;
    expect(p.textContent).toContain('1/2 · prossimo: Passo 2');
    expect((p.querySelector('.bar i') as HTMLElement).style.width).toBe('50%');
    expect(c.querySelector('#dBoardSub')!.textContent).toBe('1 ATTIVE');
    expect((c.querySelector('#dStamp') as HTMLElement).style.display).toBe('none');
    fireEvent.click(p);
    expect(e.openMission).toHaveBeenCalledWith(0);
  });
  it('DEMO: missioni di scena (qa in rosso), consegnate, timbro, al massimo 6 fogli', () => {
    const e = fakeEngine();
    const scene = Array.from({ length: 7 }, (_, i) => ({ id: i, text: `t${i}`, p: 0.3, stage: 'OFFICINA', qa: i === 0 }));
    const c = show(<BachecaMissioni />, fakeSnap({ board: { real: [], scene, delivered: ['fatto1'], deliveredCount: 3, live: false, sub: '7 IN CORSO · 3 CONSEGNATE' } }), e);
    expect(c.querySelectorAll('.paper')).toHaveLength(6);
    expect(c.querySelector('.paper.qa .stg')!.getAttribute('style')).toContain('#d9483a');
    expect((c.querySelector('#dStamp') as HTMLElement).style.display).toBe('block');
    expect(c.querySelector('#dStamp')!.textContent).toBe('3 CONSEGNATE');
    fireEvent.click(c.querySelectorAll('.paper')[2]);
    expect(e.openTask).toHaveBeenCalledWith(2);
  });
  it('bacheca vuota, ma le consegnate si vedono lo stesso (come oggi)', () => {
    const e = fakeEngine();
    const c = show(<BachecaMissioni />, fakeSnap({ board: { real: [], scene: [], delivered: ['x'], deliveredCount: 1, live: false, sub: '0 IN CORSO · 1 CONSEGNATE' } }), e);
    expect(c.querySelector('.papers .none')!.textContent).toBe('bacheca vuota');
    fireEvent.click(c.querySelector('.paper.done')!);
    expect(e.openDelivered).toHaveBeenCalledWith('x');
  });
});

describe('TEMPO PER REPARTO', () => {
  it('barre in percentuale sul totale, già ordinate, etichetta SCENA/REALE', () => {
    const c = show(<TempoPerReparto />, fakeSnap());
    const rows = c.querySelectorAll('#dTime > div');
    expect(rows[0].querySelector('span')!.textContent).toBe('OFFICINA');
    expect((rows[0].querySelector('b') as HTMLElement).style.width).toBe('100%');
    expect(rows[0].querySelector('small')!.textContent).toBe('1:05');
    expect(c.querySelector('#tagTime')!.textContent).toBe('REALE');
    const demo = show(<TempoPerReparto />, fakeSnap({ header: { ...fakeSnap().header, live: false } }));
    expect(demo.querySelector('#tagTime')!.textContent).toBe('SCENA');
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/Lavoro.test.tsx`
Expected: FAIL, `Failed to resolve import "./Lavoro"`

- [ ] **Step 3: `fmt.ts` e i tre pannelli**

`panels/src/dash/fmt.ts`:

```ts
export function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
```

`panels/src/dash/Lavoro.tsx`:

```tsx
import { mmss } from './fmt';
import { useEngine, useSection } from './store';

/** REALE quando la sessione è LIVE, SCENA quando è il simulatore interno. */
export function DTag({ id }: { id: string }) {
  const h = useSection('header');
  const live = !!h?.live;
  return <span className={`dtag ${live ? 'real' : 'demo'}`} id={id}>{live ? 'REALE' : 'SCENA'}</span>;
}

export function PrioritaAperte() {
  const v = useSection('vault');
  const { openPriority } = useEngine();
  const SHOWN = 9;
  let items;
  let sub = '';
  if (v === null) items = <li className="empty">in attesa del vault…</li>;
  else if (v === 'down') items = <li className="empty">vault non raggiungibile · avvia start.sh</li>;
  else {
    const open = v.priorities.open;
    sub = `${open.length} APERTE · ${v.priorities.completed} COMPLETATE`;
    items = !open.length ? <li className="empty">nessuna priorità aperta</li> : (
      <>
        {open.slice(0, SHOWN).map((t, i) => (
          <li key={i} title={t} style={{ cursor: 'pointer' }} onClick={() => openPriority(t)}>{t}</li>
        ))}
        {open.length > SHOWN && <li className="empty">{`+${open.length - SHOWN} altre — vedi Active Priorities.md`}</li>}
      </>
    );
  }
  return (
    <div className="dp clip c3"><h4>PRIORITÀ APERTE <span className="dtag real">REALE</span></h4>
      <ul id="dPrio">{items}</ul><div className="tot" id="dPrioSub">{sub}</div></div>
  );
}

export function BachecaMissioni() {
  const b = useSection('board');
  const pal = useSection('palette');
  const { openMission, openTask, openDelivered } = useEngine();
  const real = b?.real ?? [], scene = b?.scene ?? [];
  const cap = Math.max(0, 6 - real.length);
  const red = pal?.red ?? '#d9483a';
  const delivered = (b?.delivered ?? []).slice(0, Math.max(0, cap - scene.length));
  return (
    <div className="dp cork c5"><h4>BACHECA MISSIONI <DTag id="tagBoard" /><em id="dBoardSub">{b?.sub ?? ''}</em></h4>
      <div className="papers" id="dBoard">
        {!scene.length && !real.length && <div className="none">bacheca vuota</div>}
        {real.map((m) => (
          <div key={`r${m.index}`} className="paper real" onClick={() => openMission(m.index)}>
            {m.title}
            <div className="bar"><i style={{ width: `${Math.round((m.done / m.total) * 100)}%` }} /></div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>{`${m.done}/${m.total}${m.nextTag !== null ? ` · prossimo: ${m.nextTag}` : ''}`}</div>
            <span className="stg">REALE</span>
          </div>
        ))}
        {scene.slice(0, cap).map((k) => (
          <div key={`s${k.id}`} className={`paper${k.qa ? ' qa' : ''}`} style={{ cursor: 'pointer' }} onClick={() => openTask(k.id)}>
            {k.text}
            <div className="bar"><i style={{ width: `${Math.round(k.p * 100)}%` }} /></div>
            <span className="stg" style={{ color: k.qa ? red : '#4a3720', borderColor: k.qa ? red : '#4a3720' }}>{k.stage}</span>
          </div>
        ))}
        {delivered.map((nm, i) => (
          <div key={`d${i}`} className="paper done" style={{ cursor: 'pointer' }} onClick={() => openDelivered(nm)}>
            {nm}<span className="stg">FATTO</span>
          </div>
        ))}
      </div>
      <div className="stamp" id="dStamp" style={{ display: b && b.deliveredCount && !b.live ? 'block' : 'none' }}>
        {`${b?.deliveredCount ?? 0} CONSEGNATE`}</div></div>
  );
}

export function TempoPerReparto() {
  const rows = useSection('roomTime') ?? [];
  const tot = rows.reduce((a, r) => a + r.ms, 0);
  return (
    <div className="dp c3"><h4>TEMPO PER REPARTO <DTag id="tagTime" /><em>questa sessione</em></h4>
      <div className="bars" id="dTime">
        {rows.map((r) => (
          <div key={r.id}><span style={{ color: r.color }}>{r.name}</span>
            <i><b style={{ width: `${(tot ? (r.ms / tot) * 100 : 0).toFixed(1)}%`, background: r.color }} /></i>
            <small>{mmss(r.ms)}</small></div>
        ))}
      </div></div>
  );
}
```

Nota: nel test la larghezza attesa è `'100%'` ma il componente scrive `'100.0%'`; jsdom normalizza `style.width` a `100%`. Se in questo ambiente non normalizza, correggi l'attesa del test a `'100.0%'`, non il componente (deve restare identico al vanilla, che usa `toFixed(1)`).

- [ ] **Step 4: Verifica che passi**

Run: `cd panels && npx vitest run && npx tsc --noEmit`
Expected: tutto verde

- [ ] **Step 5: Commit** (il vanilla non cambia ancora: LAVORO passa tutto insieme nel Task 5)

```bash
git add panels/src/dash
git commit -m "feat(dashboard): pannelli priorità, bacheca e tempo per reparto in React (non ancora montati)"
```

---

### Task 5: LAVORO, parte 2 (`Operativi`, `Specialisti`) e passaggio del gruppo

**Files:**
- Modify: `panels/src/dash/Lavoro.tsx` (aggiungi `Operativi`, `Specialisti`, `Lavoro`), `panels/src/dash/Lavoro.test.tsx`, `panels/src/dash/mountDashboard.tsx` (portal LAVORO), `baracca.html`

**Interfaces:**
- Consumes: `useSection('crew' | 'skills' | 'palette')`, `useEngine().sprites.crew/spec`, `SpriteSlot`, `DTag`.
- Produces: componenti `Operativi`, `Specialisti`, gruppo `Lavoro`.

- [ ] **Step 1: Test (fallisce)**

In `Lavoro.test.tsx` aggiungi (e aggiungi `Operativi, Specialisti, Lavoro` all'import da `./Lavoro`):

```tsx
describe('OPERATIVI', () => {
  it('card con sprite del motore, reparto, occupato, barra token', () => {
    const c = show(<Operativi />, fakeSnap());
    const cards = c.querySelectorAll('#dCrew .cc');
    expect(cards).toHaveLength(2);
    expect((cards[0].querySelector('canvas') as HTMLCanvasElement).dataset.sprite).toBe('ricerca-1');
    expect(cards[0].querySelector('.r')!.textContent).toBe('RICERCA');
    expect(cards[1].className).toBe('cc busy');
    const tok = cards[0].querySelector('.tok')!;
    expect(tok.className).toBe('tok');
    expect((tok.children[3] as HTMLElement).style.width).toBe('40%');       // 4 su 10
    expect(tok.getAttribute('title')).toBe('in 1 · out 2 · cache-r 3 · cache-w 4');
    expect(cards[1].querySelector('.tok')!.className).toBe('tok empty');
    expect(c.querySelector('#dCrewN')!.textContent).toBe('1 IN MOVIMENTO / 2');
  });
});

describe('SPECIALISTI', () => {
  it('card con sprite, usi, dove, evidenza se appena usato', () => {
    const c = show(<Specialisti />, fakeSnap());
    const sk = c.querySelector('#dSkills .sk')!;
    expect(sk.className).toBe('sk eq');
    expect((sk.querySelector('canvas') as HTMLCanvasElement).dataset.sprite).toBe('taste');
    expect(sk.querySelector('.n i')!.textContent).toBe('2 USI');
    expect(sk.querySelector('.p')!.textContent).toBe('al posto');
  });
});

describe('gruppo LAVORO', () => {
  it('cinque pannelli nell’ordine di oggi', () => {
    const c = show(<Lavoro />, fakeSnap());
    expect(c.querySelector('.dgroup')!.textContent).toBe('LAVORO');
    expect([...c.querySelectorAll('.dp h4')].map((h) => h.childNodes[0].textContent!.trim()))
      .toEqual(['OPERATIVI', 'BACHECA MISSIONI', 'PRIORITÀ APERTE', 'SPECIALISTI', 'TEMPO PER REPARTO']);
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/Lavoro.test.tsx`
Expected: FAIL, `Operativi` / `Specialisti` / `Lavoro` non esportati

- [ ] **Step 3: I due pannelli e il gruppo**

In `Lavoro.tsx` aggiungi gli import `import { PanelBoundary } from './Boundary';` e `import { SpriteSlot } from './SpriteSlot';`, poi:

```tsx
export function Operativi() {
  const crew = useSection('crew') ?? [];
  const pal = useSection('palette');
  const { sprites } = useEngine();
  const colors = pal ? [pal.gold, pal.cyan, pal.violet, pal.green] : ['', '', '', ''];
  const busy = crew.filter((a) => a.busy).length;
  return (
    <div className="dp c4"><h4>OPERATIVI <DTag id="tagCrew" /><em id="dCrewN">{`${busy} IN MOVIMENTO / ${crew.length}`}</em></h4>
      <div className="crewrow" id="dCrew">
        {crew.map((a) => {
          const segs = a.tokens ?? [0, 0, 0, 0];
          const tot = segs[0] + segs[1] + segs[2] + segs[3];
          return (
            <div key={a.id} className={`cc${a.busy ? ' busy' : ''}`} data-id={a.id}>
              <SpriteSlot make={() => sprites.crew(a.id)} />
              <div className="n" style={{ color: a.color }}>{a.name}</div>
              <div className="r">{a.role}</div>
              <div className={`tok${tot === 0 ? ' empty' : ''}`}
                   title={tot ? `in ${segs[0]} · out ${segs[1]} · cache-r ${segs[2]} · cache-w ${segs[3]}` : ''}>
                {segs.map((v, k) => <i key={k} style={{ background: colors[k], width: `${tot ? (v / tot) * 100 : 0}%` }} />)}
              </div>
            </div>
          );
        })}
      </div></div>
  );
}

export function Specialisti() {
  const skills = useSection('skills') ?? [];
  const { sprites } = useEngine();
  return (
    <div className="dp c4"><h4>SPECIALISTI <DTag id="tagSkills" /><em>le skill in dotazione</em></h4>
      <div className="arsenal" id="dSkills">
        {skills.map((sk) => (
          <div key={sk.id} className={`sk${sk.hot ? ' eq' : ''}`} data-id={sk.id}>
            <SpriteSlot make={() => sprites.spec(sk.id)} />
            <div>
              <div className="n" style={{ color: sk.color }}><span>{sk.name}</span><i>{`${sk.uses} USI`}</i></div>
              <div className="d">{sk.desc}</div>
              <div className="p">{sk.where}</div>
            </div>
          </div>
        ))}
      </div></div>
  );
}

export function Lavoro() {
  return (
    <>
      <div className="dgroup">LAVORO</div>
      <PanelBoundary cls="dp c4" title="OPERATIVI"><Operativi /></PanelBoundary>
      <PanelBoundary cls="dp cork c5" title="BACHECA MISSIONI"><BachecaMissioni /></PanelBoundary>
      <PanelBoundary cls="dp clip c3" title="PRIORITÀ APERTE"><PrioritaAperte /></PanelBoundary>
      <PanelBoundary cls="dp c4" title="SPECIALISTI"><Specialisti /></PanelBoundary>
      <PanelBoundary cls="dp c3" title="TEMPO PER REPARTO"><TempoPerReparto /></PanelBoundary>
    </>
  );
}
```

In `mountDashboard.tsx`: `import { Lavoro } from './Lavoro';` e, **prima** della riga di MEMORIA:

```tsx
            {slots.lavoro && createPortal(<Lavoro />, slots.lavoro)}
```

- [ ] **Step 4: Verifica che passi**

Run: `cd panels && npx vitest run && npx tsc --noEmit`
Expected: tutto verde

- [ ] **Step 5: Il vanilla cede LAVORO**

Prima: `git status --short baracca.html` vuoto; messaggio all'altra sessione.

In `baracca.html`:
1. Sostituisci il blocco da `<div class="dgroup">LAVORO</div>` fino al pannello TEMPO PER REPARTO incluso con `<div class="dslot" id="dashLavoro"></div>`.
2. In `renderVault(v)` togli tutta la parte priorità (`var prio = …`, il ramo `!v` che scrive `dPrio`/`dPrioSub`, il ciclo `open.slice(0,shown)…`, `+N altre`, `dPrioSub`). Il ramo `!v` tiene solo la riga `dIdent` (la toglie il Task 6).
3. In `renderDashLive(t)` cancella i blocchi `/* operativi */`, `/* bacheca */`, `/* arsenale */`, `/* tempo per reparto */`, e nell'elenco degli id delle etichette `["tagSig","tagLink","tagCrew","tagBoard","tagSkills","tagTime"]` togli `"tagCrew","tagBoard","tagSkills","tagTime"`.
4. Cancella `buildCrew` e `buildSkills` e la loro chiamata in `showView` (`buildCrew(); buildSkills();`).
5. `grep -n "dCrew\|dBoard\|dSkills\|dTime\|dPrio\|buildCrew\|buildSkills" baracca.html` → nessun risultato.

- [ ] **Step 6: Verifica tutto e a schermo**

Run: la suite completa (vedi Task 3, Step 10).

A schermo, DASHBOARD in LIVE e in DEMO, 1400 e 700 px: le cinque card come prima; sprite degli operativi e degli specialisti presenti; clic su una priorità, una missione vera, una missione di scena (DEMO) e una consegnata (DEMO) aprono la stessa scheda di prima; un operativo che porta una cassa ha il bordo oro.

- [ ] **Step 7: Commit**

```bash
git add baracca.html panels/src/dash panels/dist/panels.js
git commit -m "feat(dashboard): gruppo LAVORO in React (operativi, bacheca, priorità, specialisti, tempo)"
```

---

### Task 6: Gruppo SESSIONE (`Testata`, `Segnale`, `PonteHook`)

**Files:**
- Create: `panels/src/dash/pulse.ts`, `panels/src/dash/pulse.test.ts`, `panels/src/dash/Sessione.tsx`, `panels/src/dash/Sessione.test.tsx`
- Modify: `panels/src/dash/mountDashboard.tsx` (portal SESSIONE), `baracca.html`

**Interfaces:**
- Consumes: `useSection('header' | 'signal' | 'link' | 'debugRaw')`, `useEngine().sprites.bust`, `useActive()`, `DTag`.
- Produces: `pulseBars(pulse: number[], W: number, H: number): PulseBar[]`, `portraitFrame(t: number, rawStatus: string, moving: boolean): { blink: boolean; talk: boolean; dy: number }`, gruppo `Sessione`.

- [ ] **Step 1: Test delle funzioni pure (fallisce)**

`panels/src/dash/pulse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { portraitFrame, pulseBars } from './pulse';

describe('pulseBars (SEGNALE)', () => {
  it('una barra per valore, altezza pari, minimo 2 px, ultima evidenziata', () => {
    const b = pulseBars([0, 0.5, 1], 210, 60);
    expect(b.map((x) => x.h)).toEqual([2, 28, 54]);
    expect(b.map((x) => x.x)).toEqual([0, 70, 140]);
    expect(b[0].w).toBe(69);
    expect(b.map((x) => x.last)).toEqual([false, false, true]);
    expect(b[2].y).toBe(60 - 54 - 2);
  });
});

describe('portraitFrame (ritratto)', () => {
  it('battito di ciglia negli ultimi 120 ms di ogni 3 s', () => {
    expect(portraitFrame(2900, 'writing', false).blink).toBe(true);
    expect(portraitFrame(1000, 'writing', false).blink).toBe(false);
  });
  it('parla solo delegando o fallendo, a scatti di 125 ms', () => {
    expect(portraitFrame(0, 'delegating', false).talk).toBe(true);
    expect(portraitFrame(130, 'delegating', false).talk).toBe(false);
    expect(portraitFrame(0, 'writing', false).talk).toBe(false);
  });
  it('sobbalza di 1 px solo in cammino', () => {
    expect(portraitFrame(130, 'writing', true).dy).toBe(1);
    expect(portraitFrame(130, 'writing', false).dy).toBe(0);
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/pulse.test.ts`
Expected: FAIL, `Failed to resolve import "./pulse"`

- [ ] **Step 3: `pulse.ts`**

```ts
export type PulseBar = { x: number; y: number; w: number; h: number; last: boolean };

/** Barre del SEGNALE, identiche a drawPulse del vanilla. */
export function pulseBars(pulse: number[], W: number, H: number): PulseBar[] {
  const n = pulse.length;
  return pulse.map((v, i) => {
    const h = Math.max(2, Math.round((v * (H - 6)) / 2) * 2);
    return { x: Math.round(i * (W / n)), y: H - h - 2, w: Math.max(2, Math.floor(W / n) - 1), h, last: i === n - 1 };
  });
}

export function drawPulse(g: CanvasRenderingContext2D, bars: PulseBar[], W: number, H: number, color: string) {
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0c120e'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(123,189,90,.12)';
  for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);
  for (const b of bars) { g.fillStyle = b.last ? '#fff' : color; g.fillRect(b.x, b.y, b.w, b.h); }
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, H - 2, W, 2);
}

/** Stato del ritratto al tempo t (ms), come in renderDashLive. */
export function portraitFrame(t: number, rawStatus: string, moving: boolean) {
  const blink = t % 3000 > 2880;
  const talk = rawStatus === 'delegating' || rawStatus === 'failing' ? Math.floor(t * 0.008) % 2 === 0 : false;
  return { blink, talk, dy: moving ? Math.floor(t * 0.008) % 2 : 0 };
}
```

- [ ] **Step 4: Verifica che passi**

Run: `cd panels && npx vitest run src/dash/pulse.test.ts`
Expected: 4 passed

- [ ] **Step 5: Test dei pannelli SESSIONE (fallisce)**

`panels/src/dash/Sessione.test.tsx`:

```tsx
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessione } from './Sessione';
import { ActiveCtx, createStore, EngineCtx, StoreCtx } from './store';
import { fakeEngine, fakeSnap } from './fixture';
import type { DashSnapshot } from './types';

function show(snap: DashSnapshot, active = true) {
  const store = createStore();
  store.publish(snap);
  const ui = (a: boolean) => (
    <StoreCtx.Provider value={store}><EngineCtx.Provider value={fakeEngine()}>
      <ActiveCtx.Provider value={a}><Sessione /></ActiveCtx.Provider></EngineCtx.Provider></StoreCtx.Provider>);
  const r = render(ui(active));
  return { c: r.container, setActive: (a: boolean) => r.rerender(ui(a)) };
}

describe('SESSIONE', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('testata: stato col suo colore, dove + grassetto, identità, orologio, LIVE', () => {
    const { c } = show(fakeSnap());
    expect(c.querySelector('.dgroup')!.textContent).toBe('SESSIONE');
    const st = c.querySelector('#dStatus') as HTMLElement;
    expect(st.textContent).toBe('scrive');
    expect(st.style.color).toBe('rgb(224, 138, 74)');
    expect(c.querySelector('#dWhere')!.innerHTML).toBe('in OFFICINA · <b>x.md</b>');
    expect(c.querySelector('#dIdent')!.textContent).toBe('Ultron · chief of staff');
    expect(c.querySelector('#dClock')!.textContent).toBe('01:02');
    expect(c.querySelector('#dLast')!.textContent).toBe('3s');
    expect(c.querySelector('#dMode')!.className).toBe('pill live');
    expect(c.querySelector('canvas#dPort')!.getAttribute('width')).toBe('40');
  });
  it('DEMO: "demo" e pillola DEMO', () => {
    const { c } = show(fakeSnap({ header: { ...fakeSnap().header, live: false, lastSeenS: null } }));
    expect(c.querySelector('#dLast')!.textContent).toBe('demo');
    expect(c.querySelector('#dMode')!.textContent).toBe('DEMO');
  });
  it('segnale: contatori', () => {
    const { c } = show(fakeSnap());
    expect(c.querySelector('#dEv')!.textContent).toBe('6');
    expect(c.querySelector('#dEvm')!.textContent).toBe('3.0');
    expect(c.querySelector('#dTool')!.textContent).toBe('modifica');
    expect(c.querySelector('#dTool')!.getAttribute('title')).toBe('Edit');
    expect(c.querySelector('#dNode')!.textContent).toBe('x.md');
  });
  it('ponte: stazioni toccate e calda, segnale sulla stazione, JSON solo con #debug', () => {
    const { c } = show(fakeSnap());
    const stn = c.querySelectorAll('#dLink .stn');
    expect([...stn].map((s) => s.className)).toEqual(['stn on', 'stn on hot', 'stn', 'stn']);
    expect((c.querySelector('#dSig') as HTMLElement).style.left).toBe('37.5%');
    expect(c.querySelector('#dSig')!.className).toBe('sig go');
    expect((c.querySelector('#dRaw') as HTMLElement).style.display).toBe('none');
    const dbg = show(fakeSnap({ debugRaw: { label: 'state.json', json: '{"a":1}' } })).c;
    expect((dbg.querySelector('#dRaw') as HTMLElement).style.display).toBe('');
    expect(dbg.querySelector('#dRaw')!.innerHTML).toBe('<b>state.json ·</b> {"a":1}');
  });
  it('il ritratto anima solo a dashboard aperta', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const caf = vi.spyOn(window, 'cancelAnimationFrame');
    const { setActive } = show(fakeSnap(), true);
    expect(raf).toHaveBeenCalled();
    act(() => setActive(false));
    expect(caf).toHaveBeenCalled();
    raf.mockClear();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(raf).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/Sessione.test.tsx`
Expected: FAIL, `Failed to resolve import "./Sessione"`

- [ ] **Step 7: `Sessione.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { PanelBoundary } from './Boundary';
import { DTag } from './Lavoro';
import { drawPulse, portraitFrame, pulseBars } from './pulse';
import { useActive, useEngine, useSection } from './store';
import type { DashHeader, LinkKey } from './types';

function Ritratto({ header }: { header: DashHeader | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(header);
  latest.current = header;
  const active = useActive();
  const { sprites } = useEngine();
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const frame = (t: number) => {
      const cv = ref.current, g = cv?.getContext('2d'), h = latest.current;
      if (cv && g && h) {
        g.imageSmoothingEnabled = false;
        g.fillStyle = '#1b1610'; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = h.color; g.globalAlpha = 0.16;
        for (let i = 0; i < cv.height; i += 4) g.fillRect(0, i, cv.width, 2);
        g.globalAlpha = 1;
        const f = portraitFrame(t, h.rawStatus, h.moving);
        g.drawImage(sprites.bust(h.rawStatus, f.blink, f.talk), 0, f.dy);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [active, sprites]);
  return <canvas id="dPort" ref={ref} width={40} height={28} />;
}

function Testata() {
  const h = useSection('header');
  return (
    <div className="dp hdr c12">
      <Ritratto header={h} />
      <div>
        <div className="st" id="dStatus" style={{ color: h?.color }}>{h?.status ?? 'idle'}</div>
        <div className="wh" id="dWhere">{h ? h.where : 'nessun reparto'}{h?.whereBold ? <> · <b>{h.whereBold}</b></> : null}</div>
        <div className="id" id="dIdent">{h?.identity ?? 'Ultron'}</div>
      </div>
      <div className="meta">SESSIONE <b id="dClock">{h?.clock ?? '00:00'}</b><br />ULTIMO SEGNALE <b id="dLast">{h ? (h.live ? `${h.lastSeenS}s` : 'demo') : '—'}</b><br />
        <span className={`pill ${h?.live ? 'live' : 'demo'}`} id="dMode">{h?.live ? 'LIVE' : 'DEMO'}</span></div>
    </div>
  );
}

function Segnale() {
  const s = useSection('signal');
  const h = useSection('header');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext('2d');
    if (!cv || !g || !s) return;
    drawPulse(g, pulseBars(s.pulse, cv.width, cv.height), cv.width, cv.height, h?.color ?? '#fff');
  }, [s, h?.color]);
  return (
    <div className="dp scr c4"><h4>SEGNALE <DTag id="tagSig" /><em>claude code</em></h4>
      <canvas id="dPulse" ref={ref} width={210} height={60} />
      <div className="stats">
        <div>eventi<b id="dEv">{s?.events ?? 0}</b></div>
        <div>al minuto<b id="dEvm">{s?.perMin ?? '—'}</b></div>
        <div>ultimo tool<b id="dTool" title={s?.lastTool}>{s?.lastToolLabel ?? '—'}</b></div>
        <div>nodo<b id="dNode">{s?.node ?? '—'}</b></div>
      </div>
      <div className="dphint">eventi = tool ricevuti dagli hook · nodo = file toccato nel vault</div></div>
  );
}

const STATIONS: { k: LinkKey; hook: string; text: string }[] = [
  { k: 'prompt', hook: 'UserPromptSubmit', text: 'thinking' },
  { k: 'tool', hook: 'PostToolUse', text: 'barracks.py' },
  { k: 'sub', hook: 'SubagentStop', text: 'reparto rientrato' },
  { k: 'stop', hook: 'Stop', text: 'idle' },
];

function PonteHook() {
  const l = useSection('link');
  const raw = useSection('debugRaw');
  const idx = Math.max(0, STATIONS.findIndex((s) => s.k === l?.last));
  return (
    <div className="dp c8"><h4>PONTE CON CLAUDE CODE <DTag id="tagLink" /><em id="dLinkSub">hook · state.json · poll 400 ms</em></h4>
      <div className="link" id="dLink">
        {STATIONS.map((s) => (
          <div key={s.k} className={`stn${l?.hit[s.k] ? ' on' : ''}${l?.last === s.k && l.hot ? ' hot' : ''}`} data-k={s.k}>
            <i /><b>{s.hook}</b>{s.text}</div>
        ))}
        <div className={`sig${l?.hot ? ' go' : ''}`} id="dSig" style={{ left: `${12.5 + idx * 25}%` }} />
      </div>
      <div className="raw" id="dRaw" style={{ display: raw ? '' : 'none' }}>
        {raw && <><b>{`${raw.label} ·`}</b> {raw.json}</>}</div></div>
  );
}

export function Sessione() {
  return (
    <>
      <div className="dgroup">SESSIONE</div>
      <PanelBoundary cls="dp hdr c12" title="SESSIONE"><Testata /></PanelBoundary>
      <PanelBoundary cls="dp scr c4" title="SEGNALE"><Segnale /></PanelBoundary>
      <PanelBoundary cls="dp c8" title="PONTE CON CLAUDE CODE"><PonteHook /></PanelBoundary>
    </>
  );
}
```

In `mountDashboard.tsx`: `import { Sessione } from './Sessione';` e, **prima** della riga di LAVORO:

```tsx
            {slots.sessione && createPortal(<Sessione />, slots.sessione)}
```

Nota sul test "ponte": il vanilla metteva il segnale sull'ultima stazione anche se non era calda; `idx` fa lo stesso (0 se nessuna).

- [ ] **Step 8: Verifica che passi**

Run: `cd panels && npx vitest run && npx tsc --noEmit`
Expected: tutto verde

- [ ] **Step 9: Il vanilla cede SESSIONE**

Prima: `git status --short baracca.html` vuoto; messaggio all'altra sessione.

In `baracca.html`:
1. Sostituisci il blocco da `<div class="dgroup">SESSIONE</div>` fino al pannello PONTE CON CLAUDE CODE incluso con `<div class="dslot" id="dashSessione"></div>`.
2. `renderDashLive(t)` diventa solo:
   ```js
   function renderDashLive(t){
     dashOnce();
     if(DASH){ try{ DASH.publish(dashSnapshot(dashState())); }catch(e){} }
   }
   ```
3. Cancella `drawPulse` (quello della dashboard, riga ~3001: **non** il mini-segnale della vista BASE che usa `spx`) e `renderLink`. `markLink` resta (lo usano gli hook per aggiornare `LINK_*`).
4. In `renderVault(v)` togli le righe su `dIdent`: la funzione resta `renderMissions(v); if(v) vigOnVault(v);`.
5. `grep -n "dStatus\|dWhere\|dIdent\|dPort\|dPulse\|dLink\|dSig\|dRaw\|renderLink\|getElementById(\"dEv\|tagSig" baracca.html` → nessun risultato.

- [ ] **Step 10: Verifica tutto e a schermo**

Suite completa (Task 3, Step 10). A schermo: testata con ritratto che sbatte le palpebre, orologio che scorre, segnale che si muove a ogni tool, stazioni del ponte che si accendono; in DEMO la pillola DEMO; con `#debug` nell'URL la riga del JSON; cambiando vista in BASE e tornando in DASHBOARD il ritratto riparte. Screenshot a 1400 e 700 px, LIVE e DEMO.

- [ ] **Step 11: Commit**

```bash
git add baracca.html panels/src/dash panels/dist/panels.js
git commit -m "feat(dashboard): gruppo SESSIONE in React (testata, segnale, ponte con gli hook)"
```

---

### Task 7: STORICO dentro la dashboard, pulizia finale e verifica

**Files:**
- Modify: `panels/src/dash/mountDashboard.tsx`, `panels/src/mount.tsx`, `panels/src/mount.test.tsx`, `panels/src/dash/mountDashboard.test.tsx`, `baracca.html`, `farm/README.md` (se descrive `mountStorico`)

**Interfaces:**
- Consumes: `Storico` (esistente, `panels/src/Storico.tsx`), `attachStorico(client, rooms)`.
- Produces: bundle che espone solo `window.mountDashboard`.

- [ ] **Step 1: Test (fallisce)**

In `mountDashboard.test.tsx` aggiungi:

```tsx
  it('attachStorico monta lo STORICO nel suo slot, attivo solo con la dashboard aperta', async () => {
    const storico = document.createElement('div');
    const from = vi.fn(() => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'order']) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    });
    const ch = { on: () => ch, subscribe: () => ch };
    const client = { from, channel: () => ch, removeChannel: () => Promise.resolve('ok') } as unknown as import('@supabase/supabase-js').SupabaseClient;
    let h!: ReturnType<typeof mountDashboard>;
    await act(async () => { h = mountDashboard({ storico }, fakeEngine()); });
    await act(async () => { h.attachStorico(client, [{ id: 'prod', n: 'OFFICINA', col: '#2aa883' }]); });
    expect(storico.querySelector('.dgroup')!.textContent).toBe('STORICO');
    expect(from).not.toHaveBeenCalled();
    await act(async () => { h.setActive(true); });
    expect(from.mock.calls.map((c) => c[0]).sort()).toEqual(['sessions', 'subagents', 'token_usage']);
    await act(async () => { h.unmount(); });
  });
```

- [ ] **Step 2: Verifica che fallisca**

Run: `cd panels && npx vitest run src/dash/mountDashboard.test.tsx`
Expected: FAIL, `.dgroup` non trovato nello slot storico

- [ ] **Step 3: STORICO nella radice unica**

In `mountDashboard.tsx`: `import { Storico } from '../Storico';` e, dopo la riga di MEMORIA:

```tsx
            {slots.storico && v.storico && createPortal(
              <Storico client={v.storico.client} rooms={v.storico.rooms} active={v.active} />, slots.storico)}
```

In `panels/src/mount.tsx` togli `mountStorico` (funzione, tipo `StoricoHandle`, `declare global` e `window.mountStorico = …`): il file resta l'entry del bundle con il solo `import './dash/mountDashboard';`. In `panels/src/mount.test.tsx` togli i test di `mountStorico` (sono coperti dal nuovo test di `attachStorico`); se il file resta vuoto, cancellalo.

- [ ] **Step 4: Verifica che passi**

Run: `cd panels && npx vitest run && npx tsc --noEmit`
Expected: tutto verde

- [ ] **Step 5: Il vanilla usa solo `DASH`**

Prima: `git status --short baracca.html` vuoto; messaggio all'altra sessione.

In `baracca.html`:
1. `mountStoricoOnce()` diventa:
   ```js
   function mountStoricoOnce(){
     dashOnce();
     if(STORICO || !supaClient || !DASH) return;
     try{
       DASH.attachStorico(supaClient, ROOMS.map(function(r){ return {id:r.id, n:r.n, col:r.c}; }));
       STORICO = true;
     }catch(e){ STORICO = null; }
   }
   ```
2. In `showView`: togli `if(STORICO) STORICO.setActive(v === "dash");` (lo fa già `DASH.setActive`).
3. Aggiorna il commento sopra `var STORICO = null;`: "STORICO è montato dentro l'isola della sala comando (DASH.attachStorico)".
4. `grep -n "mountStorico\b\|window.mountStorico\|STORICO.setActive" baracca.html` → nessun risultato. `grep -n "renderDashLive\|dashSnapshot" baracca.html` → solo le righe del ponte e il giro a 110 ms.

- [ ] **Step 6: Suite completa, build, verifica a schermo finale**

Run: `(cd panels && npx vitest run && npx tsc --noEmit && npm run build) && node test_dash.mjs && node test_aux.mjs && for f in hooks/test_*.py test_server.py; do python3 $f | tail -1; done`
Expected: tutto verde.

A schermo, Baracca vera, LIVE e DEMO, 1400 e 700 px: tutti gli 11 pannelli più lo STORICO identici agli screenshot presi all'inizio del Task 3; lo STORICO continua a rileggere in tempo reale (vedi verifica della miglioria 7); ogni clic apre la sua scheda; nessun errore in console.

- [ ] **Step 7: `/impeccable audit` sulla dashboard**

Esegui la skill `impeccable` in modalità audit sulla vista DASHBOARD. Criterio: **zero regressioni** rispetto a prima del porting. Le segnalazioni già presenti prima (salvate all'inizio del Task 3 con lo stesso audit) non contano; qualunque segnalazione nuova si corregge in questo task.

- [ ] **Step 8: Commit**

```bash
git add baracca.html panels farm/README.md
git commit -m "feat(dashboard): STORICO dentro la radice unica, fine del porting della sala comando"
```

(`farm/README.md` solo se modificato.)

---

## Self-review (fatta)

- **Copertura della spec:** ponte e istantanea (Task 1-2), componenti per gruppo (3, 4-5, 6), canvas (3 scaffale, 6 segnale e ritratto), ordine MEMORIA → LAVORO → SESSIONE (3 → 5 → 6), cancellazione del vanilla (3, 5, 6, 7), STORICO inglobato (7), casi limite (Review Focus + test), test e verifica (ogni task), coordinamento (Global Constraints + passo "Prima:" nei task su `baracca.html`), fuori scopo (Global Constraints).
- **Tipi coerenti:** `DashSnapshot` e le sezioni sono definiti nel Task 1 e usati con gli stessi nomi nei Task 2-7; `Engine` ha `openPriority/openMission/openTask/openDelivered` ovunque; `Slots` ha `sessione/lavoro/memoria/storico`.
- **Placeholder:** nessuno.
