import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { Adesso, Naviga, waitingText } from './Adesso';
import { agoLabel, Attivita, Reparti, spanLabel } from './Oggi';
import { Collegamento, seenLabel, Squadra } from './Squadra';
import { Memoria, Missioni, PrioritaAperte } from './Vault';
import { mmss } from './fmt';
import { ActiveCtx, createStore, EngineCtx, StoreCtx } from './store';
import { fakeEngine, fakeSnap } from './fixture';
import type { DashSnapshot, Engine } from './types';

function show(ui: ReactNode, snap: DashSnapshot | null, engine: Engine = fakeEngine(), active = false) {
  const store = createStore();
  if (snap) store.publish(snap);
  const r = render(<StoreCtx.Provider value={store}><EngineCtx.Provider value={engine}>
    <ActiveCtx.Provider value={active}>{ui}</ActiveCtx.Provider></EngineCtx.Provider></StoreCtx.Provider>);
  return { c: r.container, store };
}

describe('formati', () => {
  it('mmss, agoLabel, seenLabel, waitingText', () => {
    expect(mmss(65000)).toBe('1:05');
    expect([agoLabel(3000), agoLabel(40_000), agoLabel(12 * 60_000)]).toEqual(['adesso', '40 s fa', '12 min fa']);
    expect([seenLabel(null), seenLabel(10), seenLabel(300), seenLabel(7200), seenLabel(200000)])
      .toEqual(['mai visto', 'ora', '5 min fa', '2 h fa', '2 g fa']);
    expect(waitingText('permesso · Bash')).toBe('Chiede il permesso per Bash');
    expect(waitingText('permesso')).toBe('Chiede il permesso');
    expect(waitingText('attesa')).toBe('Aspetta la tua risposta');
    expect([spanLabel(300_000), spanLabel(7_200_000), spanLabel(4_800_000)]).toEqual(['5 min', '2 h', '80 min']);
  });
});

describe('ADESSO', () => {
  it('modalità, stato, dove, quattro numeri; niente avviso se non aspetta', () => {
    const { c } = show(<Adesso />, fakeSnap());
    expect(c.querySelector('#dMode')!.textContent).toBe('LIVE');
    expect(c.querySelector('#dStatus')!.textContent).toBe('scrive');
    expect(c.querySelector('#dWhere')!.textContent).toBe('in OFFICINA · x.md');
    expect([...c.querySelectorAll('.tile b')].map((b) => b.textContent)).toEqual(['2', '1', '0', '3s fa']);
    expect(c.querySelector('#dWait')).toBeNull();
  });
  it('quando ti aspetta: fascia d\'allarme con cosa chiede', () => {
    const { c } = show(<Adesso />, fakeSnap({ header: { ...fakeSnap().header, waiting: 'permesso · Bash' } }));
    expect(c.querySelector('.now')!.className).toContain('wait');
    expect(c.querySelector('#dWait')!.textContent).toBe('TI ASPETTA Chiede il permesso per Bash · rispondi nel terminale');
  });
  it('a riposo e in demo lo dice, con una frase', () => {
    const rest = show(<Adesso />, fakeSnap({ header: { ...fakeSnap().header, mode: 'rest', live: false, lastSeenS: null } })).c;
    expect(rest.querySelector('#dMode')!.textContent).toBe('A RIPOSO');
    expect(rest.querySelector('.nowmode')!.textContent).toContain('nessun lavoro negli ultimi 15 minuti');
    const demo = show(<Adesso />, fakeSnap({ header: { ...fakeSnap().header, mode: 'demo', live: false } })).c;
    expect(demo.querySelector('.nowmode')!.textContent).toContain('dati di scena');
  });
  it('il ritratto porta alla base e fa seguire Ultron; anima solo a dashboard aperta', () => {
    const e = fakeEngine();
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { c } = show(<Adesso />, fakeSnap(), e, true);
    expect(raf).toHaveBeenCalled();
    raf.mockRestore();
    fireEvent.click(c.querySelector('.nowport')!);
    expect(e.goActor).toHaveBeenCalledWith('ultron');
  });
  it('la barra delle sezioni porta a ogni gruppo', () => {
    const { c } = show(<Naviga />, fakeSnap());
    expect([...c.querySelectorAll('.dnav button')].map((b) => b.textContent)).toEqual(['ADESSO', 'OGGI', 'SQUADRA', 'VAULT', 'STORICO']);
    const target = document.createElement('div'); target.id = 'sez-vault'; target.scrollIntoView = vi.fn(); document.body.appendChild(target);
    fireEvent.click(c.querySelectorAll('.dnav button')[3]);
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });
});

