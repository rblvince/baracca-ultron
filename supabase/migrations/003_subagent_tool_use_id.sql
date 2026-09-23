-- farm/supabase/migrations/003_subagent_tool_use_id.sql
-- Accoppiamento esatto riga del diario <-> sub-agente. SubagentStart porta
-- solo agent_id/agent_type, quindi la claim è per ordine d'arrivo e due
-- partenze ravvicinate possono scambiarsi il compito. Il PostToolUse del tool
-- Agent porta tool_use_id + agentId: con tool_use_id salvato al lancio,
-- barracks.py corregge la coppia. Solo una colonna aggiunta, niente di distruttivo.
alter table subagents add column tool_use_id text;
