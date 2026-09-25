/** Stato del ritratto al tempo t (ms), come in renderDashLive. */
export function portraitFrame(t: number, rawStatus: string, moving: boolean) {
  const blink = t % 3000 > 2880;
  const talk = rawStatus === 'delegating' || rawStatus === 'failing' ? Math.floor(t * 0.008) % 2 === 0 : false;
  return { blink, talk, dy: moving ? Math.floor(t * 0.008) % 2 : 0 };
}
