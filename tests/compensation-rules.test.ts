import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'
let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

const one = async <T>(sql: string, args: unknown[]) => (await db.query<{ v: T }>(sql, args)).rows[0].v
const pct = (brand: string, d: number, intl: boolean) => one<number>('select public.compensation_pct($1, $2, $3) as v', [brand, d, intl])
const form = (brand: string, d: number, intl: boolean) => one<string | null>('select public.compensation_form($1, $2, $3) as v', [brand, d, intl])

test('G30 national 25 / 50 / 75 %, international plafonné à 50 % ; OUIGO identique en international', async () => {
  expect([await pct('INOUI', 1800, false), await pct('INOUI', 1860, false), await pct('INOUI', 7200, false), await pct('INOUI', 10860, false)])
    .toEqual([0, 25, 50, 75])
  expect([await pct('INOUI', 1860, true), await pct('INOUI', 7200, true), await pct('INOUI', 10860, true)]).toEqual([25, 50, 50])
  expect([await pct('OUIGO', 3600, true), await pct('OUIGO', 10860, true)]).toEqual([25, 50])
  expect(await one<number>('select public.compensation_pct($1, $2) as v', ['INOUI', 10860])).toBe(75)
})

test('forme : bon de 31 min à 1 h, argent au-delà en INOUI ; toujours bon en OUIGO', async () => {
  expect([await form('INOUI', 1860, false), await form('INOUI', 3600, false), await form('INOUI', 3660, false), await form('INOUI', 10860, true)])
    .toEqual(['bon', 'bon', 'argent', 'argent'])
  expect([await form('OUIGO', 3600, false), await form('OUIGO', 7200, false), await form('INOUI', 1200, false)]).toEqual(['bon', 'bon', null])
})

test('international : code UIC à 8 chiffres hors 87 en origine ou destination', async () => {
  const intl = (o: string | null, d: string | null) => one<boolean>('select public.is_international($1, $2) as v', [o, d])
  expect(await intl('StopArea:OCE87686006', 'StopArea:OCE83002020')).toBe(true)
  expect(await intl('StopArea:OCE87686006', 'StopArea:OCE87751008')).toBe(false)
  expect(await intl('S1', null)).toBe(false)
})

test('stats_period : barème du train, part en bons et écart au barème national', async () => {
  const stop = (seq: number, stopId: string) => ({ seq, stopId, name: stopId, lat: 45, lon: 5, arr: '2026-11-01T18:00:00Z', dep: '2026-11-01T18:00:00Z' })
  const trip = (tripId: string, d: number, intl: boolean): SeedTrip => ({
    serviceDate: '2026-11-01', tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber: tripId,
    dep: '2026-11-01T17:00:00Z', arr: '2026-11-01T20:00:00Z', circulation: { terminusDelayS: d },
    stops: [stop(0, 'StopArea:OCE87686006'), stop(1, intl ? 'StopArea:OCE83002020' : 'StopArea:OCE87751008')],
  })
  for (const t of [trip('1', 2100, false), trip('2', 10860, false), trip('3', 10860, true), trip('4', 2100, true)]) await seedTrip(db, t)
  const r = await db.query<{ metric: string; n: string }>(
    'select metric, sum(n)::text as n from public.stats_period($1, $2, $3) group by metric', ['2026-11-01', '2026-11-01', NOW])
  const m = Object.fromEntries(r.rows.map((x) => [x.metric, Number(x.n)]))
  expect(m).toMatchObject({ comp_pct_sum: 25 + 75 + 50 + 25, comp_pct_sum_bon: 25 + 25, comp_pct_sum_intl_cap: 25 })
})

test('OUIGO international : rabattu sur le barème national OUIGO, jamais null ni 0 % au-delà d’une heure', async () => {
  for (const [d, p] of [[3600, 25], [7200, 50], [10860, 50]] as const) {
    expect(await pct('OUIGO', d, true)).toBe(p)
    expect(await pct('OUIGO', d, true)).toBe(await pct('OUIGO', d, false))
    expect(await form('OUIGO', d, true)).toBe('bon')
  }
  expect(await one<string>('select (public.compensation_step($1, $2, $3)).scope as v', ['OUIGO', 7200, true])).toBe('national')
})

test('retour arrière : barème à 5 paliers, fonctions ajoutées supprimées, ancien calcul', async () => {
  const { readFileSync } = await import('node:fs')
  const down = await makeDb()
  await down.exec(readFileSync(new URL('../supabase/rollback/20261107000002_compensation_rules_down.sql', import.meta.url), 'utf8'))
  const q = async <T>(sql: string) => (await down.query<{ v: T }>(sql)).rows[0].v
  expect(await q<number>('select count(*)::int as v from public.compensation_scale')).toBe(5)
  expect(await q<number>(`select public.compensation_pct('INOUI', 10860) as v`)).toBe(75)
  expect(await q<number>(`select count(*)::int as v from pg_proc where proname in ('is_international', 'compensation_form', 'compensation_step')`)).toBe(0)
  expect(await q<number>(`select count(*)::int as v from information_schema.columns where table_name = 'compensation_scale' and column_name in ('scope', 'form')`)).toBe(0)
  await down.close()
})
