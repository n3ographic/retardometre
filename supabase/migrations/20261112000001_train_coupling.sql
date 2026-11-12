-- Rames couplées (fiche /train/XXXX) : train_coupling(numéro) cherche, dans l'horaire prévu de la circulation la plus
-- récente du train, un autre numéro qui partage au moins 3 arrêts à la même minute (arrivée ou départ identique) : deux
-- numéros qui repartent d'une gare ensemble et arrivent ensemble ailleurs forment un seul train (accouplement ou
-- désaccouplement en route, ex. 8530 Hendaye + 8560 Tarbes, jointes à Dax).
-- Renvoie null sans partenaire, sinon { partner, date, from: {uic, nom}, to: {uic, nom}, together } :
--   from / to : premier et dernier arrêt partagés (la jonction ou la séparation est l'une de ces gares) ;
--   together  : constaté sur les arrêts où les deux numéros sont arrivés ET repartis à la même minute : true si leurs
--               retards publiés y sont identiques, false s'ils diffèrent (ils ont circulé séparément), null sans mesure.
-- Lecture seule, security invoker (vues et tables déjà publiques), additif.
-- Retour arrière : supabase/rollback/20261112000001_train_coupling_down.sql

create or replace function public.train_coupling(p_number text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (
    select t.service_date, t.trip_id
    from public.canonical_trips t
    where p_number ~ '^\d{1,5}$' and t.train_number = p_number and t.removed_at is null
      and t.service_date <= (pg_catalog.now() at time zone 'Europe/Paris')::date
      and exists (select 1 from public.stop_times_planned q where q.service_date = t.service_date and q.trip_id = t.trip_id)
    order by t.service_date desc limit 1
  ),
  shared as (
    select o.train_number as partner, o.trip_id as o_trip, m.stop_sequence as my_seq, x.stop_sequence as o_seq, m.stop_id,
      m.arr_planned is not distinct from x.arr_planned and m.dep_planned is not distinct from x.dep_planned as together_here
    from me
    join public.stop_times_planned m on m.service_date = me.service_date and m.trip_id = me.trip_id
    join public.canonical_trips o on o.service_date = me.service_date and o.train_number <> p_number and o.removed_at is null
    join public.stop_times_planned x on x.service_date = o.service_date and x.trip_id = o.trip_id
      and pg_catalog.right(x.stop_id, 8) = pg_catalog.right(m.stop_id, 8)
      and (m.arr_planned = x.arr_planned or m.dep_planned = x.dep_planned)
  ),
  best as (
    select partner, o_trip from shared group by partner, o_trip
    having pg_catalog.count(*) >= 3
    order by pg_catalog.count(*) desc, partner limit 1
  ),
  seg as (select s.* from shared s join best b on b.partner = s.partner and b.o_trip = s.o_trip),
  measured as (
    select pg_catalog.count(*) as n, pg_catalog.bool_and(a.v = b.v) as same
    from seg s, me
    join public.canonical_circulations ca on ca.service_date = me.service_date and ca.train_number = p_number
    join public.canonical_circulations cb on cb.service_date = me.service_date and cb.train_number = (select partner from best),
    lateral (select (ca.stop_delays ->> s.my_seq::text)::numeric as v where pg_catalog.jsonb_typeof(ca.stop_delays -> s.my_seq::text) = 'number') a,
    lateral (select (cb.stop_delays ->> s.o_seq::text)::numeric as v where pg_catalog.jsonb_typeof(cb.stop_delays -> s.o_seq::text) = 'number') b
    where s.together_here
  )
  select case when not exists (select 1 from best) then null else pg_catalog.jsonb_build_object(
    'partner', (select partner from best),
    'date', (select service_date from me),
    'from', (select pg_catalog.jsonb_build_array(pg_catalog.right(s.stop_id, 8), st.name)
             from seg s left join public.stops st on st.stop_id = s.stop_id order by s.my_seq limit 1),
    'to', (select pg_catalog.jsonb_build_array(pg_catalog.right(s.stop_id, 8), st.name)
           from seg s left join public.stops st on st.stop_id = s.stop_id order by s.my_seq desc limit 1),
    'together', (select case when n > 0 then same end from measured)
  ) end
$$;

grant execute on function public.train_coupling(text) to anon;
