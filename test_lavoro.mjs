// Check del blocco WORK-PURE di baracca.html: quale animazione per sottostanza,
// il comando ridotto a lunghezze, il riconoscimento del prompt, i token per evento.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
const m = html.match(/\/\* WORK-PURE-START \*\/([\s\S]*?)\/\* WORK-PURE-END \*\//);
assert.ok(m, 'blocco WORK-PURE non trovato in baracca.html');
const { workKind, workWords, isPromptEvent, outDelta, tokDelta, coinCount, qSpeed, qDwell, linkKeyFor, projectName } =
  new Function(m[1] + '; return { workKind, workWords, isPromptEvent, outDelta, tokDelta, coinCount, qSpeed, qDwell, linkKeyFor, projectName };')();

// ogni sottostanza con una voce ha la sua animazione; NUCLEO, ATTREZZI e CABINA no
assert.equal(workKind('prod', 'bash'), 'type');
assert.equal(workKind('prod', 'edit'), 'weld');
assert.equal(workKind('qa', 'diff'), 'lamp');
assert.equal(workKind('pub', 'dock'), 'ship');
assert.equal(workKind('vault', 'core'), null);
assert.equal(workKind('rs', 'booth'), null);
// tutte le sottostanze nominate esistono davvero nella pianta
const ids = [...html.matchAll(/\["(\w+)",\s*"[^"]+",\s*\d+,/g)].map((x) => x[1]);
const kinds = m[1].match(/"(\w+):(\w+)"/g).map((k) => k.slice(1, -1).split(':')[1]);
kinds.forEach((k) => assert.ok(ids.includes(k), `sottostanza ${k} assente in DEMO.cells`));

// il comando diventa solo lunghezze (max 12 parole, max 12 per parola): mai il testo
assert.deepEqual(workWords('git push origin main'), [3, 4, 6, 4]);
assert.deepEqual(workWords('  a   bb '), [1, 2]);
assert.deepEqual(workWords(null), []);
assert.equal(workWords('x'.repeat(40))[0], 12);
assert.equal(workWords(Array(20).fill('a').join(' ')).length, 12);

// il prompt: solo status thinking senza tool, reparto o riga (set_state.py a UserPromptSubmit)
assert.equal(isPromptEvent({ status: 'thinking', ts: 1 }), true);
assert.equal(isPromptEvent({ status: 'thinking', room: 'prod', line: 'reparto rientrato' }), false);
assert.equal(isPromptEvent({ status: 'thinking', room: 'qa', tool: 'Bash' }), false);
assert.equal(isPromptEvent({ status: 'idle' }), false);
assert.equal(isPromptEvent(null), false);

// token d'uscita di un evento: niente al primo stato letto (è il totale storico)
assert.equal(outDelta(null, { prod: { out: 9e6 } }, 'prod'), null);
assert.equal(outDelta({ prod: { out: 100 } }, { prod: { out: 350 } }, 'prod'), 250);
assert.equal(outDelta({}, { qa: { out: 40 } }, 'qa'), 40);
assert.equal(outDelta({ prod: { out: 100 } }, { prod: { out: 100 } }, 'prod'), null);
assert.equal(outDelta({ prod: { out: 1 } }, { prod: { out: 2 } }, null), null);

// cache scritta: stesso conto sulla colonna cwrite (l'ECONOMO si muove sopra soglia)
assert.equal(tokDelta({ rs: { cwrite: 1000 } }, { rs: { cwrite: 49000 } }, 'rs', 'cwrite'), 48000);
assert.equal(tokDelta(null, { rs: { cwrite: 49000 } }, 'rs', 'cwrite'), null);
// dopo una compattazione il turno continua: niente prompt
assert.equal(isPromptEvent({ status: 'thinking', line: 'contesto compattato' }), false);

// monete: 0 senza token, poi log2 da 500, al massimo 12
assert.equal(coinCount(0), 0);
assert.equal(coinCount(10), 1);
assert.equal(coinCount(1500), 2);
assert.equal(coinCount(1e9), 12);
// il riassunto sotto il nome di uno specialista: prima frase, ~48 caratteri, taglio su una parola
const shortDesc = new Function(html.match(/function shortDesc[\s\S]*?\n}/)[0] + '; return shortDesc;')();
assert.equal(shortDesc('Review AI agent skills before installation using NVIDIA SkillSpector and source-aware semantic review. Use when'),
  'Review AI agent skills before installation…');
assert.equal(shortDesc('Audit UI.'), 'Audit UI');
assert.equal(shortDesc(''), 'skill');
// la coda: senza fila passo normale e sosta piena; con la fila più svelto, mai oltre 3x e mai sotto 250 ms
assert.equal(qSpeed(0), 1);
assert.ok(qSpeed(2) > qSpeed(1));
assert.equal(qSpeed(50), 3);
assert.equal(qDwell(0), 900);
assert.ok(qDwell(3) < qDwell(1));
assert.equal(qDwell(100), 250);
assert.equal(qSpeed(-1), 1);
// il ponte: ogni stato dice quale hook l'ha scritto
assert.equal(linkKeyFor({ status: 'thinking' }), 'prompt');
assert.equal(linkKeyFor({ status: 'writing', room: 'prod', tool: 'Edit' }), 'tool');
assert.equal(linkKeyFor({ status: 'failing', room: 'prod', tool: 'Bash' }), 'tool');
assert.equal(linkKeyFor({ status: 'spawning', room: 'ricerca', agent: 'ricerca-1' }), 'pre');
assert.equal(linkKeyFor({ status: 'thinking', room: 'prod', line: 'reparto rientrato' }), 'sub');
assert.equal(linkKeyFor({ status: 'waiting', line: 'permesso · Bash' }), 'notify');
assert.equal(linkKeyFor({ status: 'compacting', line: 'compatta · auto' }), 'compact');
assert.equal(linkKeyFor({ status: 'thinking', line: 'contesto compattato' }), 'session');
assert.equal(linkKeyFor({ status: 'idle', line: 'sessione aperta · startup' }), 'session');
assert.equal(linkKeyFor({ status: 'idle' }), 'stop');
assert.equal(linkKeyFor(null), null);

// il progetto di un terminale dal percorso del transcript
assert.equal(projectName('/Users/vince/.claude/projects/-Users-vince-my-agent/a.jsonl'), 'my-agent');
assert.equal(projectName('/home/u/.claude/projects/-home-u-baracca-ultron/b.jsonl'), 'baracca-ultron');
assert.equal(projectName('/Users/vince/.claude/projects/-Users-vince/c.jsonl'), 'home');
assert.equal(projectName(''), '');
// un nome utente col punto: il prefisso vero arriva dal server
const H = '-Users-rbl-vincent';
assert.equal(projectName('/Users/rbl.vincent/.claude/projects/-Users-rbl-vincent-my-agent/a.jsonl', H), 'my-agent');
assert.equal(projectName('/Users/rbl.vincent/.claude/projects/-Users-rbl-vincent/a.jsonl', H), 'home');
assert.equal(projectName('/Users/rbl.vincent/.claude/projects/-Users-rbl-vincent-Desktop-ultrarantino/a.jsonl', H), 'Desktop-ultrarantino');
console.log('ok');
