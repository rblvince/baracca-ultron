import { describe, expect, it } from 'vitest';
import { portraitFrame } from './pulse';

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
