-- Task 10 passo 1: cloni e mini-Ultron della Baracca letti da Supabase.
-- Senza la publication Supabase risponde SUBSCRIBED ma non emette mai
-- postgres_changes; replica identity full serve per valutare la RLS sulla riga.
alter publication supabase_realtime add table sessions, subagents;
alter table sessions replica identity full;
alter table subagents replica identity full;
