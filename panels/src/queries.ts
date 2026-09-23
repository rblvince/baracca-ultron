import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionRow, SubagentRow, TokenUsageRow } from './types';

// Nessun filtro su user_id: ci pensa la RLS (solo le righe dell'utente loggato).
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw error;
  return (data as T[] | null) ?? [];
}

export const fetchTokenUsage = (c: SupabaseClient, sinceDay: string) =>
  rows<TokenUsageRow>(c.from('token_usage').select('*').gte('day', sinceDay).order('day'));

export const fetchSubagents = (c: SupabaseClient, sinceIso: string) =>
  rows<SubagentRow>(c.from('subagents').select('*').gte('created_at', sinceIso).order('created_at', { ascending: false }));

export const fetchSessions = (c: SupabaseClient, sinceMs: number) =>
  rows<SessionRow>(c.from('sessions').select('*').gte('ts', sinceMs).order('ts'));
