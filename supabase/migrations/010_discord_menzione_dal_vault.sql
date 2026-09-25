-- farm/supabase/migrations/010_discord_menzione_dal_vault.sql
-- L'id Discord da menzionare nell'avviso "Ultron ti aspetta" (migrazione 005)
-- era scritto nella funzione, quindi nel repo. Ora sta nel Vault di Supabase
-- come il webhook, col nome 'discord_user_id'. PRIMA di applicare questa
-- migrazione, dall'editor SQL (mai nel repo):
--
--   select vault.create_secret('<il tuo id Discord>', 'discord_user_id');
--
-- Senza quel segreto (o con un valore che non è un id numerico) il messaggio
-- parte lo stesso ma senza menzione, come nella 004: in un canale di server
-- non suona. Cambia solo il corpo della funzione: trigger, tetto e webhook
-- restano quelli della 004.

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
