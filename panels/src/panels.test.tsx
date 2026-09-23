import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionTimeline } from './SessionTimeline';
import { SubagentLog } from './SubagentLog';
import { TokenHistory } from './TokenHistory';
import type { Room, SessionRow, SubagentRow, TokenUsageRow } from './types';

const ROOMS: Room[] = [
  { id: 'ricerca', n: 'RICERCA', col: '#229fb3' },
  { id: 'prod', n: 'OFFICINA', col: '#2aa883' },
  { id: 'rs', n: 'LABORATORIO', col: '#229fb3' },
];
const DAYS = ['2026-09-22', '2026-09-23'];
const tok = (day: string, room: string, input: number, output: number, cache_read = 0): TokenUsageRow =>
  ({ user_id: 'u', day, room, input, output, cache_read, cache_write: 0 });
const sub = (p: Partial<SubagentRow>): SubagentRow =>
  ({ id: 1, user_id: 'u', room: 'prod', agent: 'produzione-1', task: 'scrive i test', created_at: new Date(2026, 8, 23, 10).toISOString(), finished_at: null, agent_id: null, ...p });

describe('TokenHistory', () => {
  it('caricamento', () => {
    render(<TokenHistory state={{ data: null, error: false }} rooms={ROOMS} days={DAYS} />);
    expect(screen.getByText('caricamento…')).toBeTruthy();
  });
  it('sintesi, righe per il reparto col colore doppio, dettaglio al focus', () => {
    const { container } = render(<TokenHistory state={{ data: [tok('2026-09-22', 'prod', 0, 2000, 3000), tok('2026-09-23', 'rs', 0, 500)], error: false }} rooms={ROOMS} days={DAYS} />);
    expect(screen.getByText('2.5k')).toBeTruthy();            // totale
    expect(screen.getByText('OFFICINA')).toBeTruthy();        // reparto top
    expect(screen.getByText('100%')).toBeTruthy();            // 3000 / (0 input + 3000 letti + 0 scritti)
    expect(container.querySelector('pattern#tk-stripe-rs')).toBeTruthy();
    const bars = container.querySelectorAll('g.tk-bar');
    expect(bars).toHaveLength(2);
    fireEvent.focus(bars[0]);
    expect(container.querySelector('.tk-detail')!.textContent).toContain('22/09');
  });
  it('tutto a zero: nessun NaN nel disegno, resa cache "—"', () => {
    const { container } = render(<TokenHistory state={{ data: [], error: false }} rooms={ROOMS} days={DAYS} />);
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
  it('errore con dati vecchi: li tiene e mostra ERRORE', () => {
    render(<TokenHistory state={{ data: [tok('2026-09-23', 'prod', 0, 100)], error: true }} rooms={ROOMS} days={DAYS} />);
    expect(screen.getByText('ERRORE')).toBeTruthy();
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);   // totale, asse e dettaglio
  });
});

describe('SubagentLog', () => {
  it('vuoto: dice da quando parte il diario', () => {
    render(<SubagentLog state={{ data: [], error: false }} rooms={ROOMS} />);
    expect(screen.getByText(/Il diario parte dal 23\/09/)).toBeTruthy();
  });
  it('in corso e durata chiusa, compito completo nel title', () => {
    const start = new Date(2026, 8, 23, 10);
    render(<SubagentLog state={{ data: [
      sub({ id: 1 }),
      sub({ id: 2, room: 'rs', task: 'un compito molto lungo', finished_at: new Date(start.getTime() + 192_000).toISOString() }),
    ], error: false }} rooms={ROOMS} />);
    expect(screen.getByText('in corso')).toBeTruthy();
    expect(screen.getByText('3m 12s')).toBeTruthy();
    expect(screen.getByTitle('un compito molto lungo')).toBeTruthy();
    expect(screen.getByText('LABORATORIO')).toBeTruthy();
  });
});

describe('SessionTimeline', () => {
  it('una riga per giorno, la più recente in alto; sessione senza inizio come punto', () => {
    const s: SessionRow = { id: 1, user_id: 'u', transcript_path: 't', status: null, room: 'prod', node: null, ts: new Date(2026, 8, 23, 18).getTime(), created_at: null };
    const { container } = render(<SessionTimeline state={{ data: [s], error: false }} rooms={ROOMS} days={DAYS} />);
    const labels = [...container.querySelectorAll('.tl-day')].map((e) => e.textContent);
    expect(labels).toEqual(['23/09', '22/09']);
    const pt = container.querySelector('.tl-pt') as HTMLElement;
    expect(pt.title).toContain('inizio non registrato');
    expect(pt.style.left).toBe('75%');
  });
  it('sessione oltre la mezzanotte: due barre', () => {
    const s: SessionRow = { id: 1, user_id: 'u', transcript_path: 't', status: null, room: 'prod', node: null, ts: new Date(2026, 8, 23, 6).getTime(), created_at: new Date(2026, 8, 22, 18).toISOString() };
    const { container } = render(<SessionTimeline state={{ data: [s], error: false }} rooms={ROOMS} days={DAYS} />);
    expect(container.querySelectorAll('.tl-seg')).toHaveLength(2);
  });
});
