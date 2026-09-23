import type { ReactNode } from 'react';

export function PanelHeader({ title, sub, error }: { title: string; sub: string; error: boolean }) {
  return (
    <h4>
      {title} <span className={`dtag ${error ? 'err' : 'real'}`}>{error ? 'ERRORE' : 'REALE'}</span>
      <em>{sub}</em>
    </h4>
  );
}

/** Blocco caricamento/errore condiviso dai pannelli quando `state.data` è ancora null. */
export function PanelPending({ cls, header, error }: { cls: string; header: ReactNode; error: boolean }) {
  return (
    <div className={cls}>
      {header}
      <div className="empty">{error ? 'dati non raggiungibili' : 'caricamento…'}</div>
    </div>
  );
}
