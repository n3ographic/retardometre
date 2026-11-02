-- marey_trains : trains d'un axe dont le parcours croise la fenêtre [p_from, p_to], avec tous leurs arrêts (diagramme de Marey).
-- Contrairement à live_trains (3 arrêts, trains en route seulement), on renvoie aussi les trains terminés depuis peu
-- et ceux qui ne sont pas encore partis (horaire seul, sans retard).
-- Un train = un numéro et un jour (vues canonical_*), comme stats_period. Lecture seule, additif.
-- Arrêt = [code UIC (8 derniers caractères du stop_id), arrivée (epoch s), départ (epoch s), retard (s), supprimé]. Le retard d'un arrêt sans valeur reprend
-- celui de l'arrêt précédent connu (même règle que live_trains) ; il est absent tant qu'aucun retard n'est connu.
-- `delay_s` du train = retard publié du dernier arrêt (le terminus), comme live_trains.
create or replace function public.marey_trains(p_axis text, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'service_date', t.service_date, 'brand', t.brand, 'train_number', t.train_number,
      'origin', so.name, 'dest', sd.name, 'cancelled', coalesce(c.cancelled, false),
      'delay_s', c.terminus_delay_s, 'cause', pg_catalog.left(c.cause, 160),
      'comp_pct', coalesce(public.compensation_pct(t.brand, c.terminus_delay_s), 0),
      'last_seen_at', c.last_seen_at, 'stops', st.stops))
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
        case when not e.cancelled then e.known end, e.cancelled) order by e.seq) as stops
    from (
      select s.*, coalesce(s.own, (select x.own from s x where x.seq < s.seq and x.own is not null order by x.seq desc limit 1)) as known
      from s
    ) e
  ) st
  where t.axis = p_axis and t.removed_at is null
    and t.service_date between (p_from at time zone 'Europe/Paris')::date - 1 and (p_to at time zone 'Europe/Paris')::date
    and t.dep_planned <= p_to
    and t.arr_planned + pg_catalog.make_interval(secs => greatest(coalesce(c.terminus_delay_s, 0), 0)) >= p_from
    and st.stops is not null
$$;

grant execute on function public.marey_trains(text, timestamptz, timestamptz) to anon;
