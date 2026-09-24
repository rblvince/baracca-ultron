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
