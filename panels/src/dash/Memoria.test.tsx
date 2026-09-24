import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Memoria } from './Memoria';
import { createStore, StoreCtx } from './store';
import { fakeSnap } from './fixture';
import type { DashSnapshot } from './types';

// jsdom non implementa HTMLCanvasElement.getContext: la chiamata reale stampa
// un avviso via il virtualConsole di jsdom (già agganciato a console.error
// PRIMA che uno spy per-test possa intercettarlo). Il componente già gestisce
// un contesto assente (guardia su g null); qui basta evitare di raggiungere
// l'implementazione reale non implementata, così il rumore non parte affatto.
let getContextSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { getContextSpy.mockRestore(); });

function show(snap: DashSnapshot | null) {
  const store = createStore();
  if (snap) store.publish(snap);
  return render(<StoreCtx.Provider value={store}><Memoria /></StoreCtx.Provider>).container;
}

describe('MEMORIA', () => {
  it('tre pannelli con le classi e gli id di oggi', () => {
    const c = show(fakeSnap());
    expect(c.querySelector('.dgroup')!.textContent).toBe('MEMORIA');
    expect(c.querySelector('.dp.wood.c4 canvas#dArch')!.getAttribute('width')).toBe('300');
    expect(c.querySelector('.dp.cal.c2')).toBeTruthy();
    expect(c.querySelector('#dVinJobs')).toBeTruthy();
  });
  it('diario e Vinland col vault letto', () => {
    const c = show(fakeSnap());
    expect(c.querySelector('#dDay')!.textContent).toBe('24');
    expect(c.querySelector('#dMon')!.textContent).toBe('SET 2026');
    expect(c.querySelector('#dDailySub')!.textContent).toBe('18 daily notes');
    expect(c.querySelector('#dVinStatus')!.textContent).toBe('planning');
    const job = c.querySelector('#dVinJobs > div')!;
    expect(job.querySelector('span')!.textContent).toBe('ricerca trend ');     // 14 caratteri
    expect((job.querySelector('b') as HTMLElement).style.width).toBe('50%');   // 3/6
    expect(job.querySelector('small')!.textContent).toBe('3 st');
  });
  it('Vinland: barre col colore letto da palette.gold, non un fisso', () => {
    const snap = fakeSnap();
    const c = show(fakeSnap({ palette: { ...snap.palette, gold: '#123456' } }));
    const bar = c.querySelector('#dVinJobs > div b') as HTMLElement;
    expect(bar.style.background).toBe('rgb(18, 52, 86)');
  });
  it('vault non ancora letto o giù: testi di oggi', () => {
    for (const vault of [null, 'down'] as const) {
      const c = show(fakeSnap({ vault }));
      expect(c.querySelector('#dDay')!.textContent).toBe('—');
      expect(c.querySelector('#dMon')!.textContent).toBe('nessuna nota');
      expect(c.querySelector('#dDailySub')!.textContent).toBe('0 daily notes');
      expect(c.querySelector('#dVinStatus')!.textContent).toBe('—');
      expect(c.querySelector('#dVinJobs')!.textContent).toBe('nessun job nel vault');
    }
  });
  it('nessuna istantanea ancora: i pannelli ci sono, vuoti', () => {
    const c = show(null);
    expect(c.querySelector('#dDay')!.textContent).toBe('—');
  });
});
