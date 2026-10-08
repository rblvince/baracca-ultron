// Check di tre funzioni di baracca.html che toccano gli specialisti e i tre personaggi (CODER,
// VALUTATORE, JEV GIURIA): useSkill/banner (il nome di una skill arriva da fuori e non deve mai
// diventare HTML), acceptLiveRow (entrando in LIVE il turno finto della demo finisce) e
// renderSubagents (al cambio di fonte lo stesso sub-agente arriva con un id nuovo).
// La pagina non ha un build: le funzioni si estraggono per nome e girano con la scena finta.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('./baracca.html', import.meta.url), 'utf8');
// il sorgente di una funzione a livello zero: su una riga sola, oppure fino alla prima "}" a inizio riga
const fn = (name) => {
  const m = html.match(new RegExp('^function ' + name + '\\((?:[^\\n]*\\}|[^\\n]*\\{\\n[\\s\\S]*?^\\})$', 'm'));
  assert.ok(m, 'funzione ' + name + ' non trovata in baracca.html');
  return m[0];
};
const aux = html.match(/\/\* AUX-PURE-START \*\/([\s\S]*?)\/\* AUX-PURE-END \*\//);
assert.ok(aux, 'blocco AUX-PURE non trovato in baracca.html');

const rotti = [];
const check = (nome, f) => { try { f(); } catch (e) { rotti.push(nome + ': ' + e.message); } };

// G1: il nome di una skill (frontmatter di SKILL.md, o chiave di state/skills_used.json) e la
// sottostanza finiscono in innerHTML: la fascia e il rapporto non devono guadagnare nemmeno un tag
check('G1 nome della skill in innerHTML', () => {
  const useSkill = (n, cellName) => new Function('n', 'cellName', `
    var el = {innerHTML: "", className: "", offsetWidth: 0}, logged = [], bnEl = null, reduce = false, P = {};
    var document = {getElementById: function(){ return el; }};
    function skillBy(){ return {n: n, c: "#fff", cellName: cellName, uses: 0}; }
    function handoff(){}
    function logEvent(kind, html){ logged.push(html); }
    ${fn('esc')}
    ${fn('banner')}
    ${fn('useSkill')}
    useSkill("sk:x", null, true);
    return {banner: el.innerHTML, log: logged[0]};
  `)(n, cellName);
  const tags = (s) => (s.match(/</g) || []).length;
  const buono = useSkill('TASTE', 'ATTREZZI');
  const cattivo = useSkill('<IFRAME SRCDOC="<script>alert(1)</script>">', '<img src=x onerror="alert(2)">');
  assert.equal(tags(cattivo.banner), tags(buono.banner), 'fascia: ' + cattivo.banner);
  assert.equal(tags(cattivo.log), tags(buono.log), 'rapporto: ' + cattivo.log);
  // il nome si legge ancora, come testo: le virgolette restano virgolette perché non c'è più un tag che le contenga
  assert.ok(cattivo.banner.includes('&lt;IFRAME SRCDOC="&lt;script&gt;'), cattivo.banner);
  assert.ok(cattivo.log.includes('&lt;IFRAME SRCDOC="&lt;script&gt;'), cattivo.log);
  assert.ok(cattivo.log.includes('&lt;img src=x onerror="alert(2)"&gt;'), cattivo.log);
});

// V1: la prima riga di agent_state (Supabase/Realtime) accende il LIVE e chiude il turno finto:
// via i mini-Ultron della demo, a casa i personaggi della demo; chi fa un sub-agente vero resta
check('V1 ingresso in LIVE da Supabase', () => {
  const out = new Function(`
    var LIVE = false, REST = true, DEMO_TURN = [{}], lastTs = 0, lastSeen = 0, LAST_STATE = null, homed = [];
    var MINIS = [{id: "demo1", demo: true}, {id: 7}];
    var AGENTS = [{id: "coder", sub: "demo1", demo: true}, {id: "valutatore", sub: 4, demo: false}, {id: "jev-giuria", sub: null, demo: false}];
    var localStorage = {setItem: function(){}}, document = {getElementById: function(){ return {}; }};
    function renderTasks(){}
    function enqueueEvent(){}
    function agentHome(a){ homed.push(a.id); }
    ${fn('acceptLiveRow')}
    acceptLiveRow({ts: 1});
    return {live: LIVE, turn: DEMO_TURN, minis: MINIS.map(function(m){ return m.id; }), homed: homed};
  `)();
  assert.equal(out.live, true);
  assert.deepEqual(out.homed, ['coder']);
  assert.deepEqual(out.minis, [7]);
  assert.equal(out.turn, null);
});

// V2: gli id locali e quelli di Supabase non coincidono. Al cambio di fonte lo stesso sub-agente
// torna con un id nuovo: il personaggio resta suo, senza rapporto anticipato e senza mini-Ultron
check('V2 stesso sub-agente con un id nuovo', () => {
  const scene = () => {
    const agents = ['coder', 'valutatore', 'jev-giuria'].map((id) => ({ id, sub: null, demo: false, done: false, task: '' }));
    const render = new Function('AGENTS', `
      var MINIS = [], calls = [];
      ${aux[1]}
      ${fn('agentBy')}
      function callAgent(a, id, task, demo){ calls.push("call:" + a.id + ":" + id); a.sub = id; a.demo = !!demo; }
      function launchMini(id){ calls.push("mini:" + id); var m = {id: id}; MINIS.push(m); return m; }
      function sendBack(m){ calls.push("back:" + m.id); }
      function agentReport(a){ calls.push("report:" + a.id); a.done = true; }   /* come se fosse ancora in cammino */
      ${fn('renderSubagents')}
      return function(list){ calls.length = 0; renderSubagents({list: list}); return calls.slice(); };
    `)(agents);
    return { coder: agents[0], render };
  };
  const sub = (id, task) => ({ id, room: 'prod', agent: 'coder', task });
  {
    const { coder, render } = scene();
    assert.deepEqual(render([sub(5, 'scrive')]), ['call:coder:5']);
    assert.deepEqual(render([sub(9001, 'scrive ancora')]), []);      // stesso lavoro, id di Supabase
    assert.equal(coder.sub, 9001);
    assert.equal(coder.task, 'scrive ancora');
    assert.deepEqual(render([sub(9001)]), []);
    assert.deepEqual(render([]), ['report:coder']);                  // finisce davvero: il rapporto parte come sempre
    assert.deepEqual(render([sub(9002)]), ['mini:9002', 'report:coder']);   // gli è già stato detto di consegnare: questo è un altro
    assert.equal(coder.sub, 9001);
  }
  {
    const { coder, render } = scene();                               // idem se sta già portando il rapporto
    render([sub(5)]);
    coder.state = 'report';
    assert.deepEqual(render([sub(6)]), ['mini:6', 'report:coder']);
    assert.equal(coder.sub, 5);
  }
  {
    const { coder, render } = scene();                               // il secondo dello stesso tipo, col primo in corso
    render([sub(5)]);
    assert.deepEqual(render([sub(5), sub(6)]), ['mini:6']);
    assert.equal(coder.sub, 5);
    assert.deepEqual(render([sub(5), sub(6)]), []);
  }
  {
    const { coder, render } = scene();                               // i personaggi della demo non si toccano
    coder.sub = 'demo1'; coder.demo = true;
    assert.deepEqual(render([sub(9001)]), ['mini:9001']);
    assert.equal(coder.sub, 'demo1');
    assert.equal(coder.demo, true);
  }
});

if (rotti.length) { console.error(rotti.join('\n')); process.exit(1); }
console.log('test_agenti: tutti i controlli passati');
