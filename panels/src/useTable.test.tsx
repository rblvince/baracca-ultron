import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTable, type TableState } from './useTable';

let seen: TableState<number>;
function Probe({ fetcher, active }: { fetcher: () => Promise<number[]>; active: boolean }) {
  seen = useTable(fetcher, active, 60_000);
  return null;
}
const flush = () => act(async () => { await Promise.resolve(); });

describe('useTable', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('non interroga finché non è attivo', async () => {
    const f = vi.fn().mockResolvedValue([1]);
    render(<Probe fetcher={f} active={false} />);
    await flush();
    expect(f).not.toHaveBeenCalled();
    expect(seen).toEqual({ data: null, error: false });
  });

  it('carica subito, poi ogni 60s, e si ferma quando non è più attivo', async () => {
    const f = vi.fn().mockResolvedValue([1]);
    const { rerender } = render(<Probe fetcher={f} active={true} />);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ data: [1], error: false });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(f).toHaveBeenCalledTimes(2);
    rerender(<Probe fetcher={f} active={false} />);
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('dopo un errore tiene l’ultimo dato buono e segnala errore; al giro buono torna pulito', async () => {
    const f = vi.fn().mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error('giù')).mockResolvedValueOnce([2]);
    render(<Probe fetcher={f} active={true} />);
    await flush();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(seen).toEqual({ data: [1], error: true });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(seen).toEqual({ data: [2], error: false });
  });
});
