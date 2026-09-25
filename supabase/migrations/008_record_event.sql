-- farm/supabase/migrations/008_record_event.sql
-- Un evento degli hook in una sola chiamata: prima PostToolUse faceva tre giri
-- HTTPS in fila (agent_state, sessions, token_usage), ~250 ms l'uno, con
-- Claude Code fermo ad aspettare. Ora gli hook mandano tutto qui, da un
-- processo staccato: due eventi possono arrivare in ordine sparso, quindi uno
-- stato più vecchio (ts minore) di quello già scritto viene scartato.
-- Stato e sessione sono istantanee fresche, come i file locali: le colonne non
-- dette vanno a null (prima PostgREST teneva quelle dell'evento precedente).
-- Solo una funzione nuova: niente di distruttivo.

create or replace function record_event(
  p_user_id uuid, p_state jsonb, p_session jsonb default null, p_tokens jsonb default null
) returns void language plpgsql as $$
begin
  insert into agent_state (user_id, status, room, node, agent, task, area, tool, tokens, line, ts)
  values (p_user_id, coalesce(p_state->>'status', 'idle'), p_state->>'room', p_state->>'node',
          p_state->>'agent', p_state->>'task', p_state->>'area', p_state->>'tool',
          p_state->'tokens', p_state->>'line', (p_state->>'ts')::bigint)
  on conflict (user_id) do update set
    status = excluded.status, room = excluded.room, node = excluded.node, agent = excluded.agent,
    task = excluded.task, area = excluded.area, tool = excluded.tool, tokens = excluded.tokens,
    line = excluded.line, ts = excluded.ts
  where agent_state.ts <= excluded.ts;

  if p_session is not null then
    insert into sessions (user_id, transcript_path, status, room, node, ts)
    values (p_user_id, p_session->>'transcript_path', p_session->>'status', p_session->>'room',
            p_session->>'node', (p_session->>'ts')::bigint)
    on conflict (user_id, transcript_path) do update set
      status = excluded.status, room = excluded.room, node = excluded.node, ts = excluded.ts
    where sessions.ts <= excluded.ts;
  end if;

  if p_tokens is not null then
    perform increment_token_usage(p_user_id, (p_tokens->>'day')::date, p_tokens->>'room',
      (p_tokens->>'input')::bigint, (p_tokens->>'output')::bigint,
      (p_tokens->>'cache_read')::bigint, (p_tokens->>'cache_write')::bigint,
      coalesce(p_tokens->>'model', 'unknown'), coalesce((p_tokens->>'cache_write_1h')::bigint, 0));
  end if;
end;
$$;

-- scrive solo la service key degli hook, mai il browser
revoke all on function record_event(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function record_event(uuid, jsonb, jsonb, jsonb) to service_role;
