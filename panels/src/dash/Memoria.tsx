import { useEffect, useRef } from 'react';
import { PanelBoundary } from './Boundary';
import { drawShelf, shelfLayout } from './shelf';
import { useSection } from './store';

const MESI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
const GOLD = '#e08a4a'; // P.gold, colore fisso delle barre di Vinland come nel vanilla

function Archivio() {
  const shelf = useSection('shelf');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext('2d');
    if (!cv || !g || !shelf) return;          // jsdom non ha canvas: niente disegno nei test
    drawShelf(g, shelfLayout(shelf, cv.width), cv.width, cv.height);
  }, [shelf]);
  return (
    <div className="dp wood c4"><h4>ARCHIVIO <span className="dtag real">REALE</span><em>vault</em></h4>
      <canvas id="dArch" ref={ref} width={300} height={150} /></div>
  );
}

function Diario() {
  const v = useSection('vault');
  const d = v && v !== 'down' ? v.daily : null;
  const latest = d?.latest ?? null;
  return (
    <div className="dp cal c2"><h4>DIARIO <span className="dtag real">REALE</span></h4>
      <div className="day" id="dDay">{latest ? latest.slice(8, 10) : '—'}</div>
      <div className="mon" id="dMon">{latest ? `${MESI[+latest.slice(5, 7) - 1]} ${latest.slice(0, 4)}` : 'nessuna nota'}</div>
      <div className="cnt" id="dDailySub">{`${d?.count ?? 0} daily notes`}</div></div>
  );
}

function Vinland() {
  const v = useSection('vault');
  const vin = v && v !== 'down' ? v.vinland : null;
  const jobs = vin?.jobs ?? [];
  return (
    <div className="dp c3"><h4>VINLAND <span className="dtag real">REALE</span><em id="dVinStatus">{vin?.status ?? '—'}</em></h4>
      <div className="bars" id="dVinJobs">
        {!jobs.length
          ? <div style={{ color: 'var(--ink-dim)', fontSize: '12px' }}>nessun job nel vault</div>
          : jobs.slice(0, 5).map((j, i) => (
              <div key={i}><span>{j.name.slice(0, 14)}</span>
                <i><b style={{ width: `${Math.min(100, (j.steps / 6) * 100)}%`, background: GOLD }} /></i>
                <small>{j.steps} st</small></div>
            ))}
      </div></div>
  );
}

export function Memoria() {
  return (
    <>
      <div className="dgroup">MEMORIA</div>
      <PanelBoundary cls="dp wood c4" title="ARCHIVIO"><Archivio /></PanelBoundary>
      <PanelBoundary cls="dp cal c2" title="DIARIO"><Diario /></PanelBoundary>
      <PanelBoundary cls="dp c3" title="VINLAND"><Vinland /></PanelBoundary>
    </>
  );
}
