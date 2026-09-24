import { useEffect, useRef, useState } from 'react';

export type TableState<T> = { data: T[] | null; error: boolean };

/** Interroga subito quando `active` diventa true, poi ogni intervalMs; si ferma
 *  quando torna false o il componente sparisce. Un errore non cancella i dati
 *  già mostrati: alza solo `error`. Con `subscribe` (Realtime) rilegge anche
 *  RELOAD_MS dopo l'ultimo cambiamento di una raffica; il giro a intervalMs
 *  resta come rete di sicurezza se il canale cade. */
export const RELOAD_MS = 500;

export function useTable<T>(fetcher: () => Promise<T[]>, active: boolean, intervalMs = 60_000,
  subscribe?: (onChange: () => void) => () => void): TableState<T> {
  const [state, setState] = useState<TableState<T>>({ data: null, error: false });
  const latest = useRef(fetcher);
  latest.current = fetcher;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const run = () => {
      latest.current().then(
        (data) => { if (alive) setState({ data, error: false }); },
        () => { if (alive) setState((s) => ({ data: s.data, error: true })); },
      );
    };
    run();
    const id = setInterval(run, intervalMs);
    let pending: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe?.(() => { if (!alive) return; clearTimeout(pending); pending = setTimeout(run, RELOAD_MS); });
    return () => { alive = false; clearInterval(id); clearTimeout(pending); off?.(); };
  }, [active, intervalMs, subscribe]);

  return state;
}
