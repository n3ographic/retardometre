import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'
let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

// Jour de service 2026-11-01, arrivée à 20:00Z : tous les trains sont terminés à NOW.
const ARR = '2026-11-01T20:00:00Z'
const trip = (tripId: string, circulation: SeedTrip['circulation'], extra: Partial<SeedTrip> = {}): SeedTrip => ({
  serviceDate: '2026-11-01', tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber: tripId,
  dep: '2026-11-01T17:00:00Z', arr: ARR, circulation, ...extra,
})
const seed = async (...ts: SeedTrip[]) => { for (const t of ts) await seedTrip(db, t) }
const stats = async (brand = 'INOUI') => {
  const r = await db.query<{ metric: string; n: string }>(
    'select metric, sum(n)::text as n from public.stats_period($1, $2, $3) where brand = $4 group by metric', ['2026-11-01', '2026-11-01', NOW, brand])
  return Object.fromEntries(r.rows.map((x) => [x.metric, Number(x.n)]))
}

test('retard de 12 h : écarté des mesures et compté à part ; 11 h 59 min 59 s reste mesuré', async () => {
  await seed(trip('A', { terminusDelayS: 43199 }), trip('B', { terminusDelayS: 43200 }))
  const m = await stats()
  expect(m).toMatchObject({ circulated: 1, aberrant: 1, comp_eligible: 1, comp_pct_sum: 75, on_time_official: 0, 'terminus:180+': 1 })
})

test('retard aberrant : ses arrêts ne comptent pas dans les tranches par arrêt', async () => {
  await seed(trip('A', { terminusDelayS: 600, stopDelays: { '1': 600 } }),
    trip('B', { terminusDelayS: 66000, stopDelays: { '1': 'cancelled', '2': 66000 } }))
  const m = await stats()
  expect(m['stop:5-14']).toBe(1)
  expect(m['stop:180+']).toBeUndefined()
  expect(m['stop:cancelled']).toBeUndefined()
})

test('vue circulation_measures : un retard aberrant n’a ni tranche, ni régularité, ni pourcentage', async () => {
  await seed(trip('B', { terminusDelayS: 66000 }))
  const r = (await db.query<Record<string, unknown>>(`select aberrant, bucket, on_time_official, comp_pct from public.circulation_measures`)).rows[0]
  expect(r).toEqual({ aberrant: true, bucket: null, on_time_official: null, comp_pct: null })
})

test('pourcentages central, bas (retard − 4 min 59 s) et haut (retard + 4 min 59 s) aux seuils INOUI', async () => {
  // Retards publiés par pas de 5 min : 1800 (au seuil de 1800), 2100, 7200, 10800, 300.
  await seed(trip('T1', { terminusDelayS: 1800 }), trip('T2', { terminusDelayS: 2100 }), trip('T3', { terminusDelayS: 7200 }),
    trip('T4', { terminusDelayS: 10800 }), trip('T5', { terminusDelayS: 300 }))
  const m = await stats()
  expect(m.comp_pct_sum).toBe(25 + 25 + 50 + 50 + 0)
  expect(m.comp_pct_sum_low).toBe(0 + 25 + 25 + 50 + 0) // 1800 − 299 = 1501 < 1800 ; 2100 − 299 = 1801 ≥ 1800 ; 7200 − 299 < 7200
  expect(m.comp_pct_sum_high).toBe(25 + 25 + 50 + 75 + 0) // 1800 + 299 ≥ 1800 ; 10800 + 299 ≥ 10860
})

test('barème OUIGO : le bas retire le palier à 3 600 s publiées', async () => {
  await seed(trip('O1', { terminusDelayS: 3600 }, { brand: 'OUIGO', axis: 'ATLANTIQUE' }))
  const m = await stats('OUIGO')
  expect([m.comp_pct_sum, m.comp_pct_sum_low, m.comp_pct_sum_high]).toEqual([25, 0, 25])
})

test('train qui saute un arrêt : gardé au centre et en haut, exclu du bas ; comptabilisé à part', async () => {
  await seed(trip('S', { terminusDelayS: 2400, stopDelays: { '1': 'cancelled', '2': 2400 } }), trip('N', { terminusDelayS: 2400, stopDelays: { '1': 0, '2': 2400 } }))
  const m = await stats()
  expect(m).toMatchObject({ circulated: 2, skipped_stop: 1, comp_pct_sum: 50, comp_pct_sum_low: 25, comp_pct_sum_high: 50 })
})

test('un retard nul ou inférieur à la tolérance ne donne jamais un pourcentage négatif ni un retard négatif', async () => {
  await seed(trip('Z', { terminusDelayS: 0 }), trip('E', { terminusDelayS: -120 }))
  const m = await stats()
  expect([m.comp_pct_sum, m.comp_pct_sum_low, m.comp_pct_sum_high]).toEqual([0, 0, 0])
})

test('les nouvelles mesures sont aussi enregistrées par jour et retrouvées par cumul_totals', async () => {
  await seed(trip('A', { terminusDelayS: 2100 }), trip('B', { terminusDelayS: 43200 }))
  await db.query('select public.snapshot_day($1, $2)', ['2026-11-01', NOW])
  const t = (await db.query<{ metric: string; n: string }>(`select metric, n::text from public.cumul_totals() where brand = 'INOUI'`)).rows
  const byMetric = Object.fromEntries(t.map((x) => [x.metric, Number(x.n)]))
  expect(byMetric).toMatchObject({ aberrant: 1, comp_pct_sum: 25, comp_pct_sum_low: 25, comp_pct_sum_high: 25, skipped_stop: 0 })
})
