import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mountDashboard } from './mountDashboard';
import { PanelBoundary } from './Boundary';
import { fakeEngine } from './fixture';

describe('mountDashboard', () => {
  it('si registra su window e si smonta pulito', () => {
    expect(window.mountDashboard).toBe(mountDashboard);
    let h!: ReturnType<typeof mountDashboard>;
    act(() => { h = mountDashboard({}, fakeEngine()); });
    act(() => { h.unmount(); });
  });
  it('un pannello che esplode diventa "pannello non disponibile", il resto resta', () => {
    const Boom = () => { throw new Error('rotto'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<><PanelBoundary cls="dp c4" title="OPERATIVI"><Boom /></PanelBoundary><p>vivo</p></>);
    spy.mockRestore();
    expect(screen.getByText('pannello non disponibile')).toBeTruthy();
    expect(screen.getByText('vivo')).toBeTruthy();
  });
  it('attachStorico monta lo STORICO nel suo slot, attivo solo con la dashboard aperta', async () => {
    const storico = document.createElement('div');
    const from = vi.fn((_table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'order']) b[m] = () => b;
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return b;
    });
    const ch = { on: () => ch, subscribe: () => ch };
    const client = { from, channel: () => ch, removeChannel: () => Promise.resolve('ok') } as unknown as import('@supabase/supabase-js').SupabaseClient;
    let h!: ReturnType<typeof mountDashboard>;
    await act(async () => { h = mountDashboard({ storico }, fakeEngine()); });
    await act(async () => { h.attachStorico(client, [{ id: 'prod', n: 'OFFICINA', col: '#2aa883' }]); });
    expect(storico.querySelector('.dgroup')!.textContent).toBe('STORICO');
    expect(from).not.toHaveBeenCalled();
    await act(async () => { h.setActive(true); });
    expect(from.mock.calls.map((c) => c[0]).sort()).toEqual(['sessions', 'subagents', 'token_usage']);
    await act(async () => { h.unmount(); });
  });
});
