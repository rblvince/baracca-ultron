import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchSessions, fetchSubagents, fetchTokenUsage } from './queries';

/** Client finto: registra la catena di chiamate e risolve con {data, error}. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'gte', 'order']) {
    builder[m] = (...args: unknown[]) => { calls.push([m, ...args]); return builder; };
  }
  builder.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result).then(ok, ko);
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('query', () => {
  it('token_usage dal giorno indicato, ordinati per giorno', async () => {
    const { client, calls } = fakeClient({ data: [{ day: '2026-09-23' }], error: null });
    expect(await fetchTokenUsage(client, '2026-08-25')).toEqual([{ day: '2026-09-23' }]);
    expect(calls).toEqual([['from', 'token_usage'], ['select', '*'], ['gte', 'day', '2026-08-25'], ['order', 'day']]);
  });
  it('subagents dal più recente', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await fetchSubagents(client, '2026-09-17T00:00:00.000Z');
    expect(calls).toEqual([['from', 'subagents'], ['select', '*'], ['gte', 'created_at', '2026-09-17T00:00:00.000Z'], ['order', 'created_at', { ascending: false }]]);
  });
  it('sessions per ultimo segnale', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    expect(await fetchSessions(client, 1000)).toEqual([]);
    expect(calls).toEqual([['from', 'sessions'], ['select', '*'], ['gte', 'ts', 1000], ['order', 'ts']]);
  });
  it('un errore di Supabase diventa una promise rifiutata', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'JWT expired' } });
    await expect(fetchSessions(client, 0)).rejects.toEqual({ message: 'JWT expired' });
  });
});
