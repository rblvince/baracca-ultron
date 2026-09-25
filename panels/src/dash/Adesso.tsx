import { useEffect, useRef } from 'react';
import { PanelBoundary } from './Boundary';
import { portraitFrame } from './pulse';
import { useActive, useEngine, useSection } from './store';
import type { DashHeader } from './types';

/** Le sezioni della sala comando: un salto per ognuna, in una barra che resta in alto. */
export const SEZIONI = [
  { id: 'sez-adesso', n: 'ADESSO' }, { id: 'sez-oggi', n: 'OGGI' }, { id: 'sez-squadra', n: 'SQUADRA' },
  { id: 'sez-vault', n: 'VAULT' }, { id: 'sez-storico', n: 'STORICO' },
];

export function Naviga() {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <nav className="dnav" aria-label="Sezioni della sala comando">
      {SEZIONI.map((s) => <button key={s.id} type="button" onClick={() => go(s.id)}>{s.n}</button>)}
    </nav>
  );
}

function Ritratto({ header }: { header: DashHeader | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(header);
  useEffect(() => { latest.current = header; });
  const active = useActive();
  const { sprites } = useEngine();
  useEffect(() => {
    if (!active) return;
    let id = 0;
    const frame = (t: number) => {
      const cv = ref.current, g = cv?.getContext('2d'), h = latest.current;
      if (cv && g && h) {
        g.imageSmoothingEnabled = false;
        g.fillStyle = '#1b1610'; g.fillRect(0, 0, cv.width, cv.height);
        g.fillStyle = h.color; g.globalAlpha = 0.16;
        for (let i = 0; i < cv.height; i += 4) g.fillRect(0, i, cv.width, 2);
        g.globalAlpha = 1;
        const f = portraitFrame(t, h.rawStatus, h.moving);
        g.drawImage(sprites.bust(h.rawStatus, f.blink, f.talk), 0, f.dy);
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [active, sprites]);
  return <canvas id="dPort" ref={ref} width={40} height={28} />;
}

const MODE = {
  live: { t: 'LIVE', note: 'dati veri dagli hook di Claude Code' },
  rest: { t: 'A RIPOSO', note: 'nessun lavoro negli ultimi 15 minuti' },
  demo: { t: 'DEMO', note: 'dati di scena: niente di quello che vedi è lavoro vero' },
} as const;

/** "permesso · Bash" → "Chiede il permesso per Bash"; "attesa" → "Aspetta la tua risposta". */
export function waitingText(w: string): string {
  if (w.startsWith('permesso')) {
    const tool = w.split('· ')[1];
    return `Chiede il permesso${tool ? ` per ${tool}` : ''}`;
  }
  return 'Aspetta la tua risposta';
}

/** ADESSO: cosa fa Ultron in questo momento e se aspetta te, poi quattro numeri. */
export function Adesso() {
  const h = useSection('header');
  const { goActor } = useEngine();
  const mode = MODE[h?.mode ?? 'demo'];
  const tiles = [
    { k: 'in coda', v: h ? String(h.queue) : '—', hint: 'eventi arrivati che la scena deve ancora recitare' },
    { k: 'terminali', v: h ? String(h.terminals) : '—', hint: 'sessioni di Claude Code attive' },
    { k: 'sub-agenti', v: h ? String(h.subagents) : '—', hint: 'al lavoro adesso' },
    { k: 'ultimo segnale', v: h?.lastSeenS != null ? `${h.lastSeenS}s fa` : '—', hint: `sessione aperta da ${h?.clock ?? '00:00'}` },
  ];
  return (
    <div className={`dp now c12${h?.waiting ? ' wait' : ''}`} id="sez-adesso">
      <button type="button" className="nowport" onClick={() => goActor('ultron')} title="Mostra Ultron nella base (la camera lo segue)">
        <Ritratto header={h} />
      </button>
      <div className="nowtxt">
        <div className="nowmode"><span className={`pill ${h?.mode ?? 'demo'}`} id="dMode">{mode.t}</span><span>{mode.note}</span></div>
        <div className="st" id="dStatus" style={{ color: h?.color }}>{h?.status ?? 'in attesa'}</div>
        <div className="wh" id="dWhere">{h ? h.where : 'nessun reparto'}{h?.whereBold ? <> · <b>{h.whereBold}</b></> : null}</div>
        {h?.waiting && <div className="waitbar" id="dWait" role="alert"><b>TI ASPETTA</b> {waitingText(h.waiting)} · rispondi nel terminale</div>}
      </div>
      <div className="tiles">
        {tiles.map((t) => <div key={t.k} className="tile" title={t.hint}><i>{t.k}</i><b>{t.v}</b></div>)}
      </div>
    </div>
  );
}

export function AdessoGruppo() {
  return (
    <>
      <Naviga />
      <PanelBoundary cls="dp now c12" title="ADESSO"><Adesso /></PanelBoundary>
    </>
  );
}
