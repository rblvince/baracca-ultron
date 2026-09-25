import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sessione } from './Sessione';
import { ActiveCtx, createStore, EngineCtx, StoreCtx } from './store';
import { fakeEngine, fakeSnap } from './fixture';
import type { DashSnapshot } from './types';

function show(snap: DashSnapshot, active = true) {
  const store = createStore();
  store.publish(snap);
  const ui = (a: boolean) => (
    <StoreCtx.Provider value={store}><EngineCtx.Provider value={fakeEngine()}>
      <ActiveCtx.Provider value={a}><Sessione /></ActiveCtx.Provider></EngineCtx.Provider></StoreCtx.Provider>);
  const r = render(ui(active));
  return { c: r.container, setActive: (a: boolean) => r.rerender(ui(a)) };
}

// jsdom non implementa HTMLCanvasElement.getContext: la chiamata reale stampa
// un avviso via il virtualConsole di jsdom. I componenti già gestiscono un
// contesto assente (guardia su g null); qui basta evitare di raggiungere
// l'implementazione reale non implementata, così il rumore non parte affatto.
let getContextSpy: ReturnType<typeof vi.spyOn>;

describe('SESSIONE', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    getContextSpy.mockRestore();
  });

  it('testata: stato col suo colore, dove + grassetto, identità, orologio, LIVE', () => {
    const { c } = show(fakeSnap());
    expect(c.querySelector('.dgroup')!.textContent).toBe('SESSIONE');
    const st = c.querySelector('#dStatus') as HTMLElement;
    expect(st.textContent).toBe('scrive');
    expect(st.style.color).toBe('rgb(224, 138, 74)');
    expect(c.querySelector('#dWhere')!.innerHTML).toBe('in OFFICINA · <b>x.md</b>');
    expect(c.querySelector('#dIdent')!.textContent).toBe('Ultron · chief of staff');
    expect(c.querySelector('#dClock')!.textContent).toBe('01:02');
    expect(c.querySelector('#dLast')!.textContent).toBe('3s');
    expect(c.querySelector('#dMode')!.className).toBe('pill live');
    expect(c.querySelector('canvas#dPort')!.getAttribute('width')).toBe('40');
  });
  it('DEMO: "demo" e pillola DEMO', () => {
    const { c } = show(fakeSnap({ header: { ...fakeSnap().header, live: false, lastSeenS: null } }));
    expect(c.querySelector('#dLast')!.textContent).toBe('demo');
    expect(c.querySelector('#dMode')!.textContent).toBe('DEMO');
  });
  it('segnale: contatori', () => {
    const { c } = show(fakeSnap());
    expect(c.querySelector('#dEv')!.textContent).toBe('6');
    expect(c.querySelector('#dEvm')!.textContent).toBe('3.0');
    expect(c.querySelector('#dTool')!.textContent).toBe('modifica');
    expect(c.querySelector('#dTool')!.getAttribute('title')).toBe('Edit');
    expect(c.querySelector('#dNode')!.textContent).toBe('x.md');
  });
  it('ponte: stazioni toccate e calda, segnale sulla stazione, JSON solo con #debug', () => {
    const { c } = show(fakeSnap());
    const stn = c.querySelectorAll('#dLink .stn');
    expect([...stn].map((s) => s.className)).toEqual(
      ['stn never', 'stn on', 'stn never', 'stn on hot', 'stn', 'stn never', 'stn never', 'stn never']);
    expect((c.querySelector('#dSig') as HTMLElement).style.left).toBe('43.75%');
    expect([...stn].map((s) => s.querySelector('em')!.textContent)).toEqual(
      ['mai visto', 'ora', 'mai visto', 'ora', '1 h fa', 'mai visto', 'mai visto', 'mai visto']);
    expect(c.querySelector('#dSig')!.className).toBe('sig go');
    expect((c.querySelector('#dRaw') as HTMLElement).style.display).toBe('none');
    const dbg = show(fakeSnap({ debugRaw: { label: 'state.json', json: '{"a":1}' } })).c;
    expect((dbg.querySelector('#dRaw') as HTMLElement).style.display).toBe('');
    expect(dbg.querySelector('#dRaw')!.innerHTML).toBe('<b>state.json ·</b> {"a":1}');
  });
  it('il ritratto anima solo a dashboard aperta', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const caf = vi.spyOn(window, 'cancelAnimationFrame');
    const { setActive } = show(fakeSnap(), true);
    expect(raf).toHaveBeenCalled();
    act(() => setActive(false));
    expect(caf).toHaveBeenCalled();
    raf.mockClear();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(raf).not.toHaveBeenCalled();
  });
  it('il ritratto continua a riprogrammare i frame mentre la dashboard resta aperta', () => {
    const pending: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => { pending.push(cb); return pending.length; });
    try {
      show(fakeSnap(), true);
      expect(raf).toHaveBeenCalledTimes(1);
      // fa scorrere il tempo di due frame: ogni callback, eseguito, deve
      // riprogrammarsi da solo finché la dashboard resta aperta.
      act(() => { pending.shift()!(16); });
      act(() => { pending.shift()!(32); });
      expect(raf.mock.calls.length).toBeGreaterThan(1);
    } finally {
      raf.mockRestore();
    }
  });
});
