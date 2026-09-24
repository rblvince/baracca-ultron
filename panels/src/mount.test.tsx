import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mountStorico } from './mount';

function fakeClient() {
  const from = vi.fn();
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'order']) builder[m] = () => builder;
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  from.mockImplementation(() => builder);
  const handlers: Record<string, () => void> = {};
  const channel = vi.fn((name: string) => {
    const ch = { on: (_e: string, f: { table: string }, cb: () => void) => { handlers[f.table] = cb; return ch; }, subscribe: () => ch };
    return ch;
  });
  const removeChannel = vi.fn(() => Promise.resolve('ok'));
  return { client: { from, channel, removeChannel } as unknown as SupabaseClient, from, channel, removeChannel, handlers };
}

describe('mountStorico', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('si registra su window', () => {
    expect(window.mountStorico).toBe(mountStorico);
  });

  it('monta il gruppo STORICO, interroga solo quando attivo, si ferma quando no', async () => {
    const el = document.createElement('div');
    const { client, from } = fakeClient();
    let h!: ReturnType<typeof mountStorico>;
    await act(async () => { h = mountStorico(el, client, { rooms: [{ id: 'prod', n: 'OFFICINA', col: '#2aa883' }] }); });
    expect(el.querySelector('.dgroup')!.textContent).toBe('STORICO');
    expect(el.querySelectorAll('.dp')).toHaveLength(3);
    expect(from).not.toHaveBeenCalled();

    await act(async () => { h.setActive(true); });
    expect(from.mock.calls.map((c) => c[0]).sort()).toEqual(['sessions', 'subagents', 'token_usage']);

    await act(async () => { h.setActive(false); });
    from.mockClear();
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(from).not.toHaveBeenCalled();
    await act(async () => { h.unmount(); });
  });

  it('attivo: diario e timeline in Realtime, un canale per tabella anche dopo più render; un cambiamento rilegge solo quella tabella', async () => {
    const el = document.createElement('div');
    const { client, from, channel, removeChannel, handlers } = fakeClient();
    let h!: ReturnType<typeof mountStorico>;
    await act(async () => { h = mountStorico(el, client, { rooms: [{ id: 'prod', n: 'OFFICINA', col: '#2aa883' }] }); });
    await act(async () => { h.setActive(true); });
    await act(async () => { h.setActive(true); });
    expect(channel.mock.calls.map((c) => c[0]).sort()).toEqual(['storico-sessions', 'storico-subagents']);
    from.mockClear();
    await act(async () => { handlers.subagents(); vi.advanceTimersByTime(500); });
    expect(from.mock.calls.map((c) => c[0])).toEqual(['subagents']);
    await act(async () => { h.setActive(false); });
    expect(removeChannel).toHaveBeenCalledTimes(2);
    await act(async () => { h.unmount(); });
  });
});
