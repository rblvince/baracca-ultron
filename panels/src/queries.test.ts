import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchSessions, fetchSubagents, fetchTokenUsage, listenTable } from './queries';

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

  it('listenTable: canale sulla tabella, callback a ogni cambiamento, e lo chiude allo stop', () => {
    const calls: unknown[][] = [];
    let handler: () => void = () => {};
    const channel = {
      on: (...a: unknown[]) => { calls.push(['on', a[0], a[1]]); handler = a[2] as () => void; return channel; },
      subscribe: () => { calls.push(['subscribe']); return channel; },
    };
    const client = {
      channel: (name: string) => { calls.push(['channel', name]); return channel; },
      removeChannel: (c: unknown) => { calls.push(['removeChannel', c === channel]); return Promise.resolve('ok'); },
    } as unknown as SupabaseClient;
    let hits = 0;
    const stop = listenTable(client, 'subagents')(() => { hits++; });
    expect(calls).toEqual([['channel', 'storico-subagents'], ['on', 'postgres_changes', { event: '*', schema: 'public', table: 'subagents' }], ['subscribe']]);
    handler();
    expect(hits).toBe(1);
    stop();
    expect(calls[calls.length - 1]).toEqual(['removeChannel', true]);
  });
});
