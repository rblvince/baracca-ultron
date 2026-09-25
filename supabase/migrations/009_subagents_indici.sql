-- farm/supabase/migrations/009_subagents_indici.sql
-- Indici per le query che la Baracca fa davvero. Il diario dei sub-agenti
-- cresce (le righe si chiudono con finished_at, non si cancellano più) e
-- senza indici ogni claim/reap/reconcile degli hook e ogni rilettura della
-- pagina scorre tutta la tabella.
--   claim e reap FIFO (session_track): user_id, agent_id/finished_at null,
--     created_at >= ..., order by created_at limit 1
--   diario (panels/src/queries.ts) e mini-Ultron (reloadAux): user_id,
--     created_at >= ...
--   reap per id e reconcile: user_id + agent_id, user_id + tool_use_id
--   sessioni in scena (reloadAux): user_id, ts >= ...
-- Solo indici nuovi: niente di distruttivo, si può rilanciare.

create index if not exists subagents_user_created on subagents (user_id, created_at);
create index if not exists subagents_user_agent on subagents (user_id, agent_id);
create index if not exists subagents_user_tool_use on subagents (user_id, tool_use_id);
create index if not exists sessions_user_ts on sessions (user_id, ts);
