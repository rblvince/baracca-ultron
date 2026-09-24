// Check dei convertitori righe Supabase -> forme di /api/sessions e /api/subagents,
// e delle etichette leggibili (blocco LABEL-PURE: nomi dei tool, Markdown delle priorità).
// Estrae il blocco AUX-PURE da baracca.html: la pagina non ha un build.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
const m = html.match(/\/\* AUX-PURE-START \*\/([\s\S]*?)\/\* AUX-PURE-END \*\//);
assert.ok(m, 'blocco AUX-PURE non trovato in baracca.html');
const { sessionsFromRows, subagentsFromRows, auxSourceOk, makeSeq } =
  new Function(m[1] + '; return { sessionsFromRows, subagentsFromRows, auxSourceOk: typeof auxSourceOk === "function" ? auxSourceOk : undefined, makeSeq: typeof makeSeq === "function" ? makeSeq : undefined };')();

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

// una sola fonte disegna la scena: con USE_SUPABASE solo Supabase, senza solo i file
// locali (gli id dei sub-agenti non coincidono: due fonti insieme = mini-Ultron che
// spariscono e rinascono a ogni evento, es. dopo il watchdog dei 15 minuti)
assert.equal(typeof auxSourceOk, 'function', 'auxSourceOk mancante nel blocco AUX-PURE');
assert.equal(auxSourceOk(true, true), true);    // risposta Supabase, Supabase attivo
assert.equal(auxSourceOk(true, false), false);  // risposta Supabase dopo il ritorno al locale
assert.equal(auxSourceOk(false, false), true);  // poll locale, Supabase spento
assert.equal(auxSourceOk(false, true), false);  // poll locale arrivato dopo il SUBSCRIBED

// riletture sovrapposte: disegna solo l'ultima partita, una risposta vecchia
// arrivata dopo non riporta in scena un mini-Ultron già rientrato
assert.equal(typeof makeSeq, 'function', 'makeSeq mancante nel blocco AUX-PURE');
const seq = makeSeq();
const primo = seq.next(), secondo = seq.next();
assert.equal(seq.isLatest(primo), false);
assert.equal(seq.isLatest(secondo), true);

// il watchdog dei 15 minuti torna alla demo ma NON spegne Supabase: con il
// canale Realtime sano la prossima riga di agent_state riaccende il LIVE da sola,
// mentre spegnerlo rimandava la pagina ai file locali fino al ricaricamento
const wd = html.match(/function checkStaleWatchdog\(\)\{([\s\S]*?)\n\}/);
assert.ok(wd, 'checkStaleWatchdog non trovato');
assert.ok(!/USE_SUPABASE\s*=\s*false/.test(wd[1]), 'il watchdog non deve spegnere USE_SUPABASE');

// etichette: niente nomi tecnici grezzi, niente Markdown nelle priorità
const lb = html.match(/\/\* LABEL-PURE-START \*\/([\s\S]*?)\/\* LABEL-PURE-END \*\//);
assert.ok(lb, 'blocco LABEL-PURE non trovato in baracca.html');
const { toolLabel, plainMd } = new Function(lb[1] + '; return { toolLabel, plainMd };')();
assert.equal(toolLabel('Bash'), 'Terminale');
assert.equal(toolLabel('mcp__plugin_playwright_playwright__browser_press_key'), 'Playwright · browser press key');
assert.equal(toolLabel('mcp__plugin_figma_figma__use_figma'), 'Figma · use figma');
assert.equal(toolLabel('mcp__claude_ai_Claude_Docs__batch'), 'Claude Docs · batch');
assert.equal(toolLabel('mcp__gmail__search_emails'), 'Gmail · search emails');
assert.equal(toolLabel('Sconosciuto'), 'Sconosciuto');
assert.equal(toolLabel('—'), '—');
assert.equal(plainMd('**Carriera:** vedi [[Master AI Web Development - Boolean]] e `farm/`'),
  'Carriera: vedi Master AI Web Development - Boolean e farm/');
assert.equal(plainMd('[[La Baracca di Ultron - Design|la Baracca]] ~~P1~~ FATTO'), 'la Baracca P1 FATTO');

console.log('test_aux: tutti i controlli passati');
