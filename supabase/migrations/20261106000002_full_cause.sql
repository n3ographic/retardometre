-- Texte de cause complet dans live_trains et marey_trains : left(c.cause, 160) coupait en plein mot
-- (487 caractères au plus constatés). Le site coupe désormais lui-même en fin de phrase et affiche le reste au clic.
-- Seule la longueur change (160 → 600) ; le reste reprend les définitions en production.
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
