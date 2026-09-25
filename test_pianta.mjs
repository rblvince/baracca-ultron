// Check della pianta (DEMO in baracca.html): sottostanze dentro il loro reparto e senza
// sovrapporsi, nessuna troppo stretta, porte sul bordo del reparto, archivio dentro l'anello
// e lontano dal corridoio. Dopo ogni ritocco alle misure.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
// tutto il primo script: la pianta di progetto e scalePianta, cioè la pianta che si vede davvero
const m = html.match(/<script>\s*(\/\*[\s\S]*?\*\/\s*var DEMO = \{[\s\S]*?)<\/script>/);
assert.ok(m, 'blocco DEMO non trovato in baracca.html');
const DEMO = new Function(m[1] + '; return DEMO;')();
assert.ok(DEMO.S >= 1.5, 'la pianta deve essere almeno 1,5 volte quella di progetto');
const rooms = DEMO.rooms({});
const S = DEMO.S, OFF = DEMO.HALL_OFF, MIN = Math.round(175 * S), HALF = DEMO.CORR.h / 2, CLEAR = 40;

const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const r of rooms) {
  const cells = DEMO.cells[r.id].cells.map((c) => ({ id: c[0], x: c[2], y: c[3], w: c[4], h: c[5] }));
  for (const c of cells) {
    assert.ok(inside(c, r), `${r.id}/${c.id} esce dal reparto`);
    assert.ok(Math.min(c.w, c.h) >= MIN, `${r.id}/${c.id} troppo stretta: ${c.w}x${c.h}`);
  }
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++)
    assert.ok(!overlap(cells[i], cells[j]), `${r.id}: ${cells[i].id} e ${cells[j].id} si sovrappongono`);
  for (const [x, y] of DEMO.graph.doors[r.id]) {
    const onEdge = ((x === r.x || x === r.x + r.w) && y >= r.y && y <= r.y + r.h) ||
                   ((y === r.y || y === r.y + r.h) && x >= r.x && x <= r.x + r.w);
    assert.ok(onEdge, `${r.id}: porta (${x},${y}) non sta sul bordo`);
  }
  const hy = DEMO.cells[r.id].hall;
  assert.ok(hy > r.y && hy < r.y + r.h, `${r.id}: l'atrio sta fuori dal reparto`);
  // le porte delle sottostanze danno sull'atrio: 50 px fuori dalla porta c'è la riga dell'atrio (o una
  // colonna di raccordo, hub). Una porta fuori riga resta staccata e i percorsi non la trovano più.
  const hubX = (DEMO.cells[r.id].hub || []).map((h) => h[0]);
  for (const c of DEMO.cells[r.id].cells) {
    const [id, , x, y, w, h, side] = c;
    if (side === 't') assert.equal(y - OFF, hy, `${r.id}/${id}: porta in alto fuori dalla riga dell'atrio`);
    if (side === 'b') assert.equal(y + h + OFF, hy, `${r.id}/${id}: porta in basso fuori dalla riga dell'atrio`);
    if (side === 'l') assert.ok(hubX.includes(x - OFF), `${r.id}/${id}: porta a sinistra fuori colonna`);
    if (side === 'r') assert.ok(hubX.includes(x + w + OFF), `${r.id}/${id}: porta a destra fuori colonna`);
  }
}
for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++)
  assert.ok(!overlap(rooms[i], rooms[j]), `${rooms[i].id} e ${rooms[j].id} si sovrappongono`);

// l'archivio sta dentro l'anello, almeno CLEAR px dal bordo interno del corridoio
const g = DEMO.graph.ring, v = rooms.find((r) => r.id === 'vault');
assert.ok(v.x >= g.x + HALF + CLEAR && v.x + v.w <= g.x + g.w - HALF - CLEAR, 'archivio troppo vicino al corridoio (lati)');
assert.ok(v.y >= g.y + HALF + CLEAR && v.y + v.h <= g.y + g.h - HALF - CLEAR, 'archivio troppo vicino al corridoio (sopra/sotto)');
// ogni porta dell'archivio arriva al suo nodo in linea retta, orizzontale o verticale
// le porte dei reparti danno sull'atrio come quelle delle sottostanze: la riga dell'atrio a OFF dalla porta
for (const r of rooms) for (const [x, y, node] of DEMO.graph.doors[r.id]) {
  const [nx, ny] = DEMO.graph.nodes[node], L = Math.hypot(x - nx, y - ny);
  const hx = Math.round(x + (x - nx) / L * OFF), hyy = Math.round(y + (y - ny) / L * OFF);
  const hall = DEMO.cells[r.id].hall, hubs = (DEMO.cells[r.id].hub || []).map((h) => h[0]);
  assert.ok(hyy === hall || hubs.includes(hx), `${r.id}: la porta verso ${node} non arriva all'atrio (${hx},${hyy})`);
}
// il corridoio dritto in alto (CORR) sta sulla linea dell'anello
assert.equal(DEMO.CORR.y + DEMO.CORR.h / 2, DEMO.graph.ring.y, 'CORR fuori dalla linea dell\'anello');
for (const [x, y, node] of DEMO.graph.doors.vault) {
  const [nx, ny] = DEMO.graph.nodes[node];
  assert.ok(nx === x || ny === y, `porta verso ${node} storta`);
}
console.log('test_pianta: tutti i controlli passati');
