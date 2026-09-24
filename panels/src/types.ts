// Righe delle tabelle Supabase lette dai pannelli. Scritte a mano da
// supabase/schema.sql (supabase gen types richiederebbe un token d'accesso
// all'account). Il test in schema.test.ts fallisce se divergono.

export type Room = { id: string; n: string; col: string };

export type TokenUsageRow = {
  user_id: string;
  day: string; // 'YYYY-MM-DD', data locale del Mac che ha scritto
  room: string;
  model: string; // migrazione 007; 'unknown' per le righe scritte prima
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_write_1h: number; // la parte di cache_write a 1 ora (migrazione 007)
};

export type SubagentRow = {
  id: number;
  user_id: string;
  room: string;
  agent: string | null;
  task: string | null;
  created_at: string;
  finished_at: string | null;
  agent_id: string | null;
  tool_use_id: string | null; // migrazione 003: accoppiamento esatto col sub-agente
};

export type SessionRow = {
  id: number;
  user_id: string;
  transcript_path: string;
  status: string | null;
  room: string | null;
  node: string | null;
  ts: number; // ms epoch dell'ultimo segnale
  created_at: string | null; // NULL per le sessioni nate prima della migrazione 002
};

// Giorno in cui la migrazione 002 è stata applicata: da qui parte il diario.
export const HISTORY_SINCE = '2026-09-23';

// Elenco delle colonne, verificato contro schema.sql da schema.test.ts.
// Il tipo Exact fa fallire tsc se un elenco non copre esattamente il suo tipo.
type Exact<T, L extends readonly (keyof T)[]> = [keyof T] extends [L[number]] ? L : never;
const cols = <T>() => <L extends readonly (keyof T)[]>(l: Exact<T, L>) => l;

export const COLUMNS = {
  token_usage: cols<TokenUsageRow>()(['user_id', 'day', 'room', 'model', 'input', 'output', 'cache_read', 'cache_write', 'cache_write_1h'] as const),
  subagents: cols<SubagentRow>()(['id', 'user_id', 'room', 'agent', 'task', 'created_at', 'finished_at', 'agent_id', 'tool_use_id'] as const),
  sessions: cols<SessionRow>()(['id', 'user_id', 'transcript_path', 'status', 'room', 'node', 'ts', 'created_at'] as const),
};
