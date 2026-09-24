import { describe, expect, it } from 'vitest';
import {
  dayKey, dayStart, durationMs, fmtDay, fmtTokens, formatDuration, groupByDay, lastNDays,
  orderedRooms, roomFill, roomOf, sessionSegments, stripedRooms, tokenDays, tokenSummary,
} from './logic';
import type { Room, SessionRow, TokenUsageRow } from './types';

const ROOMS: Room[] = [
  { id: 'ricerca', n: 'RICERCA', col: '#229fb3' },
  { id: 'prod', n: 'OFFICINA', col: '#2aa883' },
  { id: 'rs', n: 'LABORATORIO', col: '#229FB3' },
];
const tok = (day: string, room: string, input: number, output: number, cache_read = 0, cache_write = 0): TokenUsageRow =>
  ({ user_id: 'u', day, room, model: 'claude-sonnet-5', input, output, cache_read, cache_write, cache_write_1h: 0 });
const ses = (p: Partial<SessionRow>): SessionRow =>
  ({ id: 1, user_id: 'u', transcript_path: 't', status: null, room: 'prod', node: null, ts: 0, created_at: null, ...p });

describe('giorni', () => {
  it('lastNDays restituisce n giorni locali, dal più vecchio a oggi', () => {
    expect(lastNDays(new Date(2026, 8, 2, 10), 3)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
  });
  it('dayKey usa la data locale, non UTC', () => {
    expect(dayKey(new Date(2026, 8, 23, 0, 30))).toBe('2026-09-23');
  });
  it('fmtDay mostra GG/MM', () => {
    expect(fmtDay('2026-09-03')).toBe('03/09');
  });
});

describe('token', () => {
  it('tokenDays somma input+output per reparto e tiene i giorni vuoti', () => {
    const bars = tokenDays([tok('2026-09-22', 'prod', 10, 90), tok('2026-09-22', 'rs', 1, 9)], ['2026-09-21', '2026-09-22']);
    expect(bars).toEqual([
      { day: '2026-09-21', total: 0, byRoom: {} },
      { day: '2026-09-22', total: 110, byRoom: { prod: 100, rs: 10 } },
    ]);
  });
  it('tokenDays ignora giorni fuori finestra', () => {
    expect(tokenDays([tok('2026-01-01', 'prod', 5, 5)], ['2026-09-22'])[0].total).toBe(0);
  });
  it('tokenSummary: totale, reparto top, resa cache con cache_write al denominatore', () => {
    const s = tokenSummary([tok('d', 'prod', 100, 900, 800, 100), tok('d', 'rs', 0, 50, 0, 0)]);
    expect(s.total).toBe(1050);
    expect(s.topRoom).toBe('prod');
    expect(s.cacheYield).toBeCloseTo(800 / 1000);
  });
  it('tokenSummary con dati vuoti o tutti a zero non produce NaN', () => {
    expect(tokenSummary([])).toEqual({ total: 0, topRoom: null, cacheYield: null });
    expect(tokenSummary([tok('d', 'prod', 0, 0)])).toEqual({ total: 0, topRoom: null, cacheYield: null });
  });
  it('fmtTokens arrotonda senza scrivere 1000k', () => {
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1500)).toBe('1.5k');
    expect(fmtTokens(999_950)).toBe('1M');
    expect(fmtTokens(1_234_567)).toBe('1.2M');
  });
});

describe('durate', () => {
  it('durationMs: null se ancora in corso o se le date sono al contrario', () => {
    expect(durationMs('2026-09-23T10:00:00Z', null)).toBeNull();
    expect(durationMs('2026-09-23T10:00:10Z', '2026-09-23T10:00:00Z')).toBeNull();
    expect(durationMs('2026-09-23T10:00:00Z', '2026-09-23T10:01:05Z')).toBe(65_000);
  });
  it('formatDuration', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(192_000)).toBe('3m 12s');
    expect(formatDuration(3_840_000)).toBe('1h 04m');
  });
  it('groupByDay: giorni dal più recente, righe dal più recente', () => {
    const a = { t: new Date(2026, 8, 22, 9).getTime() };
    const b = { t: new Date(2026, 8, 23, 8).getTime() };
    const c = { t: new Date(2026, 8, 23, 18).getTime() };
    expect(groupByDay([a, b, c], (r) => r.t)).toEqual([
      { day: '2026-09-23', rows: [c, b] },
      { day: '2026-09-22', rows: [a] },
    ]);
  });
});

