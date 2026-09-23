// Righe delle tabelle Supabase lette dai pannelli. Scritte a mano da
// supabase/schema.sql (supabase gen types richiederebbe un token d'accesso
// all'account). Il test in schema.test.ts fallisce se divergono.

export type Room = { id: string; n: string; col: string };

export type TokenUsageRow = {
  user_id: string;
  day: string; // 'YYYY-MM-DD', data locale del Mac che ha scritto
  room: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
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
