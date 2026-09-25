-- farm/supabase/schema.sql
create table agent_state (
  user_id uuid primary key references auth.users(id),
  status text not null default 'idle',
  room text,
  node text,
  agent text,
  task text,
  area text,
  tool text,
  tokens jsonb,
  line text,
  ts bigint not null
);

create table sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  transcript_path text not null,
  status text,
  room text,
  node text,
  ts bigint not null,
  created_at timestamptz default now(),
  unique (user_id, transcript_path)
);

create table subagents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  room text not null,
  agent text,
  task text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  agent_id text,
  tool_use_id text
);

create table token_usage (
  user_id uuid not null references auth.users(id),
  day date not null,
  room text not null,
  model text not null default 'unknown', -- migrazione 007
  input bigint not null default 0,
  output bigint not null default 0,
  cache_read bigint not null default 0,
  cache_write bigint not null default 0,
  cache_write_1h bigint not null default 0, -- migrazione 007: parte di cache_write a 1 ora
  primary key (user_id, day, room, model)
);

-- migrazione 009: indici per claim/reap/reconcile degli hook e per le riletture della pagina
create index subagents_user_created on subagents (user_id, created_at);
create index subagents_user_agent on subagents (user_id, agent_id);
create index subagents_user_tool_use on subagents (user_id, tool_use_id);
create index sessions_user_ts on sessions (user_id, ts);

-- upsert incrementale: PostgREST non sa fare "upsert che somma", serve una funzione.
-- p_model e p_cache_write_1h dalla migrazione 007, con default per gli hook vecchi.
create or replace function increment_token_usage(
  p_user_id uuid, p_day date, p_room text,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint,
  p_model text default 'unknown', p_cache_write_1h bigint default 0
) returns void as $$
  insert into token_usage (user_id, day, room, model, input, output, cache_read, cache_write, cache_write_1h)
  values (p_user_id, p_day, p_room, p_model, p_input, p_output, p_cache_read, p_cache_write, p_cache_write_1h)
  on conflict (user_id, day, room, model) do update set
    input = token_usage.input + excluded.input,
    output = token_usage.output + excluded.output,
    cache_read = token_usage.cache_read + excluded.cache_read,
    cache_write = token_usage.cache_write + excluded.cache_write,
    cache_write_1h = token_usage.cache_write_1h + excluded.cache_write_1h;
$$ language sql;

-- migrazione 008: un evento degli hook in una chiamata sola, con guardia su ts
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

alter table agent_state enable row level security;
alter table sessions enable row level security;
alter table subagents enable row level security;
alter table token_usage enable row level security;

create policy "solo il proprietario" on agent_state for select using (auth.uid() = user_id);
create policy "solo il proprietario" on sessions for select using (auth.uid() = user_id);
create policy "solo il proprietario" on subagents for select using (auth.uid() = user_id);
create policy "solo il proprietario" on token_usage for select using (auth.uid() = user_id);

-- Realtime: senza questo, Supabase non emette MAI postgres_changes su questa
-- tabella pur rispondendo SUBSCRIBED. replica identity full serve perché
-- Realtime possa valutare la RLS sulla riga e popolare payload.old.
alter publication supabase_realtime add table agent_state;
alter table agent_state replica identity full;
-- migrazione 006: cloni e mini-Ultron della Baracca via Realtime
alter publication supabase_realtime add table sessions, subagents;
alter table sessions replica identity full;
alter table subagents replica identity full;

-- avviso Discord su waiting (migrazione 004): segreti discord_webhook_baracca
-- e (migrazione 010) discord_user_id nel Vault
create extension if not exists pg_net;

-- tetto: al massimo un messaggio ogni 5 minuti per utente. RLS attiva e
-- nessuna policy: dal browser non si legge né si scrive.
create table alert_throttle (
  user_id uuid primary key references auth.users(id),
  last_sent timestamptz not null
);
alter table alert_throttle enable row level security;

-- corpo dalla migrazione 010: webhook e id da menzionare nel Vault
create or replace function notify_waiting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hook text;
  mention text;
  allowed boolean;
  content text;
  body jsonb;
begin
  select decrypted_secret into hook from vault.decrypted_secrets
   where name = 'discord_webhook_baracca' limit 1;
  if hook is null then
    return new;
  end if;

  -- prende il turno solo se l'ultimo invio ha più di 5 minuti (o non c'è)
  insert into public.alert_throttle (user_id, last_sent) values (new.user_id, now())
  on conflict (user_id) do update set last_sent = excluded.last_sent
   where public.alert_throttle.last_sent < now() - interval '5 minutes'
  returning true into allowed;
  if allowed is null then
    return new;
  end if;

  select decrypted_secret into mention from vault.decrypted_secrets
   where name = 'discord_user_id' limit 1;
  if mention !~ '^[0-9]+$' then
    mention := null;   -- solo un id numerico: nient'altro finisce nel messaggio
  end if;

  content := 'Ultron ti aspetta nella Baracca — ' || to_char(now() at time zone 'Europe/Rome', 'HH24:MI');
  if mention is null then
    body := jsonb_build_object('content', content,
                               'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb));
  else
    body := jsonb_build_object('content', '<@' || mention || '> ' || content,
                               'allowed_mentions', jsonb_build_object('users', jsonb_build_array(mention)));
  end if;

  perform net.http_post(url := hook, body := body,
                        headers := '{"Content-Type": "application/json"}'::jsonb);
  return new;
end;
$$;

revoke all on function notify_waiting() from public, anon, authenticated;

-- solo il passaggio a 'waiting': se era già 'waiting' non riparte. La riga di
-- agent_state esiste sempre (upsert per user_id), quindi basta l'UPDATE.
create trigger discord_waiting_alert
  after update on agent_state
  for each row
  when (new.status = 'waiting' and old.status is distinct from 'waiting')
  execute function notify_waiting();