describe('OGGI', () => {
  it('attività: una riga per reparto più TURNO, un punto per evento, conteggi a destra', () => {
    const { c } = show(<Attivita />, fakeSnap());
    expect([...c.querySelectorAll('.act-lbl')].map((t) => t.textContent)).toEqual(['OFFICINA', 'RICERCA', 'TURNO']);
    expect(c.querySelectorAll('.act-ev')).toHaveLength(3);
    expect([...c.querySelectorAll('.act-n')].map((t) => t.textContent)).toEqual(['1', '1', '1']);
    expect(c.querySelector('h4 em')!.textContent).toBe('3 eventi · 3.0 al minuto · clic su un punto: vai lì');
  });
  it('attività: la finestra si sceglie (5 min, 30 min, 2 ore) e l\'asse la segue', () => {
    const { c } = show(<Attivita />, fakeSnap());
    const b = c.querySelectorAll('.act-head button');
    expect([...b].map((x) => x.textContent)).toEqual(['ultimi 5 min', 'ultimi 30 min', 'ultimi 2 ore']);
    expect(b[1].getAttribute('aria-pressed')).toBe('true');
    act(() => { fireEvent.click(b[0]); });
    expect(c.querySelectorAll('.act-ev')).toHaveLength(2);             // quello di 10 min fa esce
    expect([...c.querySelectorAll('.act-ax')].map((t) => t.textContent)).toEqual(['5 min fa', '3 min', '2 min', 'adesso']);
  });
  it('attività: passandoci sopra si legge cosa e quando; clic va nel reparto (TURNO segue Ultron)', () => {
    const e = fakeEngine();
    const { c } = show(<Attivita />, fakeSnap(), e);
    const ev = c.querySelectorAll('.act-ev');
    fireEvent.mouseEnter(ev[0]);
    expect(c.querySelector('.act-tip')!.textContent).toBe('OFFICINA Modifica10 s fa · clic: vai lì');
    fireEvent.click(ev[0]);
    expect(e.goRoom).toHaveBeenCalledWith('prod');
    fireEvent.click(ev[2]);
    expect(e.goActor).toHaveBeenCalledWith('ultron');
    expect(ev[1].getAttribute('aria-label')).toBe('RICERCA: Lettura, 10 min fa');
  });
  it('attività vuota lo dice', () => {
    const { c } = show(<Attivita />, fakeSnap({ activity: { ...fakeSnap().activity, events: [] } }));
    expect(c.querySelector('.dphint')!.textContent).toBe('nessun evento negli ultimi 30 min');
  });
  it('reparti: tempo, token, eventi, QUI dov\'è Ultron; clic ci porta', () => {
    const e = fakeEngine();
    const { c } = show(<Reparti />, fakeSnap(), e);
    const rows = c.querySelectorAll('.rrow');
    expect(rows[0].className).toContain('here');
    expect(rows[0].querySelector('.rname')!.textContent).toBe('OFFICINAQUI');
    expect(rows[0].querySelector('.rnum')!.textContent).toBe('1:05');
    expect(rows[0].querySelector('.rsub')!.textContent).toBe('2.4k token out · 1 eventi in 2 ore');
    expect((rows[0].querySelector('.rbar b') as HTMLElement).style.width).toBe('100%');
    fireEvent.click(rows[1]);
    expect(e.goRoom).toHaveBeenCalledWith('ricerca');
  });
});

