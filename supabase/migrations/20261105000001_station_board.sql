-- Panneau gare de l'accueil (?gare=UIC[,UIC]) : tableau des départs et arrivées d'une gare (ou des gares d'une ville), en un appel.
-- Renvoie un objet :
--   gares        : [uic, nom, lat, lon] par gare demandée (moyenne des points d'arrêt de même code UIC) ;
--   today_trains : nombre de trains (numéros distincts) qui la desservent aujourd'hui (Paris) ;
--   reg          : { n, ok } régularité officielle sur les 7 jours terminés, au terminus, des trains qui la desservent aujourd'hui
--                  (même règle que les statistiques : non supprimé, retard lisible, seuil selon la durée du trajet) ;
--   rows         : passages dont l'heure estimée (prévue + retard publié ou reporté) tombe entre maintenant - 30 min et
--                  maintenant + 3 h : train, marque, axe, horaires prévus à la gare, retard (s), supprimé (train ou arrêt),
--                  origine, destination, premier et dernier arrêt (départ seul, arrivée seule).
-- Le retard d'un arrêt sans valeur reprend celui de l'arrêt précédent connu, comme live_trains. stop_times_planned ne
-- garde qu'hier et les jours suivants : la fenêtre n'en demande pas plus. Lecture seule, additif, en security invoker.

create or replace function public.station_board(p_uics text[], p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with today as (select (p_now at time zone 'Europe/Paris')::date as d),
  st as (
    select s.stop_id, pg_catalog.right(s.stop_id, 8) as uic, s.name, s.lat, s.lon
    from public.stops s
    where pg_catalog.right(s.stop_id, 8) = any(p_uics[1:8])
  ),
  calls as (
    select p.service_date, p.trip_id, p.stop_sequence as seq, p.arr_planned, p.dep_planned, st.uic
    from public.stop_times_planned p
    join st on st.stop_id = p.stop_id
    where p.service_date between (select d from today) - 1 and (select d from today)
  ),
  board as (
    select k.*, t.train_number, t.brand, t.axis, so.name as origin, sd.name as dest,
      k.seq = (select pg_catalog.min(q.stop_sequence) from public.stop_times_planned q where q.service_date = k.service_date and q.trip_id = k.trip_id) as first,
      k.seq = (select pg_catalog.max(q.stop_sequence) from public.stop_times_planned q where q.service_date = k.service_date and q.trip_id = k.trip_id) as last,
      coalesce(c.cancelled, false) or coalesce(c.stop_delays -> k.seq::text = '"cancelled"'::jsonb, false) as cancelled,
      (select d.value::numeric::int from pg_catalog.jsonb_each(c.stop_delays) d
        where pg_catalog.jsonb_typeof(d.value) = 'number' and d.key ~ '^[0-9]{1,9}$' and d.key::int <= k.seq
        order by d.key::int desc limit 1) as delay_s
    from calls k
    join public.trips_planned t on t.service_date = k.service_date and t.trip_id = k.trip_id and t.removed_at is null
    left join public.circulations c on c.service_date = k.service_date and c.trip_id = k.trip_id
    left join public.stops so on so.stop_id = t.origin_stop_id
    left join public.stops sd on sd.stop_id = t.dest_stop_id
  ),
  served as (select distinct b.train_number from board b where b.service_date = (select d from today)),
  reg as (
    select pg_catalog.count(*) as n,
      pg_catalog.count(*) filter (where c.terminus_delay_s < public.regularity_max_delay_s(extract(epoch from (tp.arr_planned - tp.dep_planned))::int)) as ok
    from public.canonical_circulations c
    join public.trips_planned tp on tp.service_date = c.service_date and tp.trip_id = c.trip_id
    where c.service_date between (select d from today) - 7 and (select d from today) - 1
      and c.train_number in (select s.train_number from served s)
      and not c.cancelled and c.terminus_delay_s is not null and c.terminus_delay_s < public.aberrant_delay_s()
  )
  select pg_catalog.jsonb_build_object(
    'gares', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(g.uic, g.nom, g.lat, g.lon) order by g.nom), '[]'::jsonb)
              from (select st.uic, pg_catalog.min(st.name) as nom, pg_catalog.round(pg_catalog.avg(st.lat)::numeric, 4) as lat,
                      pg_catalog.round(pg_catalog.avg(st.lon)::numeric, 4) as lon
                    from st group by st.uic) g),
    'today_trains', (select pg_catalog.count(*) from served),
    'reg', (select pg_catalog.jsonb_build_object('n', r.n, 'ok', r.ok) from reg r),
    'rows', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'trip_id', b.trip_id, 'train_number', b.train_number, 'brand', b.brand, 'axis', b.axis, 'uic', b.uic,
                'arr', b.arr_planned, 'dep', b.dep_planned, 'delay_s', b.delay_s, 'cancelled', b.cancelled,
                'origin', b.origin, 'dest', b.dest, 'first', b.first, 'last', b.last))
              order by coalesce(b.dep_planned, b.arr_planned), b.train_number), '[]'::jsonb)
             from board b
             where coalesce(b.dep_planned, b.arr_planned) + pg_catalog.make_interval(secs => greatest(coalesce(b.delay_s, 0), 0))
               between p_now - interval '30 minutes' and p_now + interval '3 hours')
  )
$$;

grant execute on function public.station_board(text[], timestamptz) to anon;
