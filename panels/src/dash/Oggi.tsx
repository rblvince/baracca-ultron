import { useState } from 'react';
import { fmtTokens } from '../logic';
import { useWidth } from '../useWidth';
import { PanelBoundary } from './Boundary';
import { mmss } from './fmt';
import { useEngine, useSection } from './store';

const ROW = 30, AXIS = 20, LEFT = 104, RIGHT = 34;
const FINESTRE = [{ ms: 5 * 60_000, t: '5 min' }, { ms: 30 * 60_000, t: '30 min' }, { ms: 2 * 3_600_000, t: '2 ore' }];

/** "30 min", "2 h", "80 min" per le tacche dell'asse */
export function spanLabel(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`;
}

/** "adesso", "40 s fa", "12 min fa" */
export function agoLabel(ms: number): string {
  if (ms < 10_000) return 'adesso';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s fa`;
  return `${Math.round(ms / 60_000)} min fa`;
}

/** ATTIVITÀ: una riga per reparto più TURNO (messaggi, attese, fine turno), sugli ultimi 5 min,
 *  30 min o 2 ore. Un punto per evento; passandoci sopra si legge cosa, cliccando si va nel reparto. */
export function Attivita() {
  const a = useSection('activity');
  const h = useSection('header');
  const { goRoom, goActor } = useEngine();
  const [sel, setSel] = useState<number | null>(null);
  const [win, setWin] = useState(30 * 60_000);
  const [ref, W] = useWidth<HTMLDivElement>(640);
  const rows = a?.rows ?? [];
  const events = (a?.events ?? []).filter((e) => a!.now - e.ts <= win);
  const H = rows.length * ROW + AXIS;
  const PW = Math.max(60, W - LEFT - RIGHT);
  const x = (ts: number) => LEFT + (1 - Math.min(1, Math.max(0, (a!.now - ts) / win))) * PW;
  const rowY = (id: string) => rows.findIndex((r) => r.id === id) * ROW + ROW / 2;
  const go = (row: string) => (row === 'turno' ? goActor('ultron') : goRoom(row));
  const count = (id: string) => events.filter((e) => e.row === id).length;
  const shown = sel !== null ? events[sel] : null;
  return (
    <div className="dp c8">
      <h4>ATTIVITÀ <em>{`${events.length} eventi${h?.perMin ? ` · ${h.perMin} al minuto` : ''} · clic su un punto: vai lì`}</em></h4>
      <div className="act-head">
        <div className="chips" role="group" aria-label="Finestra di tempo">
          {FINESTRE.map((f) => (
            <button key={f.ms} type="button" aria-pressed={win === f.ms} onClick={() => { setWin(f.ms); setSel(null); }}>{`ultimi ${f.t}`}</button>
          ))}
        </div>
      </div>
      <div ref={ref} className="act" onMouseLeave={() => setSel(null)}>
        {!a ? <div className="empty">in attesa dei dati…</div> : (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Attività degli ultimi ${spanLabel(win)} per reparto`}>
            {[0, 1 / 3, 2 / 3, 1].map((k) => (
              <line key={k} className="act-grid" x1={LEFT + k * PW} x2={LEFT + k * PW} y1={0} y2={H - AXIS} />
            ))}
            {rows.map((r, i) => (
              <g key={r.id} className="act-row" onClick={() => go(r.id)}>
                <rect x={0} y={i * ROW} width={W} height={ROW} className={i % 2 ? 'odd' : ''} />
                <rect x={6} y={i * ROW + ROW / 2 - 4} width={8} height={8} rx={2} fill={r.color} />
                <text x={20} y={i * ROW + ROW / 2 + 4} className="act-lbl">{r.name}</text>
                <text x={W - 6} y={i * ROW + ROW / 2 + 4} className="act-n" textAnchor="end">{count(r.id) || ''}</text>
              </g>
            ))}
            {events.map((e, i) => {
              const cx = x(e.ts), cy = rowY(e.row), row = rows.find((r) => r.id === e.row);
              return (
                <g key={i} className={`act-ev${sel === i ? ' on' : ''}`} tabIndex={0} role="button"
                   aria-label={`${row?.name ?? e.row}: ${e.label}, ${agoLabel(a.now - e.ts)}`}
                   onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => go(e.row)}>
                  <circle cx={cx} cy={cy} r={10} fill="transparent" />
                  <circle cx={cx} cy={cy} r={sel === i ? 6 : 4} fill={e.fail ? 'var(--red)' : row?.color ?? '#999'} className="act-dot" />
                </g>
              );
            })}
            {[[`${spanLabel(win)} fa`, 0, 'start'], [spanLabel((win * 2) / 3), 1 / 3, 'middle'], [spanLabel(win / 3), 2 / 3, 'middle'], ['adesso', 1, 'end']].map(([t, k, anchor]) => (
              <text key={String(t)} className="act-ax" x={LEFT + Number(k) * PW} y={H - 5} textAnchor={anchor as 'start'}>{t}</text>
            ))}
          </svg>
        )}
        {shown && a && (
          <div className="act-tip" style={{ left: Math.min(W - 170, Math.max(0, x(shown.ts) - 80)), top: rowY(shown.row) + 14 }}>
            <b>{rows.find((r) => r.id === shown.row)?.name}</b> {shown.label}<br /><i>{agoLabel(a.now - shown.ts)} · clic: vai lì</i>
          </div>
        )}
      </div>
      {a && !events.length && <div className="dphint">{`nessun evento negli ultimi ${spanLabel(win)}`}</div>}
    </div>
  );
}

/** REPARTI: dove sta Ultron, per quanto, quanto spende. Una riga per reparto, clic per andarci. */
export function Reparti() {
  const rooms = useSection('rooms') ?? [];
  const { goRoom } = useEngine();
  return (
    <div className="dp c4">
      <h4>REPARTI <em>da quando è aperta la pagina</em></h4>
      <div className="rlist" id="dRooms">
        {rooms.map((r) => (
          <button key={r.id} type="button" className={`rrow${r.here ? ' here' : ''}`} onClick={() => goRoom(r.id)} title={`Vai in ${r.name}`}>
            <span className="rname"><i style={{ background: r.color }} />{r.name}{r.here && <em>QUI</em>}</span>
            <span className="rbar"><b style={{ width: `${Math.round(r.share * 100)}%`, background: r.color }} /></span>
            <span className="rnum">{mmss(r.ms)}</span>
            <span className="rsub">{`${fmtTokens(r.out)} token out · ${r.events} eventi in 2 ore`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OggiGruppo() {
  return (
    <>
      <div className="dgroup" id="sez-oggi">OGGI</div>
      <PanelBoundary cls="dp c8" title="ATTIVITÀ"><Attivita /></PanelBoundary>
      <PanelBoundary cls="dp c4" title="REPARTI"><Reparti /></PanelBoundary>
    </>
  );
}
