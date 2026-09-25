import { describe, expect, it } from 'vitest';
import { costSummary, EUR_USD, rowCostEur } from './cost';
import type { TokenUsageRow } from './types';

const row = (p: Partial<TokenUsageRow>): TokenUsageRow =>
  ({ user_id: 'u', day: '2026-09-25', room: 'prod', model: 'claude-sonnet-5', input: 0, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0, ...p });
const M = 1_000_000;

describe('costo a listino API', () => {
  it('un milione di token costa il prezzo di listino, convertito col cambio BCE', () => {
    expect(rowCostEur(row({ input: M }))).toBeCloseTo(2 / EUR_USD);                              // Sonnet 5 input $2
    expect(rowCostEur(row({ output: M }))).toBeCloseTo(10 / EUR_USD);                            // Sonnet 5 output $10
    expect(rowCostEur(row({ model: 'claude-opus-5-5', cache_read: M }))).toBeCloseTo(0.2 / EUR_USD); // Opus 5.5 lettura cache $0,20
  });
  it('la scrittura in cache a 1 ora costa più di quella a 5 minuti', () => {
    const tutta1h = rowCostEur(row({ model: 'claude-opus-5-5', cache_write: M, cache_write_1h: M }));
    const tutta5m = rowCostEur(row({ model: 'claude-opus-5-5', cache_write: M, cache_write_1h: 0 }));
    expect(tutta1h).toBeCloseTo(8 / EUR_USD);
    expect(tutta5m).toBeCloseTo(5 / EUR_USD);
  });
  it('un id con la data in fondo prende il prezzo del modello', () => {
    expect(rowCostEur(row({ model: 'claude-haiku-4-5-20251001', input: M }))).toBeCloseTo(1 / EUR_USD); // Haiku 4.5 input $1
    expect(rowCostEur(row({ model: 'claude-mistero-20251001', input: M }))).toBeNull();
  });
  it('modello sconosciuto: null, mai un prezzo inventato', () => {
    expect(rowCostEur(row({ model: 'unknown', input: M }))).toBeNull();
    expect(rowCostEur(row({ model: 'gpt-5', input: M }))).toBeNull();
  });
  it('riepilogo: somma le righe note e segnala se qualcuna con consumo è rimasta fuori', () => {
    expect(costSummary([])).toEqual({ eur: null, partial: false });
    expect(costSummary([row({ input: M }), row({ model: 'claude-opus-5-5', output: M })]).eur).toBeCloseTo(22 / EUR_USD);
    const s = costSummary([row({ input: M }), row({ model: 'unknown', input: 5 })]);
    expect(s.eur).toBeCloseTo(2 / EUR_USD);
    expect(s.partial).toBe(true);
    expect(costSummary([row({ model: 'unknown', input: 5 })])).toEqual({ eur: null, partial: true });
    expect(costSummary([row({ model: 'unknown' })]).partial).toBe(false); // riga vuota: niente da stimare
  });
});
