-- Fiche par train (/train/XXXX) : tout l'historique d'un numéro de train depuis le début de la collecte, en un appel.
-- Renvoie un objet :
--   info  : marque, axe, origine, destination, horaires prévus de la circulation la plus récente (aujourd'hui ou avant) ;
--   today : circulation du jour (Paris) si elle est prévue : retard publié, supprimé, dernier passage du collecteur ;
--   days  : [date, observé, supprimé, retard au terminus (s, null si absent ou ≥ 12 h), catégorie de cause, % d'indemnité]
--           pour chaque jour prévu jusqu'à aujourd'hui ; non observé = prévu mais jamais vu par le collecteur ;
--   stops : [uic, nom, retard moyen publié (s), jours mesurés] gare par gare, dans l'ordre du dernier horaire connu ;
--   axis  : [numéro, jours observés, jours à l'heure (< 5 min, non supprimé)] pour chaque train de son axe.
-- « Où il perd du temps » : stop_times_planned n'est gardé que quelques jours, mais stop_delays est indexé par numéro
-- d'arrêt. On reprend les numéros d'arrêt du dernier horaire connu du train, et seulement les jours dont tous les numéros
-- d'arrêt y figurent (itinéraire supposé identique ; un arrêt ajouté en milieu de parcours décalerait les numéros).
-- Retards ≥ 12 h écartés comme dans les mesures (métrique aberrant). Lecture seule, additif, en security invoker :
-- toutes les vues lues sont déjà publiques.

create or replace function public.train_profile(p_number text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with today as (select (pg_catalog.now() at time zone 'Europe/Paris')::date as d),
  tr as (
    select t.service_date, t.trip_id, t.brand, t.axis, t.origin_stop_id, t.dest_stop_id, t.dep_planned, t.arr_planned,
      c.trip_id as c_trip, coalesce(c.cancelled, false) as cancelled, c.stop_delays, c.cause, c.last_seen_at,
      case when c.terminus_delay_s < 43200 then c.terminus_delay_s end as delay_s
    from public.canonical_trips t
    left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
    where p_number ~ '^\d{1,5}$' and t.train_number = p_number and t.removed_at is null
      and t.service_date <= (select d from today)
  ),
  last as (select * from tr order by service_date desc limit 1),
  ref as (
    select p.stop_sequence as seq, pg_catalog.right(p.stop_id, 8) as uic, s.name
    from public.stop_times_planned p
    left join public.stops s on s.stop_id = p.stop_id
    where (p.service_date, p.trip_id) = (
      select tr.service_date, tr.trip_id from tr
      where exists (select 1 from public.stop_times_planned q where q.service_date = tr.service_date and q.trip_id = tr.trip_id)
      order by tr.service_date desc limit 1)
  ),
  same_route as (
    select tr.stop_delays from tr
    where tr.c_trip is not null and not tr.cancelled and tr.stop_delays is not null
      and not exists (select 1 from pg_catalog.jsonb_object_keys(tr.stop_delays) k where k::int not in (select seq from ref))
  )
  select case when not exists (select 1 from tr) then null else pg_catalog.jsonb_build_object(
    'info', (select pg_catalog.jsonb_build_object('brand', l.brand, 'axis', l.axis, 'origin', so.name, 'dest', sd.name,
                'dep_planned', l.dep_planned, 'arr_planned', l.arr_planned)
             from last l left join public.stops so on so.stop_id = l.origin_stop_id left join public.stops sd on sd.stop_id = l.dest_stop_id),
    'today', (select pg_catalog.jsonb_build_object('date', l.service_date, 'observed', l.c_trip is not null, 'cancelled', l.cancelled,
                'delay_s', l.delay_s, 'last_seen_at', l.last_seen_at)
              from last l where l.service_date = (select d from today)),
    'days', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(tr.service_date, tr.c_trip is not null, tr.cancelled, tr.delay_s,
                case when tr.c_trip is not null then public.cause_category(tr.cause) end,
                coalesce(public.compensation_pct(tr.brand, tr.delay_s), 0)) order by tr.service_date)
             from tr),
    'stops', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(r.uic, r.name, x.avg_s, x.n) order by r.seq), '[]'::jsonb)
              from ref r cross join lateral (
                select pg_catalog.round(pg_catalog.avg((d.stop_delays ->> r.seq::text)::numeric))::int as avg_s, pg_catalog.count(*) as n
                from same_route d
                where pg_catalog.jsonb_typeof(d.stop_delays -> r.seq::text) = 'number' and (d.stop_delays ->> r.seq::text)::numeric < 43200
              ) x),
    'axis', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(a.train_number, a.n, a.ok)), '[]'::jsonb)
             from (
               select c.train_number, pg_catalog.count(*) as n,
                 pg_catalog.count(*) filter (where not c.cancelled and coalesce(c.terminus_delay_s, 0) < 300) as ok
               from public.canonical_circulations c
               where c.axis = (select axis from last) and c.service_date <= (select d from today)
                 and (c.terminus_delay_s is null or c.terminus_delay_s < 43200)
               group by c.train_number
             ) a)
  ) end
$$;

grant execute on function public.train_profile(text) to anon;
