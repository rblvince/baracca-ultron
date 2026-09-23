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
  input bigint not null default 0,
  output bigint not null default 0,
  cache_read bigint not null default 0,
  cache_write bigint not null default 0,
  primary key (user_id, day, room)
);

-- upsert incrementale: PostgREST non sa fare "upsert che somma", serve una funzione
create or replace function increment_token_usage(
  p_user_id uuid, p_day date, p_room text,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint
) returns void as $$
  insert into token_usage (user_id, day, room, input, output, cache_read, cache_write)
  values (p_user_id, p_day, p_room, p_input, p_output, p_cache_read, p_cache_write)
  on conflict (user_id, day, room) do update set
    input = token_usage.input + excluded.input,
    output = token_usage.output + excluded.output,
    cache_read = token_usage.cache_read + excluded.cache_read,
    cache_write = token_usage.cache_write + excluded.cache_write;
$$ language sql;

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

-- avviso Discord su waiting (migrazione 004): segreto discord_webhook_baracca nel Vault
create extension if not exists pg_net;

-- tetto: al massimo un messaggio ogni 5 minuti per utente. RLS attiva e
-- nessuna policy: dal browser non si legge né si scrive.
create table alert_throttle (
  user_id uuid primary key references auth.users(id),
  last_sent timestamptz not null
);
alter table alert_throttle enable row level security;

create or replace function notify_waiting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  hook text;
  allowed boolean;
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

  perform net.http_post(
    url := hook,
    body := jsonb_build_object(
      'content', '<@727203879971979357> Ultron ti aspetta nella Baracca — '
                 || to_char(now() at time zone 'Europe/Rome', 'HH24:MI'),
      'allowed_mentions', jsonb_build_object('users', jsonb_build_array('727203879971979357'))),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
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
