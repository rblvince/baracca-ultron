// Check dei posti fissi della squadra (blocco SPEC-PURE di baracca.html, pianta DEMO):
// ogni specialista sta nella sottostanza dove il ponte manda la sua skill, fino a dieci
// senza coprirsi, e nessun operativo ha la postazione nelle loro sottostanze.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
const sp = html.match(/\/\* SPEC-PURE-START \*\/([\s\S]*?)\/\* SPEC-PURE-END \*\//);
assert.ok(sp, 'blocco SPEC-PURE non trovato in baracca.html');
const { specCell, specSlots } = new Function(sp[1] + '; return { specCell, specSlots };')();
const dm = html.match(/<script>\s*(\/\*[\s\S]*?\*\/\s*var DEMO = \{[\s\S]*?)<\/script>/);
assert.ok(dm, 'blocco DEMO non trovato in baracca.html');
const DEMO = new Function(dm[1] + '; return DEMO;')();
const cell = (rid, id) => {
  const c = DEMO.cells[rid].cells.find((q) => q[0] === id);
  return { x: c[2], y: c[3], w: c[4], h: c[5] };
};

// la stanza è quella del ponte: revisione e verifica in collaudo, il resto fra gli attrezzi
assert.equal(specCell(['code-review']), 'qa:review');
assert.equal(specCell(['superpowers:verification-before-completion']), 'qa:review');
assert.equal(specCell(['Security-Review']), 'qa:review');
assert.equal(specCell(['taste']), 'rs:skill');
assert.equal(specCell(['resolve', 'davinci']), 'rs:skill');
assert.equal(specCell([]), 'rs:skill');

// una persona (2,2 x tela 28x43) è larga ~62 e alta ~95: fra due posti serve almeno una delle due distanze
const W = 62, H = 95;
for (const [rid, id] of [['rs', 'skill'], ['qa', 'review']]) {
  const c = cell(rid, id);
  for (let n = 1; n <= 10; n++) {
    const at = specSlots(c, n);
    assert.equal(at.length, n);
    for (const p of at) {
      assert.ok(p.x - W / 2 >= c.x && p.x + W / 2 <= c.x + c.w, `${id} n=${n}: posto (${p.x},${p.y}) esce di lato`);
      assert.ok(p.y - H >= c.y && p.y <= c.y + c.h, `${id} n=${n}: posto (${p.x},${p.y}) esce in alto o in basso`);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = at[i], b = at[j];
      assert.ok(Math.abs(a.x - b.x) >= W || Math.abs(a.y - b.y) >= H, `${id} n=${n}: ${i} e ${j} si accavallano`);
    }
  }
}

// nessun operativo nelle sottostanze degli specialisti
const st = html.match(/var STATION = (\{[\s\S]*?\});/);
assert.ok(st, 'STATION non trovata in baracca.html');
const STATION = new Function('return ' + st[1])();
for (const [who, s] of Object.entries(STATION)) {
  assert.ok(!(s[0] === 'rs' && s[1] === 'skill') && !(s[0] === 'qa' && s[1] === 'review'), `${who} sta nella stanza degli specialisti`);
}

console.log('test_squadra: tutti i controlli passati');
