import { useEffect, useRef } from 'react';
import { PanelBoundary } from './Boundary';
import { DTag } from './Lavoro';
import { drawPulse, portraitFrame, pulseBars } from './pulse';
import { useActive, useEngine, useSection } from './store';
import type { DashHeader, LinkKey } from './types';

function Ritratto({ header }: { header: DashHeader | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(header);
  latest.current = header;
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

function Testata() {
  const h = useSection('header');
  return (
    <div className="dp hdr c12">
      <Ritratto header={h} />
      <div>
        <div className="st" id="dStatus" style={{ color: h?.color }}>{h?.status ?? 'idle'}</div>
        <div className="wh" id="dWhere">{h ? h.where : 'nessun reparto'}{h?.whereBold ? <> · <b>{h.whereBold}</b></> : null}</div>
        <div className="id" id="dIdent">{h?.identity ?? 'Ultron'}</div>
      </div>
      <div className="meta">SESSIONE <b id="dClock">{h?.clock ?? '00:00'}</b><br />ULTIMO SEGNALE <b id="dLast">{h ? (h.live ? `${h.lastSeenS}s` : 'demo') : '—'}</b><br />
        <span className={`pill ${h?.live ? 'live' : 'demo'}`} id="dMode">{h?.live ? 'LIVE' : 'DEMO'}</span></div>
    </div>
  );
}

function Segnale() {
  const s = useSection('signal');
  const h = useSection('header');
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current, g = cv?.getContext('2d');
    if (!cv || !g || !s) return;
    drawPulse(g, pulseBars(s.pulse, cv.width, cv.height), cv.width, cv.height, h?.color ?? '#fff');
  }, [s, h?.color]);
  return (
    <div className="dp scr c4"><h4>SEGNALE <DTag id="tagSig" /><em>claude code</em></h4>
      <canvas id="dPulse" ref={ref} width={210} height={60} />
      <div className="stats">
        <div>eventi<b id="dEv">{s?.events ?? 0}</b></div>
        <div>al minuto<b id="dEvm">{s?.perMin ?? '—'}</b></div>
        <div>ultimo tool<b id="dTool" title={s?.lastTool}>{s?.lastToolLabel ?? '—'}</b></div>
        <div>nodo<b id="dNode">{s?.node ?? '—'}</b></div>
      </div>
      <div className="dphint">eventi = tool ricevuti dagli hook · nodo = file toccato nel vault</div></div>
  );
}

const STATIONS: { k: LinkKey; hook: string; text: string }[] = [
  { k: 'prompt', hook: 'UserPromptSubmit', text: 'thinking' },
  { k: 'tool', hook: 'PostToolUse', text: 'barracks.py' },
  { k: 'sub', hook: 'SubagentStop', text: 'reparto rientrato' },
  { k: 'stop', hook: 'Stop', text: 'idle' },
];

function PonteHook() {
  const l = useSection('link');
  const raw = useSection('debugRaw');
  const idx = Math.max(0, STATIONS.findIndex((s) => s.k === l?.last));
  return (
    <div className="dp c8"><h4>PONTE CON CLAUDE CODE <DTag id="tagLink" /><em id="dLinkSub">hook · state.json · poll 400 ms</em></h4>
      <div className="link" id="dLink">
        {STATIONS.map((s) => (
          <div key={s.k} className={`stn${l?.hit[s.k] ? ' on' : ''}${l?.last === s.k && l.hot ? ' hot' : ''}`} data-k={s.k}>
            <i /><b>{s.hook}</b>{s.text}</div>
        ))}
        <div className={`sig${l?.hot ? ' go' : ''}`} id="dSig" style={{ left: `${12.5 + idx * 25}%` }} />
      </div>
      <div className="raw" id="dRaw" style={{ display: raw ? '' : 'none' }}>
        {raw && <><b>{`${raw.label} ·`}</b> {raw.json}</>}</div></div>
  );
}

export function Sessione() {
  return (
    <>
      <div className="dgroup">SESSIONE</div>
      <PanelBoundary cls="dp hdr c12" title="SESSIONE"><Testata /></PanelBoundary>
      <PanelBoundary cls="dp scr c4" title="SEGNALE"><Segnale /></PanelBoundary>
      <PanelBoundary cls="dp c8" title="PONTE CON CLAUDE CODE"><PonteHook /></PanelBoundary>
    </>
  );
}
