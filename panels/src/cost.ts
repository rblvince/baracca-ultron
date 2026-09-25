import type { TokenUsageRow } from './types';

// Prezzi di listino API in dollari per milione di token, da
// platform.claude.com/docs/en/about-claude/pricing (letti il 2026-09-24).
// Ultron gira in abbonamento: questo è quanto COSTEREBBE lo stesso lavoro a
// listino, non quanto si spende davvero.
type Price = { input: number; output: number; cacheRead: number; write5m: number; write1h: number };
export const PRICES_USD: Record<string, Price> = {
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, write5m: 12.5, write1h: 20 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 },
};

// Cambio di riferimento BCE: 1 € = 1,1411 $ (23/09/2026). Fisso: il costo è una
// stima di valore, non una contabilità. ponytail: aggiornarlo a mano se il cambio si sposta molto.
export const EUR_USD = 1.1411;
export const EUR_USD_DATE = '23/09/2026';

/** Il prezzo di un modello. Nei transcript alcuni id hanno la data in fondo
 *  (claude-haiku-4-5-20251001): il listino li tiene senza. */
export function priceFor(model: string): Price | undefined {
  return PRICES_USD[model] ?? PRICES_USD[model.replace(/-\d{8}$/, '')];
}

/** Costo in euro di una riga, o null se il modello non è in listino (righe vecchie: 'unknown'). */
export function rowCostEur(r: TokenUsageRow): number | null {
  const p = priceFor(r.model);
  if (!p) return null;
  const write5m = r.cache_write - r.cache_write_1h;
  const usd = r.input * p.input + r.output * p.output + r.cache_read * p.cacheRead
    + write5m * p.write5m + r.cache_write_1h * p.write1h;
  return usd / 1e6 / EUR_USD;
}

/** Somma delle righe stimabili; partial se una riga CON consumo è rimasta fuori. */
export function costSummary(rows: TokenUsageRow[]): { eur: number | null; partial: boolean } {
  let eur: number | null = null, partial = false;
  for (const r of rows) {
    const c = rowCostEur(r);
    if (c === null) {
      if (r.input + r.output + r.cache_read + r.cache_write > 0) partial = true;
    } else {
      eur = (eur ?? 0) + c;
    }
  }
  return { eur, partial };
}

export function fmtEur(eur: number | null, partial = false): string {
  if (eur === null) return partial ? 'n/d' : '—';
  const s = eur.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  return partial ? `${s}*` : s;
}
