-- Suivre un train en Web Push (spec : docs/superpowers/specs/2026-11-06-train-push-design.md).
-- Un suivi = un abonnement push du navigateur, un train, un jour, une gare (terminus par défaut). Effacé à l'arrivée,
-- à la suppression du train ou après 48 h (cron de 20261111000002_notify_cron.sql).
-- Le site écrit par follow_add / follow_set_stop / follow_remove (clé anon) ; la table reste illisible pour anon.
-- La fonction notify (service) lit follow_states et met à jour last_step.
-- Retour arrière : supabase/rollback/20261111000001_train_follows_down.sql
begin;

create table public.train_follows (
  id bigint generated always as identity primary key,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  service_date date not null,
  train_number text not null,
  stop_sequence int not null,
  last_step int not null default 0,   -- dernier palier de retard notifié, en minutes (0, 5, 15, 30, 60, 120)
  created_at timestamptz not null default now(),
  last_error text,
  unique (endpoint, service_date, train_number)
);
alter table public.train_follows enable row level security;
revoke all on public.train_follows from anon, authenticated;

-- Adresse d'envoi d'un service de push connu (Google, Apple, Mozilla, Microsoft) : rien d'autre ne recevra de requête.
create function public.follow_endpoint_ok(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.length(p) <= 1000 and p ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)/', false)
$$;

-- Circulation suivable d'un numéro : jour de service d'aujourd'hui ou d'hier (heure de Paris, trains de nuit),
-- prévue, non supprimée, non terminée ; la plus récente.
create function public.follow_trip(p_number text, p_now timestamptz)
returns table (service_date date, trip_id text, stop_delays jsonb)
language sql stable set search_path = '' as $$
  select t.service_date, coalesce(c.trip_id, t.trip_id), c.stop_delays
  from public.canonical_trips t
  left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
  where p_number ~ '^\d{1,5}$' and t.train_number = p_number and t.removed_at is null
    and t.service_date between (p_now at time zone 'Europe/Paris')::date - 1 and (p_now at time zone 'Europe/Paris')::date
    and not public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now)
  order by t.service_date desc limit 1
$$;

-- Arrêts d'un trajet avec le retard connu : celui de l'arrêt, sinon le dernier connu avant lui (comme live_trains).
create function public.follow_stops(p_service_date date, p_trip_id text, p_delays jsonb)
returns table (seq int, name text, arr timestamptz, known int, cancelled boolean)
language sql stable set search_path = '' as $$
  with s as (
    select p.stop_sequence as seq, g.name, coalesce(p.arr_planned, p.dep_planned) as arr,
      case when pg_catalog.jsonb_typeof(p_delays -> p.stop_sequence::text) = 'number'
           then (p_delays -> p.stop_sequence::text)::numeric::int end as own,
      coalesce(p_delays -> p.stop_sequence::text = '"cancelled"'::jsonb, false) as cancelled
    from public.stop_times_planned p
    left join public.stops g on g.stop_id = p.stop_id
    where p.service_date = p_service_date and p.trip_id = p_trip_id
  )
  select s.seq, s.name, s.arr,
    coalesce(s.own, (select x.own from s x where x.seq < s.seq and x.own is not null order by x.seq desc limit 1)),
    s.cancelled
  from s order by s.seq
$$;

-- Arrêts encore à venir, pour le menu « CHANGER » : [seq, nom].
create function public.follow_upcoming(p_service_date date, p_trip_id text, p_delays jsonb, p_now timestamptz) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(s.seq, s.name) order by s.seq), '[]'::jsonb)
  from public.follow_stops(p_service_date, p_trip_id, p_delays) s
  where not s.cancelled and s.arr + pg_catalog.make_interval(secs => greatest(coalesce(s.known, 0), 0)) > p_now
$$;