describe('timeline', () => {
  const days = ['2026-09-22', '2026-09-23'];
  it('sessione nello stesso giorno: una barra con le percentuali giuste', () => {
    const s = ses({ created_at: new Date(2026, 8, 23, 6).toISOString(), ts: new Date(2026, 8, 23, 12).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-23', startPct: 25, endPct: 50, point: false }]);
  });
  it('sessione a cavallo della mezzanotte: spezzata su due giorni', () => {
    const s = ses({ created_at: new Date(2026, 8, 22, 18).toISOString(), ts: new Date(2026, 8, 23, 6).getTime() });
    expect(sessionSegments(s, days)).toEqual([
      { day: '2026-09-22', startPct: 75, endPct: 100, point: false },
      { day: '2026-09-23', startPct: 0, endPct: 25, point: false },
    ]);
  });
  it('sessione che finisce esattamente a mezzanotte: nessuna barra vuota il giorno dopo', () => {
    const s = ses({ created_at: new Date(2026, 8, 22, 18).toISOString(), ts: new Date(2026, 8, 23, 0).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-22', startPct: 75, endPct: 100, point: false }]);
  });
  it('sessione senza inizio registrato: un punto sull’ultimo segnale', () => {
    const s = ses({ created_at: null, ts: new Date(2026, 8, 23, 18).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-23', startPct: 75, endPct: 75, point: true }]);
  });
  it('inizio dopo l’ultimo segnale (orologi diversi): trattato come un istante', () => {
    const s = ses({ created_at: new Date(2026, 8, 23, 12, 0, 1).toISOString(), ts: new Date(2026, 8, 23, 12).getTime() });
    expect(sessionSegments(s, days)).toEqual([{ day: '2026-09-23', startPct: 50, endPct: 50, point: false }]);
  });
  it('sessione fuori finestra: niente', () => {
    const s = ses({ created_at: null, ts: new Date(2026, 0, 1).getTime() });
    expect(sessionSegments(s, days)).toEqual([]);
  });
  it('giorno con cambio d’ora (25 ore) resta tra 0 e 100', () => {
    const s = ses({ created_at: new Date(2026, 9, 25, 0).toISOString(), ts: new Date(2026, 9, 25, 23, 59).getTime() });
    const [seg] = sessionSegments(s, ['2026-10-25']);
    expect(seg.startPct).toBe(0);
    expect(seg.endPct).toBeGreaterThan(99);
    expect(seg.endPct).toBeLessThanOrEqual(100);
    expect(dayStart('2026-10-26') - dayStart('2026-10-25')).toBe(25 * 3_600_000);
  });
});

describe('reparti', () => {
  it('stripedRooms: il secondo reparto con lo stesso colore va a righe', () => {
    expect([...stripedRooms(ROOMS)]).toEqual(['rs']);
  });
  it('roomOf: reparto sconosciuto con nome e colore di riserva', () => {
    expect(roomOf(ROOMS, 'boh')).toEqual({ id: 'boh', n: 'boh', col: '#8f7c62' });
    expect(roomOf(ROOMS, null)).toEqual({ id: '—', n: '—', col: '#8f7c62' });
  });
  it('roomFill: colore pieno o righe', () => {
    const striped = stripedRooms(ROOMS);
    expect(roomFill(ROOMS[1], striped)).toBe('#2aa883');
    expect(roomFill(ROOMS[2], striped)).toContain('repeating-linear-gradient');
  });
  it('orderedRooms: ordine di ROOMS, poi gli sconosciuti, solo quelli con valore', () => {
    expect(orderedRooms({ rs: 1, boh: 2, prod: 3, ricerca: 0 }, ROOMS).map((r) => r.id)).toEqual(['prod', 'rs', 'boh']);
  });
});
