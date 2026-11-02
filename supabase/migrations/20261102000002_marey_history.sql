-- marey_trains v2 : ajoute l'historique du retard publié de chaque train (vue F3 MAREY, ligne pleine reconstituée).
-- Source : le journal events, qui enregistre chaque changement du retard publié, arrêt par arrêt, à chaque collecte
-- (toutes les 2 min) ; purge seulement des mois exportés, après 30 jours. Pas de nouvelle table ni de nouvelle collecte.
-- events n'est pas lisible par anon : la fonction passe en security definer, ne renvoie que des retards agrégés par train
-- de la fenêtre demandée, et refuse une fenêtre de plus de 12 h (charge bornée).
-- Additif : mêmes clés qu'avant, plus `hist` par train et le numéro d'arrêt en 6e position de chaque arrêt.
-- Arrêt = [code UIC, arrivée (epoch s), départ (epoch s), retard (s) ou null, supprimé, stop_sequence].
-- hist = [[heure de collecte (epoch s), stop_sequence, retard publié (s)], ...] trié par heure.

create index if not exists events_trip_idx on public.events (service_date, trip_id, observed_at);

create or replace function public.marey_trains(p_axis text, p_from timestamptz, p_to timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'service_date', t.service_date, 'brand', t.brand, 'train_number', t.train_number,
      'origin', so.name, 'dest', sd.name, 'cancelled', coalesce(c.cancelled, false),
      'delay_s', c.terminus_delay_s, 'cause', pg_catalog.left(c.cause, 160),
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
$$;

revoke execute on function public.marey_trains(text, timestamptz, timestamptz) from public;
grant execute on function public.marey_trains(text, timestamptz, timestamptz) to anon;
