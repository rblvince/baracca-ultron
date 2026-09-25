import { PanelBoundary } from './Boundary';
import { useEngine, useSection } from './store';

const MESI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];

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
          <li key={i} title={t} tabIndex={0} role="button" onClick={() => openPriority(t)}
              onKeyDown={(e) => { if (e.key === 'Enter') openPriority(t); }}>{t}</li>
        ))}
        {open.length > SHOWN && <li className="empty">{`+${open.length - SHOWN} altre — vedi Active Priorities.md`}</li>}
      </>
    );
  }
  return (
    <div className="dp clip c4"><h4>PRIORITÀ APERTE</h4>
      <ul id="dPrio">{items}</ul><div className="tot" id="dPrioSub">{sub}</div></div>
  );
}

/** MISSIONI: quelle vere del vault; in demo anche le casse di scena, segnate come tali. */
export function Missioni() {
  const b = useSection('board');
  const pal = useSection('palette');
  const { openMission, openTask, openDelivered } = useEngine();
  const real = b?.real ?? [], scene = b?.scene ?? [];
  const cap = Math.max(0, 6 - real.length);
  const red = pal?.red ?? '#d9483a';
  const delivered = (b?.delivered ?? []).slice(0, Math.max(0, cap - scene.length));
  return (
    <div className="dp cork c5"><h4>MISSIONI <em id="dBoardSub">{b?.sub ?? ''}</em></h4>
      <div className="papers" id="dBoard">
        {!scene.length && !real.length && <div className="none">nessuna missione attiva</div>}
        {real.map((m) => (
          <div key={`r${m.index}`} className="paper real" role="button" tabIndex={0} onClick={() => openMission(m.index)}>
            {m.title}
            <div className="bar"><i style={{ width: `${Math.round((m.done / m.total) * 100)}%` }} /></div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>{`${m.done}/${m.total}${m.nextTag !== null ? ` · prossimo: ${m.nextTag}` : ''}`}</div>
            <span className="stg">VAULT</span>
          </div>
        ))}
        {scene.slice(0, cap).map((k) => (
          <div key={`s${k.id}`} className={`paper${k.qa ? ' qa' : ''}`} role="button" tabIndex={0} onClick={() => openTask(k.id)}>
            {k.text}
            <div className="bar"><i style={{ width: `${Math.round(k.p * 100)}%` }} /></div>
            <span className="stg" style={{ color: k.qa ? red : '#4a3720', borderColor: k.qa ? red : '#4a3720' }}>{k.stage}</span>
          </div>
        ))}
        {delivered.map((nm, i) => (
          <div key={`d${i}`} className="paper done" role="button" tabIndex={0} onClick={() => openDelivered(nm)}>
            {nm}<span className="stg">FATTO</span>
          </div>
        ))}
      </div>
      {!!scene.length && <div className="scenenote">casse di scena della demo, non lavoro vero</div>}
    </div>
  );
}

/** MEMORIA: l'ultima nota del diario, quante note per cartella del vault, i job di Vinland. */
export function Memoria() {
  const v = useSection('vault');
  const shelf = useSection('shelf') ?? [];
  const d = v && v !== 'down' ? v.daily : null;
  const vin = v && v !== 'down' ? v.vinland : null;
  const latest = d?.latest ?? null;
  const max = Math.max(1, ...shelf.map((s) => s.count));
  return (
    <div className="dp c3"><h4>MEMORIA <em>vault</em></h4>
      {v === 'down' ? <div className="empty">vault non raggiungibile</div> : (
        <>
          <div className="memday" id="dDay">
            <b>{latest ? latest.slice(8, 10) : '—'}</b>
            <span id="dMon">{latest ? `${MESI[+latest.slice(5, 7) - 1]} ${latest.slice(0, 4)}` : 'nessuna nota'}<br />
              <i id="dDailySub">{`ultima daily · ${d?.count ?? 0} in tutto`}</i></span>
          </div>
          <div className="folders" id="dFolders">
            {shelf.map((s) => (
              <div key={s.label}><span>{s.label}</span><i><b style={{ width: `${(s.count / max) * 100}%`, background: s.color }} /></i><small>{s.count}</small></div>
            ))}
          </div>
          <div className="vin" id="dVin">VINLAND · {vin?.status ?? '—'} · {vin?.jobs.length ?? 0} job</div>
        </>
      )}
    </div>
  );
}

export function VaultGruppo() {
  return (
    <>
      <div className="dgroup" id="sez-vault">VAULT</div>
      <PanelBoundary cls="dp cork c5" title="MISSIONI"><Missioni /></PanelBoundary>
      <PanelBoundary cls="dp clip c4" title="PRIORITÀ APERTE"><PrioritaAperte /></PanelBoundary>
      <PanelBoundary cls="dp c3" title="MEMORIA"><Memoria /></PanelBoundary>
    </>
  );
}
