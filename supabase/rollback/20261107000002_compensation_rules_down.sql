-- Retour arrière de 20261107000002_compensation_rules.sql, et sauvegarde de l'état d'avant (exporté de la production
-- le 04/11/2026) : barème compensation_scale à 5 paliers, définitions de compensation_pct(text, int), stats_period,
-- live_trains, marey_trains, train_profile et de la vue circulation_measures.
-- Après exécution : relancer public.snapshot_day(jour) du 20/10 au dernier jour recalculé pour que daily_stats
-- reprenne l'ancien barème (les métriques comp_pct_sum_bon et comp_pct_sum_intl_cap disparaissent alors).

begin;

CREATE OR REPLACE FUNCTION public.compensation_pct(p_brand text, p_delay_s integer)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce((select s.pct from public.compensation_scale s
                   where s.brand = p_brand and s.from_s <= p_delay_s
                   order by s.from_s desc limit 1), 0)
$function$;

create or replace view public.circulation_measures with (security_invoker = true) as
 SELECT c.service_date,
    c.trip_id,
    t.brand,
    t.axis,
    t.train_number,
    c.cancelled,
    EXTRACT(epoch FROM t.arr_planned - t.dep_planned)::integer AS duration_s,
    t.arr_planned,
    c.terminus_delay_s,
    circulation_finished(t.arr_planned, c.terminus_delay_s, c.cancelled, now()) AS finished,
        CASE
            WHEN NOT c.cancelled AND c.terminus_delay_s IS NOT NULL AND c.terminus_delay_s < aberrant_delay_s() THEN c.terminus_delay_s < regularity_max_delay_s(EXTRACT(epoch FROM t.arr_planned - t.dep_planned)::integer)
            ELSE NULL::boolean
        END AS on_time_official,
        CASE
            WHEN NOT c.cancelled AND NOT COALESCE(c.terminus_delay_s >= aberrant_delay_s(), false) THEN delay_bucket(c.terminus_delay_s)
            ELSE NULL::text
        END AS bucket,
        CASE
            WHEN NOT c.cancelled AND c.terminus_delay_s IS NOT NULL AND c.terminus_delay_s < aberrant_delay_s() THEN compensation_pct(t.brand, c.terminus_delay_s)
            ELSE NULL::integer
        END AS comp_pct,
    NOT c.cancelled AND COALESCE(c.terminus_delay_s >= aberrant_delay_s(), false) AS aberrant
   FROM canonical_circulations c
     JOIN trips_planned t ON t.service_date = c.service_date AND t.trip_id = c.trip_id;

