-- Train de la semaine : « à l'heure » suit la règle de la régularité (regularity_max_delay_s : moins de 5, 10 ou 15 min
-- selon la durée prévue du trajet) au lieu d'un seuil fixe de 5 min. Le seuil du jour est ajouté en 5e valeur de
-- train.days, pour que la page écrive le même seuil.
-- Effet avec les données du 06/11 : S43 5300 → 6258, S44 9255 → 8308 (9255, Paris-Milan, passe de 0 à 2 jours à l'heure sur 7).
-- Après application : select public.snapshot_week('2026-10-19'), public.snapshot_week('2026-10-26');
-- Retour arrière : supabase/rollback/20261110000001_weekly_train_regularity_down.sql
create or replace function public.weekly_report(p_monday date, p_now timestamptz default now()) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with span as (
    select greatest(p_monday, date '2026-10-20') as first_day, p_monday + 6 as last_day
  ), circ as (
    -- Une circulation par train et par jour, terminée, comme dans stats_period.
    select t.service_date, t.train_number, t.brand, t.axis, t.origin_stop_id, t.dest_stop_id,
      coalesce(c.arr_planned, t.arr_planned) as arr_planned, c.trip_id is not null as observed, c.cancelled,
      case when c.terminus_delay_s < public.aberrant_delay_s() then c.terminus_delay_s end as delay_s,
      public.regularity_max_delay_s(extract(epoch from t.arr_planned - t.dep_planned)::int) as max_delay_s
    from public.canonical_trips t
    left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
    cross join span
    where t.service_date between span.first_day and span.last_day
      and case when c.trip_id is null then coalesce(t.arr_planned + public.finished_margin() < p_now, false)
               else public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now) end
  ), per_train as (
    -- Un jour compte s'il est supprimé ou mesuré ; à l'heure selon la règle de la régularité.
    select train_number,
      count(*) filter (where observed and (cancelled or delay_s is not null)) as counted,
      count(*) filter (where observed and not cancelled and delay_s < max_delay_s) as ok,
      coalesce(sum(greatest(delay_s, 0)) filter (where observed and not cancelled), 0) as delay_sum_s
    from circ group by train_number
  ), worst as (
    select * from per_train where counted >= 4
    order by ok::numeric / counted, delay_sum_s desc, train_number limit 1
  )
  select jsonb_build_object(
    'from', (select first_day from span), 'to', (select last_day from span), 'monday', p_monday,
    'days', (select last_day - first_day + 1 from span),
    -- [marque, axe, métrique, n] de toute la semaine : entrée de shapeStats.
    'stats', (select jsonb_agg(jsonb_build_array(s.brand, s.axis, s.metric, s.n))
              from span, public.stats_period(span.first_day, span.last_day, p_now) s),
    -- Par jour, toutes marques et axes confondus, sans les tranches de retard.
    'by_day', (select jsonb_agg(jsonb_build_object('date', d, 'm', (
                 select jsonb_object_agg(x.metric, x.n) from (
                   select s.metric, sum(s.n) as n from public.stats_period(d, d, p_now) s
                   where s.metric not like 'stop:%' and s.metric not like 'terminus:%' group by s.metric) x)) order by d)
               from span, generate_series(span.first_day, span.last_day, interval '1 day') g(ts), lateral (select g.ts::date as d) dd),
    'prices', (select jsonb_agg(to_jsonb(p) - 'note') from public.reference_prices p),
    'scale', (select jsonb_agg(to_jsonb(s) - 'note') from public.compensation_scale s),
    -- Le train le moins fiable de la semaine (au moins 4 jours comptés), avec sa bande jour par jour.
    'train', (select jsonb_build_object(
                'number', w.train_number, 'counted', w.counted, 'ok', w.ok, 'delay_sum_s', w.delay_sum_s,
                'brand', i.brand, 'axis', i.axis, 'origin', so.name, 'dest', sd.name,
                'days', (select jsonb_agg(jsonb_build_array(c.service_date, c.observed, c.cancelled, c.delay_s, c.max_delay_s) order by c.service_date)
                         from circ c where c.train_number = w.train_number))
              from worst w
              cross join lateral (select * from circ c where c.train_number = w.train_number order by c.service_date desc limit 1) i
              left join public.stops so on so.stop_id = i.origin_stop_id
              left join public.stops sd on sd.stop_id = i.dest_stop_id),
    -- [jour ISO 1-7, heure d'arrivée prévue à Paris, trains, retard moyen au terminus (s)] des trains qui ont roulé.
    'heatmap', (select jsonb_agg(jsonb_build_array(h.dow, h.hour, h.n, h.avg_s) order by h.dow, h.hour) from (
                  select extract(isodow from service_date)::int as dow,
                    extract(hour from arr_planned at time zone 'Europe/Paris')::int as hour,
                    count(*) as n, round(avg(greatest(delay_s, 0)))::int as avg_s
                  from circ where observed and not cancelled and delay_s is not null group by 1, 2) h)
  )
$$;
