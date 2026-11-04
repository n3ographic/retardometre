-- Correctif de 20261107000002_compensation_rules.sql : stats_period appelait compensation_pct / compensation_form
-- (fonctions SQL non dépliables) jusqu'à 6 fois par train ; 6,2 s pour 7 jours en anon, au-delà du délai de l'API
-- (/api/stats en 502). Ici le barème est lu une fois (CTE de 9 lignes) et chaque palier par une jointure latérale :
-- 312 ms pour 31 jours. Résultat identique ligne à ligne (vérifié sur la semaine du 26/10 au 01/11 : 487 lignes, 0 écart).
create or replace function public.stats_period(p_from date, p_to date, p_now timestamptz default now())
returns table(brand text, axis text, metric text, n bigint)
language sql stable set search_path = '' as $$
  with sc as materialized (
    select s.brand, s.scope, s.from_s, s.pct, s.form from public.compensation_scale s
  ), ib as (
    select distinct sc.brand from sc where sc.scope = 'international'
  ), j as (
    select t.brand, t.axis, t.removed_at, c.trip_id is not null as observed, c.cancelled, c.terminus_delay_s, c.stop_delays, c.cause,
      exists (select 1 from jsonb_each(c.stop_delays) e where e.value = '"cancelled"'::jsonb) as skipped,
      tp.trip_id is not null as has_tp, tp.brand as tp_brand,
      (extract(epoch from (tp.arr_planned - tp.dep_planned)))::integer as duration_s,
      public.is_international(t.origin_stop_id, t.dest_stop_id) as intl
    from public.canonical_trips t
    left join public.canonical_circulations c on c.service_date = t.service_date and c.train_number = t.train_number
    left join public.trips_planned tp on tp.service_date = c.service_date and tp.trip_id = c.trip_id
    where t.service_date between p_from and p_to
      and case when c.trip_id is null then coalesce(t.arr_planned + public.finished_margin() < p_now, false)
               else public.circulation_finished(coalesce(c.arr_planned, t.arr_planned), c.terminus_delay_s, c.cancelled, p_now) end
  ), k as (
    -- Barème du train : international si la marque en a un, sinon national (comme compensation_step).
    select j.*,
      case when j.intl and j.tp_brand in (select ib.brand from ib) then 'international' else 'national' end as tp_scope,
      case when j.intl and j.brand in (select ib.brand from ib) then 'international' else 'national' end as b_scope,
      (j.terminus_delay_s is not null and j.terminus_delay_s < public.aberrant_delay_s()) as measured
    from j
  ), base as (
    select k.brand, k.axis, k.removed_at, k.observed, k.cancelled, k.terminus_delay_s, k.stop_delays, k.cause, k.skipped,
      (k.observed and not k.cancelled and k.measured) as circulated,
      (k.observed and not k.cancelled and coalesce(k.terminus_delay_s >= public.aberrant_delay_s(), false)) as aberrant,
      case when k.has_tp and not k.cancelled and k.measured
        then k.terminus_delay_s < public.regularity_max_delay_s(k.duration_s) end as on_time_official,
      case when k.has_tp and not k.cancelled and not coalesce(k.terminus_delay_s >= public.aberrant_delay_s(), false)
        then public.delay_bucket(k.terminus_delay_s) end as bucket,
      case when k.has_tp and not k.cancelled and k.measured then coalesce(c.pct, 0) end as comp_pct,
      case when k.has_tp and not k.cancelled and k.measured then case when c.form = 'bon' then c.pct else 0 end end as comp_pct_bon,
      case when k.has_tp and not k.cancelled and k.measured then coalesce(cn.pct, 0) - coalesce(c.pct, 0) end as comp_pct_intl_cap,
      case when k.observed and not k.cancelled and k.measured then coalesce(ch.pct, 0) end as comp_pct_high,
      case when k.observed and not k.cancelled and k.measured
        then case when k.skipped then 0 else coalesce(cl.pct, 0) end end as comp_pct_low
    from k
    left join lateral (select x.pct, x.form from sc x where x.brand = k.tp_brand and x.scope = k.tp_scope
                       and x.from_s <= k.terminus_delay_s order by x.from_s desc limit 1) c on true
    left join lateral (select x.pct from sc x where x.brand = k.tp_brand and x.scope = 'national'
                       and x.from_s <= k.terminus_delay_s order by x.from_s desc limit 1) cn on true
    left join lateral (select x.pct from sc x where x.brand = k.brand and x.scope = k.b_scope
                       and x.from_s <= k.terminus_delay_s + public.delay_tolerance_s() order by x.from_s desc limit 1) ch on true
    left join lateral (select x.pct from sc x where x.brand = k.brand and x.scope = k.b_scope
                       and x.from_s <= greatest(k.terminus_delay_s - public.delay_tolerance_s(), 0) order by x.from_s desc limit 1) cl on true
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
      coalesce(sum(b.comp_pct_bon) filter (where b.circulated), 0)::bigint as comp_pct_sum_bon,
      coalesce(sum(b.comp_pct_intl_cap) filter (where b.circulated), 0)::bigint as comp_pct_sum_intl_cap,
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
    ('comp_pct_sum', g.comp_pct_sum), ('comp_pct_sum_bon', g.comp_pct_sum_bon), ('comp_pct_sum_intl_cap', g.comp_pct_sum_intl_cap),
    ('aberrant', g.aberrant), ('skipped_stop', g.skipped_stop),
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
$$;