CREATE OR REPLACE FUNCTION public.stats_period(p_from date, p_to date, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(brand text, axis text, metric text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with j as (
    select t.brand, t.axis, t.removed_at, c.trip_id is not null as observed, c.cancelled, c.terminus_delay_s, c.stop_delays, c.cause,
      exists (select 1 from jsonb_each(c.stop_delays) e where e.value = '"cancelled"'::jsonb) as skipped,
      tp.trip_id is not null as has_tp, tp.brand as tp_brand,
      (extract(epoch from (tp.arr_planned - tp.dep_planned)))::integer as duration_s
    from public.canonical_trips t
    left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
    left join public.trips_planned tp on tp.service_date = c.service_date and tp.trip_id = c.trip_id
    where t.service_date between p_from and p_to
      and case when c.trip_id is null then coalesce(t.arr_planned + public.finished_margin() < p_now, false)
               else public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now) end
  ), base as (
    select j.brand, j.axis, j.removed_at, j.observed, j.cancelled, j.terminus_delay_s, j.stop_delays, j.cause, j.skipped,
      (j.observed and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()) as circulated,
      (j.observed and not j.cancelled and coalesce(j.terminus_delay_s >= public.aberrant_delay_s(), false)) as aberrant,
      case when j.has_tp and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then j.terminus_delay_s < public.regularity_max_delay_s(j.duration_s) end as on_time_official,
      case when j.has_tp and not j.cancelled and not coalesce(j.terminus_delay_s >= public.aberrant_delay_s(), false)
        then public.delay_bucket(j.terminus_delay_s) end as bucket,
      case when j.has_tp and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then public.compensation_pct(j.tp_brand, j.terminus_delay_s) end as comp_pct,
      case when j.observed and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then public.compensation_pct(j.brand, j.terminus_delay_s + public.delay_tolerance_s()) end as comp_pct_high,
      case when j.observed and not j.cancelled and j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()
        then case when j.skipped then 0
                  else public.compensation_pct(j.brand, greatest(j.terminus_delay_s - public.delay_tolerance_s(), 0)) end end as comp_pct_low
    from j
  ), counts as (
    select b.brand, b.axis,
      count(*) as planned,
      count(*) filter (where b.observed) as observed,
      count(*) filter (where not b.observed and b.removed_at is not null) as removed_late,
      count(*) filter (where not b.observed and b.removed_at is null) as never_observed,
      count(*) filter (where b.observed and b.cancelled) as cancelled,
      count(*) filter (where b.observed and not b.cancelled and b.terminus_delay_s is null) as no_terminus,
      count(*) filter (where b.circulated) as circulated,
      count(*) filter (where b.circulated and b.on_time_official) as on_time_official,
      count(*) filter (where b.circulated and b.comp_pct > 0) as comp_eligible,
      coalesce(sum(b.comp_pct) filter (where b.circulated), 0)::bigint as comp_pct_sum,
      count(*) filter (where b.aberrant) as aberrant,
      count(*) filter (where b.circulated and b.skipped) as skipped_stop,
      coalesce(sum(b.comp_pct_low) filter (where b.circulated), 0)::bigint as comp_pct_sum_low,
      coalesce(sum(b.comp_pct_high) filter (where b.circulated), 0)::bigint as comp_pct_sum_high
    from base b group by b.brand, b.axis
  )
  select g.brand, g.axis, x.metric, x.n from counts g
  cross join lateral (values ('planned', g.planned), ('observed', g.observed), ('removed_late', g.removed_late),
    ('never_observed', g.never_observed), ('cancelled', g.cancelled), ('no_terminus', g.no_terminus),
    ('circulated', g.circulated), ('on_time_official', g.on_time_official), ('comp_eligible', g.comp_eligible),
    ('comp_pct_sum', g.comp_pct_sum), ('aberrant', g.aberrant), ('skipped_stop', g.skipped_stop),
    ('comp_pct_sum_low', g.comp_pct_sum_low), ('comp_pct_sum_high', g.comp_pct_sum_high)) x(metric, n)
  union all
  select b.brand, b.axis, 'terminus:' || b.bucket, count(*) from base b where b.circulated group by b.brand, b.axis, b.bucket
  union all
  select b.brand, b.axis,
    'stop:' || case when jsonb_typeof(s.value) = 'number' then public.delay_bucket(s.value::numeric::int) else 'cancelled' end,
    count(*)
  from base b cross join lateral jsonb_each(b.stop_delays) s
  where b.observed and not b.aberrant and (jsonb_typeof(s.value) = 'number' or s.value = '"cancelled"'::jsonb)
  group by 1, 2, 3
  union all
  select q.brand, q.axis, x.metric, x.n from (
    select b.brand, b.axis, public.cause_category(b.cause) as cat, count(*) as trains,
      sum(b.terminus_delay_s)::bigint as delay_s, coalesce(sum(b.comp_pct), 0)::bigint as comp
    from base b where b.circulated and b.terminus_delay_s >= 300 group by 1, 2, 3
  ) q
  cross join lateral (values ('cause:' || q.cat, q.trains), ('cause_delay_s:' || q.cat, q.delay_s), ('cause_comp:' || q.cat, q.comp)) x(metric, n)
$function$;

CREATE OR REPLACE FUNCTION public.live_trains(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'trip_id', t.trip_id, 'service_date', t.service_date, 'brand', t.brand, 'axis', t.axis,
      'train_number', t.train_number, 'cancelled', c.cancelled,
      'dep_planned', t.dep_planned, 'arr_planned', t.arr_planned,
      'origin', so.name, 'dest', sd.name,
      'delay_s', l.delay_s, 'last_seq', l.seq, 'cause', pg_catalog.left(c.cause, 600),
      'comp_pct', coalesce(public.compensation_pct(t.brand, l.delay_s), 0),
      'last_seen_at', c.last_seen_at, 'stops', st.stops))
    order by t.dep_planned, t.trip_id), '[]'::jsonb)
  from public.canonical_circulations c
  join public.trips_planned t on t.service_date = c.service_date and t.trip_id = c.trip_id
  left join public.stops so on so.stop_id = t.origin_stop_id
  left join public.stops sd on sd.stop_id = t.dest_stop_id
  left join lateral (
    select d.key::int as seq, d.value::numeric::int as delay_s
    from pg_catalog.jsonb_each(c.stop_delays) d
    where pg_catalog.jsonb_typeof(d.value) = 'number' and d.key ~ '^[0-9]{1,9}$'
    order by d.key::int desc limit 1
  ) l on true
  cross join lateral (
    with s as (
      select p.stop_sequence as seq, p.arr_planned, p.dep_planned, g.name, g.lat, g.lon,
        case when pg_catalog.jsonb_typeof(c.stop_delays -> p.stop_sequence::text) = 'number'
             then (c.stop_delays -> p.stop_sequence::text)::numeric::int end as own,
        coalesce(c.stop_delays -> p.stop_sequence::text = '"cancelled"'::jsonb, false) as cancelled
      from public.stop_times_planned p
      left join public.stops g on g.stop_id = p.stop_id
      where p.service_date = c.service_date and p.trip_id = c.trip_id
    ), e as (
      select s.*, coalesce(s.own, (select x.own from s x where x.seq < s.seq and x.own is not null order by x.seq desc limit 1)) as known
      from s
    ), f as (
      select e.*, coalesce(e.dep_planned, e.arr_planned) + pg_catalog.make_interval(secs => greatest(coalesce(e.known, 0), 0)) as eff_dep
      from e
    ), a as (
      select coalesce(max(f.seq) filter (where f.eff_dep <= p_now), min(f.seq)) as seq from f
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'seq', w.seq, 'name', w.name, 'lat', pg_catalog.round(w.lat::numeric, 3), 'lon', pg_catalog.round(w.lon::numeric, 3),
        'arr', w.arr_planned, 'dep', w.dep_planned,
        'delay_s', case when not w.cancelled then w.known end,
        'cancelled', case when w.cancelled then true end)) order by w.seq), '[]'::jsonb) as stops
    from (select f.* from f cross join a where f.seq >= a.seq order by f.seq limit 3) w
  ) st
  where c.service_date >= (p_now at time zone 'Europe/Paris')::date - 1
    and not public.circulation_finished(t.arr_planned, c.terminus_delay_s, false, p_now)
