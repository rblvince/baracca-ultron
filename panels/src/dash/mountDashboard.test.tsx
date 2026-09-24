import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mountDashboard } from './mountDashboard';
import { PanelBoundary } from './Boundary';
import { render, screen } from '@testing-library/react';
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
});
