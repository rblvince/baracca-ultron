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
    pulse: [0, 0.5, 1], link: { hit: { tool: true }, last: 'tool', at: 119000, seen: { tool: 60000 } },
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
  // otto stazioni, una per hook; "visto" in secondi dall'ultimo evento vero, null = mai visto
  assert.deepEqual(s.link, {
    hit: { session: false, prompt: false, pre: false, tool: true, notify: false, sub: false, compact: false, stop: false },
    last: 'tool', hot: true,
    seen: { session: null, prompt: null, pre: null, tool: 60, notify: null, sub: null, compact: null, stop: null } });
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