-- Suivre un train jusqu'à son terminus ; renvoie le jour, la gare suivie et les arrêts à venir.
-- Erreurs : 22023 abonnement invalide, P0002 train introuvable ou terminé, 54000 plus de 10 suivis.
create function public.follow_add(p_endpoint text, p_p256dh text, p_auth text, p_number text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  v_last int;
  v_seq int;
begin
  if not public.follow_endpoint_ok(p_endpoint) or coalesce(pg_catalog.length(p_p256dh), 0) not between 20 and 200
     or coalesce(pg_catalog.length(p_auth), 0) not between 8 and 100 then
    raise exception 'abonnement invalide' using errcode = '22023';
  end if;
  select * into v from public.follow_trip(p_number, now());
  if not found then raise exception 'train introuvable ou terminé' using errcode = 'P0002'; end if;
  select max(p.stop_sequence) into v_last from public.stop_times_planned p
    where p.service_date = v.service_date and p.trip_id = v.trip_id;
  if v_last is null then raise exception 'train introuvable ou terminé' using errcode = 'P0002'; end if;
  if (select count(*) from public.train_follows f
      where f.endpoint = p_endpoint and (f.service_date, f.train_number) <> (v.service_date, p_number)) >= 10 then
    raise exception 'trop de suivis' using errcode = '54000';
  end if;
  insert into public.train_follows (endpoint, p256dh, auth, service_date, train_number, stop_sequence)
    values (p_endpoint, p_p256dh, p_auth, v.service_date, p_number, v_last)
  on conflict (endpoint, service_date, train_number) do update set p256dh = excluded.p256dh, auth = excluded.auth
  returning stop_sequence into v_seq;
  return pg_catalog.jsonb_build_object('service_date', v.service_date, 'stop_sequence', v_seq,
    'stops', public.follow_upcoming(v.service_date, v.trip_id, v.stop_delays, now()));
end
$$;

-- Changer la gare suivie : un arrêt non supprimé du trajet suivi.
create function public.follow_set_stop(p_endpoint text, p_number text, p_seq int) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from public.follow_trip(p_number, now());
  if not found or not exists (
    select 1 from public.follow_stops(v.service_date, v.trip_id, v.stop_delays) s where s.seq = p_seq and not s.cancelled) then
    raise exception 'gare hors parcours' using errcode = '22023';
  end if;
  update public.train_follows f set stop_sequence = p_seq, last_step = 0
    where f.endpoint = p_endpoint and f.service_date = v.service_date and f.train_number = p_number;
  return found;
end
$$;

-- Arrêter le suivi d'un numéro (tous jours confondus) pour cet abonnement.
create function public.follow_remove(p_endpoint text, p_number text) returns boolean
language sql volatile security definer set search_path = '' as $$
  with d as (delete from public.train_follows f where f.endpoint = p_endpoint and f.train_number = p_number returning 1)
  select exists (select 1 from d)
$$;

-- État courant de chaque suivi, pour notify : retard connu à la gare suivie, suppressions, arrivée (heure prévue à la gare
-- + retard + 5 min dépassée, train observé seulement), indemnité au barème du train.
create function public.follow_states(p_now timestamptz default now())
returns table (id bigint, endpoint text, p256dh text, auth text, train_number text, brand text, stop_name text,
  is_terminus boolean, last_step int, delay_s int, cancelled boolean, stop_cancelled boolean, arrived boolean,
  comp_pct int, comp_form text)
language sql stable security definer set search_path = '' as $$
  select f.id, f.endpoint, f.p256dh, f.auth, f.train_number, t.brand, s.name,
    s.seq = (select max(p.stop_sequence) from public.stop_times_planned p
             where p.service_date = f.service_date and p.trip_id = coalesce(c.trip_id, t.trip_id)),
    f.last_step, s.known, coalesce(c.cancelled, false), s.cancelled,
    c.trip_id is not null and s.arr + pg_catalog.make_interval(secs => greatest(coalesce(s.known, 0), 0)) + interval '5 minutes' < p_now,
    public.compensation_pct(t.brand, s.known, public.is_international(t.origin_stop_id, t.dest_stop_id)),
    public.compensation_form(t.brand, s.known, public.is_international(t.origin_stop_id, t.dest_stop_id))
  from public.train_follows f
  join public.canonical_trips t on t.service_date = f.service_date and t.train_number = f.train_number
  left join public.canonical_circulations c on c.service_date = f.service_date and c.train_number = f.train_number
  cross join lateral (
    select * from public.follow_stops(f.service_date, coalesce(c.trip_id, t.trip_id), c.stop_delays) x where x.seq = f.stop_sequence
  ) s
$$;

revoke execute on function public.follow_endpoint_ok(text), public.follow_trip(text, timestamptz),
  public.follow_stops(date, text, jsonb), public.follow_upcoming(date, text, jsonb, timestamptz),
  public.follow_states(timestamptz) from public, anon, authenticated;
grant execute on function public.follow_states(timestamptz) to service_role;
revoke execute on function public.follow_add(text, text, text, text), public.follow_set_stop(text, text, int),
  public.follow_remove(text, text) from public, authenticated;
grant execute on function public.follow_add(text, text, text, text), public.follow_set_stop(text, text, int),
  public.follow_remove(text, text) to anon;

commit;
