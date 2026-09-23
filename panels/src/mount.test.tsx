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
  return { client: { from } as unknown as SupabaseClient, from };
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
});
