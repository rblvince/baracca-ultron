import { useEffect, useRef } from 'react';
import { PanelBoundary } from './Boundary';
import { DTag } from './Lavoro';
import { drawPulse, portraitFrame, pulseBars } from './pulse';
import { useActive, useEngine, useSection } from './store';
import type { DashHeader, LinkKey } from './types';

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

// tutti gli hook che scrivono lo stato, nell'ordine di un turno; sotto, quando si è fatto vivo l'ultima volta
const STATIONS: { k: LinkKey; hook: string; text: string }[] = [
  { k: 'session', hook: 'SessionStart', text: 'portinaio' },
  { k: 'prompt', hook: 'UserPromptSubmit', text: 'marconi' },
  { k: 'pre', hook: 'PreToolUse', text: 'sub-agente parte' },
  { k: 'tool', hook: 'PostToolUse', text: 'il lavoro' },
  { k: 'notify', hook: 'Notification', text: 'ti aspetta' },
  { k: 'sub', hook: 'SubagentStop', text: 'rientra' },
  { k: 'compact', hook: 'PreCompact', text: 'spazzino' },
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

function PonteHook() {
  const l = useSection('link');
  const raw = useSection('debugRaw');
  const idx = Math.max(0, STATIONS.findIndex((s) => s.k === l?.last));
  return (
    <div className="dp c8"><h4>PONTE CON CLAUDE CODE <DTag id="tagLink" /><em id="dLinkSub">hook · Supabase Realtime</em></h4>
      <div className="link" id="dLink">
        {STATIONS.map((s) => (
          <div key={s.k} className={`stn${l?.hit[s.k] ? ' on' : ''}${l?.last === s.k && l.hot ? ' hot' : ''}${l && l.seen[s.k] == null ? ' never' : ''}`}
            data-k={s.k} title={l && l.seen[s.k] == null ? `${s.hook}: nessun evento vero visto qui. È registrato in settings.json?` : undefined}>
            <i /><b>{s.hook}</b>{s.text}<em>{seenLabel(l?.seen[s.k])}</em></div>
        ))}
        <div className={`sig${l?.hot ? ' go' : ''}`} id="dSig" style={{ left: `${6.25 + idx * 12.5}%` }} />
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