describe('SQUADRA', () => {
  it('truppa e specialisti insieme, chi lavora in cima, filtri', () => {
    const { c } = show(<Squadra />, fakeSnap());
    const names = () => [...c.querySelectorAll('.who')].map((w) => w.getAttribute('data-id'));
    expect(names()).toEqual(['produzione-1', 'ricerca-1', 'taste']);
    expect([...c.querySelectorAll('.chips button')].map((b) => b.textContent)).toEqual(['tutti 3', 'al lavoro 1', 'truppa 2', 'specialisti 1']);
    act(() => { fireEvent.click(c.querySelectorAll('.chips button')[1]); });
    expect(names()).toEqual(['produzione-1']);
    act(() => { fireEvent.click(c.querySelectorAll('.chips button')[3]); });
    expect(names()).toEqual(['taste']);
    expect(c.querySelector('.who em')!.textContent).toBe('skill · 2 usi');
    expect(c.querySelector('.who canvas')!.getAttribute('data-sprite')).toBe('taste');
  });
  it('clic su una persona: la base con la camera su di lei', () => {
    const e = fakeEngine();
    const { c } = show(<Squadra />, fakeSnap(), e);
    fireEvent.click(c.querySelector('.who[data-id="ricerca-1"]')!);
    expect(e.goActor).toHaveBeenCalledWith('ricerca-1');
  });
  it('collegamento: otto hook, quando si sono visti, avviso per quelli mai visti', () => {
    const { c } = show(<Collegamento />, fakeSnap());
    const li = c.querySelectorAll('#dLink li');
    expect(li).toHaveLength(8);
    expect([...li].map((l) => l.querySelector('em')!.textContent))
      .toEqual(['mai visto', 'ora', 'mai visto', 'ora', '1 h fa', 'mai visto', 'mai visto', 'mai visto']);
    expect([...li].map((l) => l.className)).toEqual(['never', 'on', 'never', 'hot on', '', 'never', 'never', 'never']);
    expect(c.querySelector('h4 em')!.textContent).toBe('5 hook mai visti');
    expect(c.querySelector('#dRaw')!.getAttribute('style')).toBe('display: none;');
  });
  it('collegamento in demo: nessun allarme, lo dice', () => {
    const { c } = show(<Collegamento />, fakeSnap({ header: { ...fakeSnap().header, mode: 'demo', live: false } }));
    expect(c.querySelector('h4 em')!.textContent).toBe('in demo: si registra solo il lavoro vero');
    expect(c.querySelector('.dphint')).toBeNull();
  });
});

describe('VAULT', () => {
  it('priorità: fino a 9, "+N altre", clic apre la scheda', () => {
    const e = fakeEngine();
    const open = Array.from({ length: 11 }, (_, i) => `p${i}`);
    const { c } = show(<PrioritaAperte />, fakeSnap({ vault: { ...(fakeSnap().vault as object), priorities: { open, completed: 4 } } as DashSnapshot['vault'] }), e);
    const li = c.querySelectorAll('#dPrio li');
    expect(li).toHaveLength(10);
    expect(li[9].textContent).toBe('+2 altre — vedi Active Priorities.md');
    expect(c.querySelector('#dPrioSub')!.textContent).toBe('11 APERTE · 4 COMPLETATE');
    fireEvent.click(li[1]);
    expect(e.openPriority).toHaveBeenCalledWith('p1');
    expect(show(<PrioritaAperte />, fakeSnap({ vault: 'down' })).c.querySelector('#dPrio')!.textContent).toBe('vault non raggiungibile · avvia start.sh');
  });
  it('missioni: quelle vere; in demo le casse di scena con la nota', () => {
    const e = fakeEngine();
    const { c } = show(<Missioni />, fakeSnap(), e);
    fireEvent.click(c.querySelector('.paper.real')!);
    expect(e.openMission).toHaveBeenCalledWith(0);
    expect(c.querySelector('.scenenote')).toBeNull();
    const demo = show(<Missioni />, fakeSnap({ board: { real: [], scene: [{ id: 3, text: 'cassa', p: .5, stage: 'OFFICINA', qa: false }],
      delivered: [], deliveredCount: 0, live: false, sub: '1 IN CORSO' } })).c;
    expect(demo.querySelector('.scenenote')!.textContent).toBe('casse di scena della demo, non lavoro vero');
  });
  it('memoria: ultima daily, cartelle, vinland', () => {
    const { c } = show(<Memoria />, fakeSnap());
    expect(c.querySelector('#dDay b')!.textContent).toBe('24');
    expect(c.querySelector('#dMon')!.textContent).toBe('SET 2026ultima daily · 18 in tutto');
    expect(c.querySelectorAll('#dFolders > div')).toHaveLength(6);
    expect(c.querySelector('#dVin')!.textContent).toBe('VINLAND · planning · 1 job');
  });
});
