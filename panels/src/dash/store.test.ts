import { describe, expect, it, vi } from 'vitest';
import { createStore } from './store';
import { fakeSnap } from './fixture';

describe('store della dashboard', () => {
  it('prima della prima istantanea ogni sezione è null', () => {
    expect(createStore().get('crew')).toBeNull();
  });
  it('una sezione uguale nel contenuto mantiene lo stesso oggetto: niente ridisegno', () => {
    const s = createStore();
    s.publish(fakeSnap());
    const crew = s.get('crew'), header = s.get('header');
    s.publish(fakeSnap({ header: { ...fakeSnap().header, clock: '09:99' } }));
    expect(s.get('crew')).toBe(crew);           // stessa identità
    expect(s.get('header')).not.toBe(header);   // cambiata davvero
    expect(s.get('header')!.clock).toBe('09:99');
  });
  it('avvisa gli abbonati solo se qualcosa è cambiato', () => {
    const s = createStore(), cb = vi.fn();
    s.subscribe(cb);
    s.publish(fakeSnap());
    s.publish(fakeSnap());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
