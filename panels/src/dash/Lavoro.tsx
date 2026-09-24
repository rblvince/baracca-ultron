import { mmss } from './fmt';
import { useEngine, useSection } from './store';
import { PanelBoundary } from './Boundary';
import { SpriteSlot } from './SpriteSlot';

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
