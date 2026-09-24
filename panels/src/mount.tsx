import type { SupabaseClient } from '@supabase/supabase-js';
import { createRoot } from 'react-dom/client';
import { Storico } from './Storico';
import type { Room } from './types';
import './dash/mountDashboard';   // registra window.mountDashboard nello stesso bundle

export type StoricoHandle = { setActive(active: boolean): void; unmount(): void };

/** Unico punto d'ingresso dal vanilla di baracca.html. Il client arriva già
 *  autenticato: niente secondo login, niente seconda connessione. */
export function mountStorico(el: HTMLElement, client: SupabaseClient, opts: { rooms: Room[] }): StoricoHandle {
  const root = createRoot(el);
  const render = (active: boolean) => root.render(<Storico client={client} rooms={opts.rooms} active={active} />);
  render(false);
  return { setActive: render, unmount: () => root.unmount() };
}

declare global {
  interface Window { mountStorico?: typeof mountStorico }
}
window.mountStorico = mountStorico;
