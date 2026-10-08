import { useState } from 'react';
import { PanelBoundary } from './Boundary';
import { SpriteSlot } from './SpriteSlot';
import { useEngine, useSection } from './store';
import type { LinkKey } from './types';

type Kind = 'truppa' | 'specialisti' | 'sub-agenti';
type Who = { id: string; name: string; color: string; desc: string; state: string; busy: boolean; kind: Kind; uses?: number };
type Filtro = 'tutti' | 'lavoro' | Kind;

/** SQUADRA: truppa, specialisti e i tre sub-agenti con un nome in una lista sola, chi lavora in cima.
 *  Un clic la mostra nella base. */
export function Squadra() {
  const crew = useSection('crew') ?? [];
  const skills = useSection('skills') ?? [];
  const agents = useSection('agents') ?? [];
  const { sprites, goActor } = useEngine();
  const [f, setF] = useState<Filtro>('tutti');
  const all: Who[] = [
    ...agents.map((a) => ({ id: a.id, name: a.name, color: a.color, desc: a.desc, state: a.state, busy: a.busy, kind: 'sub-agenti' as const })),
    ...crew.map((a) => ({ id: a.id, name: a.name, color: a.color, desc: a.desc, state: a.state, busy: a.busy, kind: 'truppa' as const })),
    ...skills.map((s) => ({ id: s.id, name: s.name, color: s.color, desc: s.desc, state: s.where, busy: s.busy, kind: 'specialisti' as const, uses: s.uses })),
  ];
  const busy = all.filter((w) => w.busy).length;
  const list = all
    .filter((w) => f === 'tutti' || (f === 'lavoro' ? w.busy : w.kind === f))
    .sort((a, b) => Number(b.busy) - Number(a.busy));
  const chips: [Filtro, string][] = [['tutti', `tutti ${all.length}`], ['lavoro', `al lavoro ${busy}`],
    ['truppa', `truppa ${crew.length}`], ['specialisti', `specialisti ${skills.length}`]];
  if (agents.length) chips.push(['sub-agenti', `sub-agenti ${agents.length}`]);
  return (
    <div className="dp c8">
      <h4>SQUADRA <em>clic su una persona: la vedi nella base</em></h4>
      <div className="chips" role="group" aria-label="Filtra la squadra">
        {chips.map(([k, t]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{t}</button>)}
      </div>
      <div className="squad" id="dSquad">
        {!list.length && <div className="empty">nessuno qui</div>}
        {list.map((w) => (
          <button key={w.id} type="button" className={`who${w.busy ? ' busy' : ''}`} data-id={w.id} onClick={() => goActor(w.id)}>
            <SpriteSlot make={() => (w.kind === 'specialisti' ? sprites.spec(w.id) : sprites.crew(w.id))} />
            <span className="wtxt">
              <span className="wn"><i style={{ background: w.color }} />{w.name}
                {w.kind === 'specialisti' && <em>{`skill · ${w.uses ?? 0} usi`}</em>}
                {w.kind === 'sub-agenti' && <em>sub-agente</em>}</span>
              <span className="wd">{w.desc}</span>
              <span className="ws">{w.state}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// tutti gli hook che scrivono lo stato, nell'ordine di un turno, con chi fanno muovere nella base
const HOOKS: { k: LinkKey; hook: string; text: string }[] = [
  { k: 'session', hook: 'SessionStart', text: 'il portinaio apre ai terminali' },
  { k: 'prompt', hook: 'UserPromptSubmit', text: 'Marconi riceve il tuo messaggio' },
  { k: 'pre', hook: 'PreToolUse', text: 'parte un sub-agente' },
  { k: 'tool', hook: 'PostToolUse', text: 'il lavoro nei reparti' },
  { k: 'notify', hook: 'Notification', text: 'Ultron ti aspetta' },
  { k: 'sub', hook: 'SubagentStop', text: 'il sub-agente rientra' },
  { k: 'compact', hook: 'PreCompact', text: 'lo spazzino compatta' },
  { k: 'stop', hook: 'Stop', text: 'fine turno' },
];

/** "ora", "5 min fa", "2 h fa", "3 g fa"; null = mai visto in questo browser */
export function seenLabel(s: number | null | undefined): string {
  if (s == null) return 'mai visto';
  if (s < 60) return 'ora';
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  return `${Math.floor(s / 86400)} g fa`;
}

/** COLLEGAMENTO: gli otto hook, quando si sono fatti vivi l'ultima volta. "Mai visto" = da registrare. */
export function Collegamento() {
  const l = useSection('link');
  const raw = useSection('debugRaw');
  const mode = useSection('header')?.mode;
  // in demo gli hook non si registrano (sono eventi finti): "mai visto" lì non è un allarme
  const never = l && mode !== 'demo' ? HOOKS.filter((h) => l.seen[h.k] == null).length : 0;
  return (
    <div className="dp c4">
      <h4>COLLEGAMENTO <em>{!l ? 'hook di Claude Code' : mode === 'demo' ? 'in demo: si registra solo il lavoro vero'
        : never ? `${never} hook mai visti` : 'tutti gli hook visti'}</em></h4>
      <ul className="hooks" id="dLink">
        {HOOKS.map((h) => {
          const seen = l?.seen[h.k];
          const cls = `${l?.last === h.k && l.hot ? ' hot' : ''}${seen == null ? ' never' : seen < 3600 ? ' on' : ''}`;
          return (
            <li key={h.k} className={cls.trim()} data-k={h.k}
                title={seen == null ? `${h.hook}: nessun evento vero visto in questo browser. È registrato in settings.json?` : undefined}>
              <i aria-hidden="true" /><b>{h.hook}</b><span>{h.text}</span><em>{seenLabel(seen)}</em>
            </li>
          );
        })}
      </ul>
      {!!never && <div className="dphint">«mai visto»: l'hook non ha mai mandato un evento vero mentre questa pagina era aperta in questo browser. Se non compare mai, controlla settings.json (vedi README).</div>}
      <div className="raw" id="dRaw" style={{ display: raw ? '' : 'none' }}>
        {raw && <><b>{`${raw.label} ·`}</b> {raw.json}</>}</div>
    </div>
  );
}

export function SquadraGruppo() {
  return (
    <>
      <div className="dgroup" id="sez-squadra">SQUADRA</div>
      <PanelBoundary cls="dp c8" title="SQUADRA"><Squadra /></PanelBoundary>
      <PanelBoundary cls="dp c4" title="COLLEGAMENTO"><Collegamento /></PanelBoundary>
    </>
  );
}