$function$;

CREATE OR REPLACE FUNCTION public.marey_trains(p_axis text, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'service_date', t.service_date, 'brand', t.brand, 'train_number', t.train_number,
      'origin', so.name, 'dest', sd.name, 'cancelled', coalesce(c.cancelled, false),
      'delay_s', c.terminus_delay_s, 'cause', pg_catalog.left(c.cause, 600),
      'cause_cat', case when c.trip_id is not null then public.cause_category(c.cause) end,
      'comp_pct', coalesce(public.compensation_pct(t.brand, c.terminus_delay_s), 0),
      'last_seen_at', c.last_seen_at, 'stops', st.stops, 'hist', h.hist))
    order by t.dep_planned, t.trip_id), '[]'::jsonb)
  from public.canonical_trips t
  left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
  left join public.stops so on so.stop_id = t.origin_stop_id
  left join public.stops sd on sd.stop_id = t.dest_stop_id
  cross join lateral (
    with s as (
      select p.stop_sequence as seq, p.stop_id, p.arr_planned, p.dep_planned,
        case when pg_catalog.jsonb_typeof(c.stop_delays -> p.stop_sequence::text) = 'number'
             then (c.stop_delays -> p.stop_sequence::text)::numeric::int end as own,
        coalesce(c.stop_delays -> p.stop_sequence::text = '"cancelled"'::jsonb, false) as cancelled
      from public.stop_times_planned p
      where p.service_date = t.service_date and p.trip_id = t.trip_id
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        pg_catalog.right(e.stop_id, 8), pg_catalog.date_part('epoch', coalesce(e.arr_planned, e.dep_planned))::bigint,
        pg_catalog.date_part('epoch', coalesce(e.dep_planned, e.arr_planned))::bigint,
        case when not e.cancelled then e.known end, e.cancelled, e.seq) order by e.seq) as stops
    from (
      select s.*, coalesce(s.own, (select x.own from s x where x.seq < s.seq and x.own is not null order by x.seq desc limit 1)) as known
      from s
    ) e
  ) st
  left join lateral (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        pg_catalog.date_part('epoch', ev.observed_at)::bigint, ev.stop_sequence, (ev.value ->> 'delay_s')::int)
      order by ev.observed_at, ev.stop_sequence) as hist
    from public.events ev
    where ev.service_date = c.service_date and ev.trip_id = c.trip_id and ev.kind = 'delay' and ev.value ? 'delay_s'
  ) h on true
  where t.axis = p_axis and t.removed_at is null
    and p_to - p_from <= interval '12 hours'
    and t.service_date between (p_from at time zone 'Europe/Paris')::date - 1 and (p_to at time zone 'Europe/Paris')::date
    and t.dep_planned <= p_to
    and t.arr_planned + pg_catalog.make_interval(secs => greatest(coalesce(c.terminus_delay_s, 0), 0)) >= p_from
    and st.stops is not null
$function$;

CREATE OR REPLACE FUNCTION public.train_profile(p_number text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

drop function public.compensation_form(text, int, boolean);
drop function public.compensation_pct(text, int, boolean);
drop function public.compensation_step(text, int, boolean);
drop function public.is_international(text, text);

delete from public.compensation_scale;
alter table public.compensation_scale drop constraint compensation_scale_pkey;
alter table public.compensation_scale drop column scope, drop column form;
alter table public.compensation_scale add primary key (brand, from_s);
insert into public.compensation_scale (brand, from_s, pct, source_url, source_as_of, note) values
  ('INOUI', 1860, 25, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/', '2026-06-17', 'plus de 30 min (minutes entières, 31 min et plus)'),
  ('INOUI', 7200, 50, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/', '2026-06-17', 'de 2 h à 3 h'),
  ('INOUI', 10860, 75, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/tgv-inoui-intercites/', '2026-06-17', 'au-delà de 3 h (3 h 01 et plus)'),
  ('OUIGO', 3600, 25, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/ouigo/', '2026-09-04', 'de 1 h à 1 h 59'),
  ('OUIGO', 7200, 50, 'https://www.sncf-voyageurs.com/fr/contactez-nous/en-cas-de-retard/ouigo/', '2026-09-04', '2 h et plus');

commit;
