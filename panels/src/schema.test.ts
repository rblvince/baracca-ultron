import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLUMNS } from './types';

// Non `new URL('../../supabase/schema.sql', import.meta.url)`: Vite intercetta
// staticamente quel pattern esatto come asset URL (assetImportMetaUrlRE) e sotto
// vitest/jsdom lo risolve a un http://localhost:.../@fs/... invece che a un
// file://, facendo fallire fileURLToPath. dirname+resolve evita il pattern.
const SQL = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/schema.sql'), 'utf8');

function columnsOf(table: string): string[] {
  const m = SQL.match(new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`tabella ${table} non trovata in schema.sql`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('primary key') && !l.startsWith('unique') && !l.startsWith('--'))
    .map((l) => l.split(/\s+/)[0]);
}

describe('types.ts combacia con schema.sql', () => {
  for (const table of ['token_usage', 'subagents', 'sessions'] as const) {
    it(table, () => {
      expect([...COLUMNS[table]].sort()).toEqual(columnsOf(table).sort());
    });
  }
});
