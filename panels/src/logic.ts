import type { Room, SessionRow, TokenUsageRow } from './types';

// ---- giorni (sempre ora locale: token_usage.day è scritto con l'ora locale del Mac)

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [y, m, d];
}

export function dayStart(day: string): number {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d).getTime();
}

export function nextDay(day: string): string {
  const [y, m, d] = parts(day);
  return dayKey(new Date(y, m - 1, d + 1));
}

export function lastNDays(today: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)));
  }
  return out;
}

export function fmtDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- token

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  if (k < 1000) return `${k}k`;
  return `${Math.round(n / 100_000) / 10}M`;
}

export type DayBar = { day: string; total: number; byRoom: Record<string, number> };

export function tokenDays(rows: TokenUsageRow[], days: string[]): DayBar[] {
  const map = new Map<string, DayBar>(days.map((d) => [d, { day: d, total: 0, byRoom: {} }]));
  for (const r of rows) {
    const bar = map.get(r.day);
    if (!bar) continue;
    const v = r.input + r.output;
    bar.byRoom[r.room] = (bar.byRoom[r.room] ?? 0) + v;
    bar.total += v;
  }
  return days.map((d) => map.get(d)!);
}

export type TokenSummary = { total: number; topRoom: string | null; cacheYield: number | null };

export function tokenSummary(rows: TokenUsageRow[]): TokenSummary {
  let total = 0, input = 0, read = 0, write = 0;
  const per: Record<string, number> = {};
  for (const r of rows) {
    const v = r.input + r.output;
    total += v;
    per[r.room] = (per[r.room] ?? 0) + v;
    input += r.input;
    read += r.cache_read;
    write += r.cache_write;
  }
  let topRoom: string | null = null;
  for (const [room, v] of Object.entries(per)) {
    if (v > 0 && (topRoom === null || v > per[topRoom])) topRoom = room;
  }
  // quota dell'input totale servita dalla cache (letture / tutto ciò che è entrato)
  const denom = input + read + write;
  return { total, topRoom, cacheYield: denom > 0 ? read / denom : null };
}

// ---- durate e raggruppamenti

export function durationMs(start: string, end: string | null): number | null {
  if (!end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return ms >= 0 ? ms : null;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function groupByDay<T>(rows: T[], when: (r: T) => number): { day: string; rows: T[] }[] {
  const sorted = [...rows].sort((a, b) => when(b) - when(a));
  const groups: { day: string; rows: T[] }[] = [];
  for (const r of sorted) {
    const day = dayKey(new Date(when(r)));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.rows.push(r);
    else groups.push({ day, rows: [r] });
  }
  return groups;
}

// ---- timeline

export type Segment = { day: string; startPct: number; endPct: number; point: boolean };

export function sessionSegments(s: SessionRow, days: string[]): Segment[] {
  const end = s.ts;
  if (!s.created_at) {
    const day = dayKey(new Date(end));
    if (!days.includes(day)) return [];
    const ds = dayStart(day);
    const p = ((end - ds) / (dayStart(nextDay(day)) - ds)) * 100;
    return [{ day, startPct: p, endPct: p, point: true }];
  }
  // created_at viene dall'orologio del server, ts da quello del Mac: se
  // l'inizio risulta dopo la fine, è un istante, non una durata negativa
  const start = Math.min(Date.parse(s.created_at), end);
  const out: Segment[] = [];
  for (const day of days) {
    const ds = dayStart(day);
    const de = dayStart(nextDay(day)); // 23 o 25 ore nei giorni del cambio d'ora
    const a = Math.max(start, ds);
    const b = Math.min(end, de);
    if (b < a || (b === a && start !== end)) continue;
    out.push({ day, startPct: ((a - ds) / (de - ds)) * 100, endPct: ((b - ds) / (de - ds)) * 100, point: false });
  }
  return out;
}

// ---- reparti

const FALLBACK = '#8f7c62';

export function stripedRooms(rooms: Room[]): Set<string> {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const r of rooms) {
    const c = r.col.toLowerCase();
    if (seen.has(c)) out.add(r.id);
    else seen.add(c);
  }
  return out;
}

export function roomOf(rooms: Room[], id: string | null): Room {
  if (!id) return { id: '—', n: '—', col: FALLBACK };
  return rooms.find((r) => r.id === id) ?? { id, n: id, col: FALLBACK };
}

export function roomFill(room: Room, striped: Set<string>): string {
  if (!striped.has(room.id)) return room.col;
  return `repeating-linear-gradient(45deg, ${room.col} 0 3px, rgba(0,0,0,.4) 3px 5px)`;
}

export function orderedRooms(byRoom: Record<string, number>, rooms: Room[]): Room[] {
  const known = rooms.filter((r) => (byRoom[r.id] ?? 0) > 0);
  const unknown = Object.keys(byRoom)
    .filter((id) => byRoom[id] > 0 && !rooms.some((r) => r.id === id))
    .map((id) => roomOf(rooms, id));
  return [...known, ...unknown];
}
