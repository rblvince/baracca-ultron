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
  unique (user_id, transcript_path)
);

create table subagents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  room text not null,
  agent text,
  task text,
  created_at timestamptz not null default now()
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

create policy "solo il proprietario" on agent_state for all using (auth.uid() = user_id);
create policy "solo il proprietario" on sessions for all using (auth.uid() = user_id);
create policy "solo il proprietario" on subagents for all using (auth.uid() = user_id);
create policy "solo il proprietario" on token_usage for all using (auth.uid() = user_id);
