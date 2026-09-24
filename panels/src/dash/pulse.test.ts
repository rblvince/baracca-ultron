import { describe, expect, it } from 'vitest';
import { portraitFrame, pulseBars } from './pulse';

describe('pulseBars (SEGNALE)', () => {
  it('una barra per valore, altezza pari, minimo 2 px, ultima evidenziata', () => {
    const b = pulseBars([0, 0.5, 1], 210, 60);
    expect(b.map((x) => x.h)).toEqual([2, 28, 54]);
    expect(b.map((x) => x.x)).toEqual([0, 70, 140]);
    expect(b[0].w).toBe(69);
    expect(b.map((x) => x.last)).toEqual([false, false, true]);
    expect(b[2].y).toBe(60 - 54 - 2);
  });
});

describe('portraitFrame (ritratto)', () => {
  it('battito di ciglia negli ultimi 120 ms di ogni 3 s', () => {
    expect(portraitFrame(2900, 'writing', false).blink).toBe(true);
    expect(portraitFrame(1000, 'writing', false).blink).toBe(false);
  });
  it('parla solo delegando o fallendo, a scatti di 125 ms', () => {
    expect(portraitFrame(0, 'delegating', false).talk).toBe(true);
    expect(portraitFrame(130, 'delegating', false).talk).toBe(false);
    expect(portraitFrame(0, 'writing', false).talk).toBe(false);
  });
  it('sobbalza di 1 px solo in cammino', () => {
    expect(portraitFrame(130, 'writing', true).dy).toBe(1);
    expect(portraitFrame(130, 'writing', false).dy).toBe(0);
  });
});
