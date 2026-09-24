import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Lavoro } from './Lavoro';
import { Memoria } from './Memoria';
import { Sessione } from './Sessione';
import { ActiveCtx, createStore, EngineCtx, StoreCtx } from './store';
import type { DashSnapshot, Engine, Slots } from './types';
import type { Room } from '../types';

export type DashHandle = {
  publish(s: DashSnapshot): void;
  setActive(active: boolean): void;
  attachStorico(client: SupabaseClient, rooms: Room[]): void;
  unmount(): void;
};

type View = { active: boolean; storico: { client: SupabaseClient; rooms: Room[] } | null };

/** Unico punto d'ingresso dal vanilla per la sala comando. Una radice sola:
 *  ogni gruppo va nel suo slot della griglia #dashv con un portal. */
export function mountDashboard(slots: Slots, engine: Engine): DashHandle {
  const store = createStore();
  let view: View = { active: false, storico: null };
  const viewListeners = new Set<() => void>();
  const setView = (v: View) => { view = v; viewListeners.forEach((l) => l()); };
  const host = document.createElement('div');
  const root = createRoot(host);

  function App() {
    const v = useSyncExternalStore((l) => { viewListeners.add(l); return () => { viewListeners.delete(l); }; }, () => view);
    return (
      <StoreCtx.Provider value={store}>
        <EngineCtx.Provider value={engine}>
          <ActiveCtx.Provider value={v.active}>
            {/* i gruppi si aggiungono qui, uno per task: STORICO */}
            {slots.sessione && createPortal(<Sessione />, slots.sessione)}
            {slots.lavoro && createPortal(<Lavoro />, slots.lavoro)}
            {slots.memoria && createPortal(<Memoria />, slots.memoria)}
          </ActiveCtx.Provider>
        </EngineCtx.Provider>
      </StoreCtx.Provider>
    );
  }
  root.render(<App />);

  return {
    publish: (s) => store.publish(s),
    setActive: (active) => setView({ ...view, active }),
    attachStorico: (client, rooms) => setView({ ...view, storico: { client, rooms } }),
    unmount: () => root.unmount(),
  };
}

declare global {
  interface Window { mountDashboard?: typeof mountDashboard }
}
window.mountDashboard = mountDashboard;
