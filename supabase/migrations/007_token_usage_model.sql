-- Costo in euro (miglioria 2): per stimare quanto costerebbe a listino API serve
-- sapere il MODELLO di ogni riga e quanta scrittura in cache è a 1 ora (costa
-- 1,6 volte quella a 5 minuti; in Claude Code è circa il 94% delle scritture).
-- Le righe vecchie restano con model = 'unknown' e cache_write_1h = 0: il
-- pannello le mostra come costo "n/d", mai con un prezzo inventato.
-- Tutto in una transazione: la funzione vecchia sparisce e la nuova compare
-- insieme, quindi nessun hook trova un buco. I parametri nuovi hanno un default,
-- così anche un hook non ancora aggiornato continua a funzionare.
begin;

alter table token_usage add column model text not null default 'unknown';
alter table token_usage add column cache_write_1h bigint not null default 0;
alter table token_usage drop constraint token_usage_pkey;
alter table token_usage add primary key (user_id, day, room, model);

drop function increment_token_usage(uuid, date, text, bigint, bigint, bigint, bigint);
create function increment_token_usage(
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

commit;
