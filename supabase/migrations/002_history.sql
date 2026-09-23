-- farm/supabase/migrations/002_history.sql
-- Giro 2, pannelli STORICO. Solo colonne aggiunte: niente di distruttivo.

-- sessions: ora di inizio. Aggiunta SENZA default, poi default solo per le
-- righe nuove: le sessioni esistenti restano NULL ("inizio non registrato")
-- invece di ricevere tutte l'ora della migrazione.
alter table sessions add column created_at timestamptz;
alter table sessions alter column created_at set default now();

-- subagents: da coda a storico. finished_at NULL = ancora in corso.
-- agent_id arriva da SubagentStart e serve a chiudere la riga giusta.
alter table subagents add column finished_at timestamptz;
alter table subagents add column agent_id text;
