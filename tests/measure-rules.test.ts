import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip } from './sql/harness.ts'

let db: PGlite
beforeAll(async () => {
  db = await makeDb()
  await resetData(db)
})
afterEach(async () => { await resetData(db) })

test('barème INOUI et OUIGO (secondes de retard)', async () => {
  const { rows } = await db.query('select brand, scope, from_s, pct, form from compensation_scale order by brand, scope, from_s')
  expect(rows.map((r: any) => `${r.brand} ${r.scope} ${r.from_s} ${r.pct} ${r.form}`)).toEqual([
    'INOUI international 1800 25 bon', 'INOUI international 3660 25 argent', 'INOUI international 7200 50 argent',
    'INOUI national 1800 25 bon', 'INOUI national 3660 25 argent', 'INOUI national 7200 50 argent', 'INOUI national 10860 75 argent',
    'OUIGO national 3600 25 bon', 'OUIGO national 7200 50 bon'])
})

test('règle de régularité officielle', async () => {
  const { rows } = await db.query('select duration_from_s, max_delay_exclusive_s from regularity_rule order by 1')
  expect(rows).toEqual([{ duration_from_s: 0, max_delay_exclusive_s: 300 },
    { duration_from_s: 5400, max_delay_exclusive_s: 600 }, { duration_from_s: 10801, max_delay_exclusive_s: 900 }])
})

test('prix de référence HT et capacité', async () => {
  const { rows } = await db.query('select brand, price_eur_ht::text as price, seats from reference_prices order by brand')
  expect(rows).toEqual([{ brand: 'INOUI', price: '46.60', seats: 556 }, { brand: 'OUIGO', price: '34.20', seats: 634 }])
})

test('chaque règle porte sa source', async () => {
  const { rows } = await db.query<{ n: number }>(`select (
    (select count(*) from compensation_scale where coalesce(source_url, '') = '' or source_as_of is null) +
    (select count(*) from regularity_rule where coalesce(source_url, '') = '') +
    (select count(*) from reference_prices where coalesce(price_source, '') = '' or coalesce(seats_source, '') = '' or as_of is null)
  )::int as n`)
  expect(rows[0].n).toBe(0)
})

test('anon lit les règles et stop_times_planned, pas events ni collector_state', async () => {
  await seedTrip(db, { serviceDate: '2026-10-21', tripId: 't1', brand: 'INOUI', axis: 'SUD_EST', trainNumber: '6101',
    dep: '2026-10-21T06:00:00Z', arr: '2026-10-21T08:00:00Z',
    stops: [{ seq: 1, stopId: 'A', name: 'Paris', lat: 48.8, lon: 2.3, arr: '2026-10-21T06:00:00Z', dep: '2026-10-21T06:00:00Z' }] })
  await db.query(`insert into events (observed_at, service_date, trip_id, kind, value) values (now(), '2026-10-21', 't1', 'first_seen', '{}')`)
  await db.query(`insert into collector_state (id, last_run_at) values (1, now())`)
  const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n
  const seen = await asAnon(db, async () => ({
    scale: await count('compensation_scale'), regularity: await count('regularity_rule'), prices: await count('reference_prices'),
    stopTimes: await count('stop_times_planned'), events: await count('events'), state: await count('collector_state'),
  }))
  expect(seen).toEqual({ scale: 9, regularity: 3, prices: 2, stopTimes: 1, events: 0, state: 0 })
})

test('anon ne peut ni écrire dans les règles ni dans circulations', async () => {
  const denied = /permission denied|row-level security/
  await asAnon(db, async () => {
    await expect(db.query(`insert into compensation_scale (brand, from_s, pct, source_url, source_as_of) values ('INOUI', 1, 1, 'x', '2026-01-01')`)).rejects.toThrow(denied)
    await expect(db.query(`insert into regularity_rule (duration_from_s, max_delay_exclusive_s, source_url) values (1, 1, 'x')`)).rejects.toThrow(denied)
    await expect(db.query(`insert into reference_prices (brand, price_eur_ht, seats, price_source, seats_source, as_of) values ('INOUI', 1, 1, 'x', 'x', '2026-01-01')`)).rejects.toThrow(denied)
    await expect(db.query(`insert into circulations (service_date, trip_id, brand, axis, train_number, cancelled, stop_delays) values ('2026-10-21', 'x', 'INOUI', 'NORD', '1', false, '{}')`)).rejects.toThrow(denied)
    await expect(db.query(`update compensation_scale set pct = 99`)).rejects.toThrow(denied)
    await expect(db.query(`delete from regularity_rule`)).rejects.toThrow(denied)
    await expect(db.query(`truncate reference_prices`)).rejects.toThrow(denied)
  })
  const { rows } = await db.query(`select (select count(*) from compensation_scale)::int as scale, (select count(*) from regularity_rule)::int as regularity,
    (select count(*) from reference_prices)::int as prices, (select count(*) from circulations)::int as circ`)
  expect(rows[0]).toEqual({ scale: 9, regularity: 3, prices: 2, circ: 0 })
})

test('asAnon remet le rôle même si le rappel échoue', async () => {
  await expect(asAnon(db, () => db.query('delete from regularity_rule'))).rejects.toThrow()
  const { rows } = await db.query<{ r: string }>('select current_user as r')
  expect(rows[0].r).not.toBe('anon')
  await db.query(`insert into collector_state (id) values (1)`)
})
