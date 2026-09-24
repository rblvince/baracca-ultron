export type PulseBar = { x: number; y: number; w: number; h: number; last: boolean };

/** Barre del SEGNALE, identiche a drawPulse del vanilla. */
export function pulseBars(pulse: number[], W: number, H: number): PulseBar[] {
  const n = pulse.length;
  return pulse.map((v, i) => {
    const h = Math.max(2, Math.round((v * (H - 6)) / 2) * 2);
    return { x: Math.round(i * (W / n)), y: H - h - 2, w: Math.max(2, Math.floor(W / n) - 1), h, last: i === n - 1 };
  });
}

export function drawPulse(g: CanvasRenderingContext2D, bars: PulseBar[], W: number, H: number, color: string) {
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0c120e'; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(123,189,90,.12)';
  for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);
  for (const b of bars) { g.fillStyle = b.last ? '#fff' : color; g.fillRect(b.x, b.y, b.w, b.h); }
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, H - 2, W, 2);
}

/** Stato del ritratto al tempo t (ms), come in renderDashLive. */
export function portraitFrame(t: number, rawStatus: string, moving: boolean) {
  const blink = t % 3000 > 2880;
  const talk = rawStatus === 'delegating' || rawStatus === 'failing' ? Math.floor(t * 0.008) % 2 === 0 : false;
  return { blink, talk, dy: moving ? Math.floor(t * 0.008) % 2 : 0 };
}
