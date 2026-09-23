-- farm/supabase/migrations/004_discord_waiting_alert.sql
-- Avviso Discord quando Ultron aspetta una decisione (missione "Supabase nella
-- Baracca", Passo 2). Scatta sul database, non sul Mac: vale per qualunque
-- sessione metta agent_state a 'waiting'. L'URL del webhook sta nel Vault di
-- Supabase col nome 'discord_webhook_baracca' (lo inserisce Vincent, mai nel
-- repo): senza quel segreto la funzione non fa niente.

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
    body := jsonb_build_object('content',
      'Ultron ti aspetta nella Baracca — ' || to_char(now() at time zone 'Europe/Rome', 'HH24:MI')),
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
