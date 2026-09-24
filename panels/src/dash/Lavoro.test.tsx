import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BachecaMissioni, PrioritaAperte, TempoPerReparto } from './Lavoro';
import { mmss } from './fmt';
import { createStore, EngineCtx, StoreCtx } from './store';
import { fakeEngine, fakeSnap } from './fixture';
import type { DashSnapshot, Engine } from './types';
import type { ReactNode } from 'react';

function show(ui: ReactNode, snap: DashSnapshot | null, engine: Engine = fakeEngine()) {
  const store = createStore();
  if (snap) store.publish(snap);
  return render(<StoreCtx.Provider value={store}><EngineCtx.Provider value={engine}>{ui}</EngineCtx.Provider></StoreCtx.Provider>).container;
}

describe('mmss', () => {
  it('minuti:secondi', () => { expect(mmss(65000)).toBe('1:05'); expect(mmss(0)).toBe('0:00'); });
});

describe('PRIORITÀ APERTE', () => {
  it('fino a 9 voci, "+N altre", totali, clic apre la scheda', () => {
    const e = fakeEngine();
    const open = Array.from({ length: 11 }, (_, i) => `p${i}`);
    const c = show(<PrioritaAperte />, fakeSnap({ vault: { ...(fakeSnap().vault as object), priorities: { open, completed: 4 } } as DashSnapshot['vault'] }), e);
    const li = c.querySelectorAll('#dPrio li');
    expect(li).toHaveLength(10);
    expect(li[9].textContent).toBe('+2 altre — vedi Active Priorities.md');
    expect(li[0].getAttribute('title')).toBe('p0');
    expect(c.querySelector('#dPrioSub')!.textContent).toBe('11 APERTE · 4 COMPLETATE');
    fireEvent.click(li[1]);
    expect(e.openPriority).toHaveBeenCalledWith('p1');
  });
  it('in attesa, vault giù, nessuna aperta', () => {
    expect(show(<PrioritaAperte />, fakeSnap({ vault: null })).querySelector('#dPrio')!.textContent).toBe('in attesa del vault…');
    expect(show(<PrioritaAperte />, fakeSnap({ vault: 'down' })).querySelector('#dPrio')!.textContent).toBe('vault non raggiungibile · avvia start.sh');
    const none = fakeSnap({ vault: { ...(fakeSnap().vault as object), priorities: { open: [] as string[], completed: 0 } } as DashSnapshot['vault'] });
    expect(show(<PrioritaAperte />, none).querySelector('#dPrio')!.textContent).toBe('nessuna priorità aperta');
  });
});

describe('BACHECA MISSIONI', () => {
  it('LIVE: missioni vere con avanzamento, clic apre la missione', () => {
    const e = fakeEngine();
    const c = show(<BachecaMissioni />, fakeSnap(), e);
    const p = c.querySelector('.paper.real')!;
    expect(p.textContent).toContain('1/2 · prossimo: Passo 2');
    expect((p.querySelector('.bar i') as HTMLElement).style.width).toBe('50%');
    expect(c.querySelector('#dBoardSub')!.textContent).toBe('1 ATTIVE');
    expect((c.querySelector('#dStamp') as HTMLElement).style.display).toBe('none');
    fireEvent.click(p);
    expect(e.openMission).toHaveBeenCalledWith(0);
  });
  it('DEMO: missioni di scena (qa in rosso), consegnate, timbro, al massimo 6 fogli', () => {
    const e = fakeEngine();
    const scene = Array.from({ length: 7 }, (_, i) => ({ id: i, text: `t${i}`, p: 0.3, stage: 'OFFICINA', qa: i === 0 }));
    const c = show(<BachecaMissioni />, fakeSnap({ board: { real: [], scene, delivered: ['fatto1'], deliveredCount: 3, live: false, sub: '7 IN CORSO · 3 CONSEGNATE' } }), e);
    expect(c.querySelectorAll('.paper')).toHaveLength(6);
    expect(c.querySelector('.paper.qa .stg')!.getAttribute('style')).toContain('rgb(217, 72, 58)');
    expect((c.querySelector('#dStamp') as HTMLElement).style.display).toBe('block');
    expect(c.querySelector('#dStamp')!.textContent).toBe('3 CONSEGNATE');
    fireEvent.click(c.querySelectorAll('.paper')[2]);
    expect(e.openTask).toHaveBeenCalledWith(2);
  });
  it('bacheca vuota, ma le consegnate si vedono lo stesso (come oggi)', () => {
    const e = fakeEngine();
    const c = show(<BachecaMissioni />, fakeSnap({ board: { real: [], scene: [], delivered: ['x'], deliveredCount: 1, live: false, sub: '0 IN CORSO · 1 CONSEGNATE' } }), e);
    expect(c.querySelector('.papers .none')!.textContent).toBe('bacheca vuota');
    fireEvent.click(c.querySelector('.paper.done')!);
    expect(e.openDelivered).toHaveBeenCalledWith('x');
  });
});

describe('TEMPO PER REPARTO', () => {
  it('barre in percentuale sul totale, già ordinate, etichetta SCENA/REALE', () => {
    const c = show(<TempoPerReparto />, fakeSnap());
    const rows = c.querySelectorAll('#dTime > div');
    expect(rows[0].querySelector('span')!.textContent).toBe('OFFICINA');
    expect((rows[0].querySelector('b') as HTMLElement).style.width).toBe('100%');
    expect(rows[0].querySelector('small')!.textContent).toBe('1:05');
    expect(c.querySelector('#tagTime')!.textContent).toBe('REALE');
    const demo = show(<TempoPerReparto />, fakeSnap({ header: { ...fakeSnap().header, live: false } }));
    expect(demo.querySelector('#tagTime')!.textContent).toBe('SCENA');
  });
});
