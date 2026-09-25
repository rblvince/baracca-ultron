import { vi } from 'vitest';
import type { DashSnapshot, Engine } from './types';

/** Motore finto: sprite riconoscibili dal data-sprite, schede e spostamenti spiati. */
export const fakeEngine = (): Engine => ({
  sprites: {
    bust: () => document.createElement('canvas'),
    crew: (id) => { const c = document.createElement('canvas'); c.dataset.sprite = id; return c; },
    spec: (id) => { const c = document.createElement('canvas'); c.dataset.sprite = id; return c; },
  },
  openPriority: vi.fn(), openMission: vi.fn(), openTask: vi.fn(), openDelivered: vi.fn(),
  goRoom: vi.fn(), goActor: vi.fn(),
});

/** Istantanea finta ma completa, per i test dei pannelli. */
export function fakeSnap(over: Partial<DashSnapshot> = {}): DashSnapshot {
  return {
    header: { status: 'scrive', rawStatus: 'writing', color: '#e08a4a', where: 'in OFFICINA', whereBold: 'x.md',
              identity: 'Ultron · chief of staff', clock: '01:02', live: true, lastSeenS: 3, moving: false,
              mode: 'live', waiting: null, queue: 2, terminals: 1, subagents: 0, events: 6, perMin: '3.0' },
    activity: { now: 1_000_000, win: 1_800_000,
                rows: [{ id: 'prod', name: 'OFFICINA', color: '#2aa883' }, { id: 'ricerca', name: 'RICERCA', color: '#229fb3' },
                       { id: 'turno', name: 'TURNO', color: '#fbeedc' }],
                events: [{ ts: 990_000, row: 'prod', label: 'Modifica', fail: false },
                         { ts: 400_000, row: 'ricerca', label: 'Lettura', fail: false },
                         { ts: 999_000, row: 'turno', label: 'ti aspetta', fail: false }] },
    rooms: [{ id: 'prod', name: 'OFFICINA', color: '#2aa883', ms: 65000, share: 1, out: 2400, events: 1, here: true },
            { id: 'ricerca', name: 'RICERCA', color: '#229fb3', ms: 0, share: 0, out: 0, events: 1, here: false }],
    link: { hit: { session: false, prompt: true, pre: false, tool: true, notify: false, sub: false, compact: false, stop: false }, last: 'tool', hot: true,
            seen: { session: null, prompt: 30, pre: null, tool: 2, notify: 4000, sub: null, compact: null, stop: null } },
    crew: [{ id: 'ricerca-1', name: 'RIC-1', color: '#229fb3', desc: 'letture', role: 'RICERCA', state: 'alla postazione · ricerca', busy: false },
           { id: 'produzione-1', name: 'PRD-1', color: '#2aa883', desc: 'comandi', role: 'PORTA CASSA', state: 'porta x', busy: true }],
    board: { real: [{ index: 0, title: 'Supabase', done: 1, total: 2, nextTag: 'Passo 2' }],
             scene: [], delivered: [], deliveredCount: 0, live: true, sub: '1 ATTIVE' },
    skills: [{ id: 'taste', name: 'TASTE', color: '#9c6fc4', desc: 'gusto', uses: 2, hot: true, where: 'al posto', busy: false }],
    shelf: [{ label: '00 INBOX', count: 1, color: '#229fb3' }, { label: '01 DAILY', count: 18, color: '#9c6fc4' },
            { label: '02 VINLAND', count: 1, color: '#e08a4a' }, { label: '03 PERSONAL', count: 0, color: '#2aa883' },
            { label: '05 RESOURCES', count: 2, color: '#4f8fc4' }, { label: '04 ARCHIVE', count: 0, color: '#7d715c' }],
    vault: { priorities: { open: ['uno', 'due'], completed: 4 },
             vinland: { status: 'planning', jobs: [{ name: 'ricerca trend settimanale', steps: 3 }] },
             daily: { latest: '2026-09-24', count: 18 } },
    debugRaw: null,
    palette: { gold: '#e08a4a', cyan: '#229fb3', violet: '#9c6fc4', green: '#2aa883', red: '#d9483a' },
    ...over,
  };
}
