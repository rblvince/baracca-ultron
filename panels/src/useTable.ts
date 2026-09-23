import { useEffect, useRef, useState } from 'react';

export type TableState<T> = { data: T[] | null; error: boolean };

/** Interroga subito quando `active` diventa true, poi ogni intervalMs; si ferma
 *  quando torna false o il componente sparisce. Un errore non cancella i dati
 *  già mostrati: alza solo `error`. */
export function useTable<T>(fetcher: () => Promise<T[]>, active: boolean, intervalMs = 60_000): TableState<T> {
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
    return () => { alive = false; clearInterval(id); };
  }, [active, intervalMs]);

  return state;
}
