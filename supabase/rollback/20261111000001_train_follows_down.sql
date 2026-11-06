-- Retour arrière de 20261111000001_train_follows.sql (après celui de 20261111000002_notify_cron.sql).
begin;
drop function if exists public.follow_states(timestamptz);
drop function if exists public.follow_remove(text, text);
drop function if exists public.follow_set_stop(text, text, int);
drop function if exists public.follow_add(text, text, text, text);
drop function if exists public.follow_upcoming(date, text, jsonb, timestamptz);
drop function if exists public.follow_stops(date, text, jsonb);
drop function if exists public.follow_trip(text, timestamptz);
drop function if exists public.follow_endpoint_ok(text);
drop table if exists public.train_follows;
commit;
