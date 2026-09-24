import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DashSnapshot, Engine } from './types';

type Key = keyof DashSnapshot;

/** Tiene l'ultima istantanea sezione per sezione. Una sezione uguale nel
 *  contenuto (JSON) conserva il vecchio oggetto: useSyncExternalStore vede la
 *  stessa identità e il pannello non si ridisegna. Il vanilla pubblica ogni
 *  110 ms, quindi è questo che tiene ferma la dashboard quando niente cambia. */
export function createStore() {
  let snap: Partial<DashSnapshot> = {};
  const json: Partial<Record<Key, string>> = {};
  const listeners = new Set<() => void>();
  return {
    publish(next: DashSnapshot) {
      let changed = false;
      const merged: Partial<DashSnapshot> = { ...snap };
      for (const k of Object.keys(next) as Key[]) {
        const j = JSON.stringify(next[k]);
        if (j !== json[k]) { json[k] = j; (merged as Record<Key, unknown>)[k] = next[k]; changed = true; }
      }
      if (!changed) return;
      snap = merged;
      listeners.forEach((l) => l());
    },
    get<K extends Key>(k: K): DashSnapshot[K] | null { return (snap[k] as DashSnapshot[K] | undefined) ?? null; },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}
export type DashStore = ReturnType<typeof createStore>;

export const StoreCtx = createContext<DashStore | null>(null);
export const EngineCtx = createContext<Engine | null>(null);
export const ActiveCtx = createContext(false);

export function useSection<K extends Key>(k: K): DashSnapshot[K] | null {
  const store = useContext(StoreCtx)!;
  return useSyncExternalStore(store.subscribe, () => store.get(k));
}
export const useEngine = () => useContext(EngineCtx)!;
export const useActive = () => useContext(ActiveCtx);
