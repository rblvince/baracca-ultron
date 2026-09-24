import { describe, expect, it } from 'vitest';
import { shelfLayout } from './shelf';

const row = (count: number) => ({ label: '00 INBOX', count, color: '#c' });

describe('shelfLayout (lo scaffale di ARCHIVIO)', () => {
  it('una fila ogni 25 px, etichetta "NOME conteggio"', () => {
    const l = shelfLayout([row(0), row(3)], 300);
    expect(l.map((x) => x.y)).toEqual([2, 27]);
    expect(l[1].text).toBe('00 INBOX 3');
    expect(l[0].spines).toEqual([]);
  });
  it('dorsi larghi 3-5 px, uno su quattro nel colore della cartella', () => {
    const s = shelfLayout([row(4)], 300)[0].spines;
    expect(s.map((d) => d.w)).toEqual([3, 4, 5, 3]);
    expect(s.map((d) => d.x)).toEqual([4, 10, 17, 25]);
    expect(s[0].color).toBe('#c');
    expect(s[3].color).toBe('#a37b47');     // k%3===0 e non k%4===0
  });
  it('al massimo 22 dorsi e mai sopra l’etichetta (x oltre width-90)', () => {
    expect(shelfLayout([row(500)], 300)[0].spines.length).toBeLessThanOrEqual(22);
    const narrow = shelfLayout([row(500)], 120)[0].spines;
    expect(narrow.length).toBeLessThan(22);
    expect(narrow[narrow.length - 2].x).toBeLessThanOrEqual(120 - 90);
  });
});
