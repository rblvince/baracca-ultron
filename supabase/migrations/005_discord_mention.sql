-- farm/supabase/migrations/005_discord_mention.sql
-- L'avviso della 004 arrivava (Discord 204) ma non suonava: in un canale di
-- server il default è "solo @menzioni". Ora il messaggio menziona Vincent, e
-- allowed_mentions limita il ping a lui solo. Cambia solo il corpo della
-- funzione: trigger, tetto e segreto restano quelli della 004.

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
