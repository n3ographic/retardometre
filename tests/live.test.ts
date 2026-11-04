import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'

let db: PGlite
beforeAll(async () => {
  db = await makeDb()
  await resetData(db)
})
afterEach(async () => { await resetData(db) })

type Stop = { seq: number; name: string; lat: number; lon: number; arr: string; dep: string; delay_s?: number; cancelled?: true }
type Train = {
  trip_id: string; service_date: string; brand: string; axis: string; train_number: string; cancelled: boolean
  dep_planned: string; arr_planned: string; origin?: string; dest?: string
  delay_s?: number; last_seq?: number; cause?: string; comp_pct: number; last_seen_at: string; stops: Stop[]
}
const live = async (db: PGlite) => (await db.query<{ j: Train[] }>('select public.live_trains($1) as j', [NOW])).rows[0].j

// Clés nulles omises : avec un retard connu, tout est présent sauf stop_id (retiré) et cancelled (faux omis).
const TRAIN_KEYS = ['trip_id', 'service_date', 'brand', 'axis', 'train_number', 'cancelled', 'dep_planned', 'arr_planned',
  'origin', 'dest', 'delay_s', 'last_seq', 'cause', 'comp_pct', 'last_seen_at', 'stops'].sort()
const STOP_KEYS = ['seq', 'name', 'lat', 'lon', 'arr', 'dep', 'delay_s'].sort()

const STOPS: NonNullable<SeedTrip['stops']> = [
  { seq: 1, stopId: 'PLY', name: 'Paris Gare de Lyon', lat: 48.844, lon: 2.374, arr: '2026-11-02T11:00:00Z', dep: '2026-11-02T11:00:00Z' },
  { seq: 2, stopId: 'LYD', name: 'Lyon Part-Dieu', lat: 45.760, lon: 4.859, arr: '2026-11-02T11:55:00Z', dep: '2026-11-02T11:58:00Z' },
  { seq: 3, stopId: 'MSC', name: 'Marseille Saint-Charles', lat: 43.302, lon: 5.380, arr: '2026-11-02T12:30:00Z', dep: '2026-11-02T12:30:00Z' },
]
// Jour de service 2026-11-02, 11:00Z → 12:30Z : en circulation à NOW.
const trip = (tripId: string, circulation?: SeedTrip['circulation'], extra: Partial<SeedTrip> = {}): SeedTrip => ({
  serviceDate: '2026-11-02', tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber: tripId,
  dep: '2026-11-02T11:00:00Z', arr: '2026-11-02T12:30:00Z', circulation, stops: STOPS, ...extra,
})

test('un train en cours : clés exactes, fenêtre de 3 arrêts depuis le dernier départ passé, retards par arrêt', async () => {
  await seedTrip(db, trip('A', { terminusDelayS: null, stopDelays: { '1': 0, '2': 420 }, cause: 'Panne', lastSeenAt: '2026-11-02T11:59:00Z' }))
  const trains = await live(db)
  expect(trains).toHaveLength(1)
  const t = trains[0]
  expect(Object.keys(t).sort()).toEqual(TRAIN_KEYS)
  expect(Object.keys(t.stops[0]).sort()).toEqual(STOP_KEYS)
  expect(t).toMatchObject({ trip_id: 'A', service_date: '2026-11-02', brand: 'INOUI', axis: 'SUD_EST', train_number: 'A',
    cancelled: false, delay_s: 420, last_seq: 2, cause: 'Panne', comp_pct: 0,
    origin: 'Paris Gare de Lyon', dest: 'Marseille Saint-Charles' })
  expect(Date.parse(t.dep_planned)).toBe(Date.parse('2026-11-02T11:00:00Z'))
  expect(Date.parse(t.arr_planned)).toBe(Date.parse('2026-11-02T12:30:00Z'))
  expect(Date.parse(t.last_seen_at)).toBe(Date.parse('2026-11-02T11:59:00Z'))
  // À 12:00Z : départ de Paris passé (11:00), départ de Lyon décalé de 420 s (12:05) pas encore.
  expect(t.stops.map(s => s.seq)).toEqual([1, 2, 3])
  expect(t.stops.map(s => s.delay_s)).toEqual([0, 420, 420]) // le dernier arrêt reprend le retard de l'arrêt précédent
  expect(t.stops[1]).toMatchObject({ name: 'Lyon Part-Dieu', lat: 45.76, lon: 4.859 })
  expect(Date.parse(t.stops[1].arr)).toBe(Date.parse('2026-11-02T11:55:00Z'))
  expect(Date.parse(t.stops[1].dep)).toBe(Date.parse('2026-11-02T11:58:00Z'))
})

test('retard au-delà du seuil : comp_pct selon la marque', async () => {
  await seedTrip(db, trip('I', { terminusDelayS: null, stopDelays: { '1': 0, '2': 1860 } }))
  await seedTrip(db, trip('O', { terminusDelayS: null, stopDelays: { '1': 0, '2': 1860 } }, { brand: 'OUIGO' }))
  const byId = Object.fromEntries((await live(db)).map(t => [t.trip_id, t]))
  expect(byId.I).toMatchObject({ delay_s: 1860, comp_pct: 25 })
  expect(byId.O).toMatchObject({ delay_s: 1860, comp_pct: 0 })
})

test('un train annulé reste visible jusqu’à la fin de sa fenêtre', async () => {
  await seedTrip(db, trip('X', { cancelled: true, terminusDelayS: null, stopDelays: { '1': 'cancelled', '2': 'cancelled', '3': 'cancelled' } }))
  const [t] = await live(db)
  expect(t).toMatchObject({ trip_id: 'X', cancelled: true, comp_pct: 0 })
  expect(t).not.toHaveProperty('delay_s')
  expect(t).not.toHaveProperty('last_seq')
  // À 12:00Z les départs de Paris (11:00) et de Lyon (11:58) sont passés : la fenêtre part de Lyon, il n'y a que deux arrêts.
  expect(t.stops.map(s => s.seq)).toEqual([2, 3])
  expect(t.stops.map(s => s.cancelled)).toEqual([true, true])
  expect(t.stops.map(s => s.delay_s)).toEqual([undefined, undefined])
})

test('un train terminé est absent', async () => {
  await seedTrip(db, trip('F', { terminusDelayS: 0 }, { dep: '2026-11-02T08:00:00Z', arr: '2026-11-02T10:00:00Z' }))
  expect(await live(db)).toEqual([])
})

test('un retard au terminus prolonge la fenêtre', async () => {
  const at11 = { dep: '2026-11-02T10:00:00Z', arr: '2026-11-02T11:00:00Z' }
  await seedTrip(db, trip('ZERO', { terminusDelayS: 0 }, at11))      // fenêtre close à 11:30Z
  await seedTrip(db, trip('LATE', { terminusDelayS: 1860 }, at11))   // fenêtre close à 12:01Z
  expect((await live(db)).map(t => t.trip_id)).toEqual(['LATE'])
})

test('aucun train : tableau vide', async () => {
  // Trajet prévu sans circulation : absent.
  await seedTrip(db, trip('P'))
  expect(await live(db)).toEqual([])
})

test('anon peut lire stop_times_planned via la fonction', async () => {
  await seedTrip(db, trip('A', { terminusDelayS: null, stopDelays: { '1': 0, '2': 420 } }))
  const expected = await live(db)
  expect(expected[0].stops).toHaveLength(3)
  expect(await asAnon(db, () => live(db))).toEqual(expected)
})

test('arrêts triés par stop_sequence même insérés dans le désordre', async () => {
  await seedTrip(db, trip('S', { terminusDelayS: null }, { stops: [STOPS[2], STOPS[0], STOPS[1]] }))
  const [t] = await live(db)
  expect(t.stops.map(s => s.seq)).toEqual([2, 3]) // départ de Paris (11:00) et de Lyon (11:58) passés à 12:00
  expect(t.stops.map(s => s.delay_s)).toEqual([undefined, undefined]) // aucun retard connu : pas de valeur inventée
})

test('clés de stop_delays non contiguës : dernier retard numérique', async () => {
  await seedTrip(db, trip('N', { terminusDelayS: null, stopDelays: { '1': 0, '3': 600 } }))
  const [t] = await live(db)
  expect(t).toMatchObject({ delay_s: 600, last_seq: 3 })
  expect(t.stops.map(s => s.seq)).toEqual([2, 3])
  expect(t.stops.map(s => s.delay_s)).toEqual([0, 600]) // Lyon reprend le retard de Paris
})

test('trajet sans horaires d’arrêts : stops vide', async () => {
  await seedTrip(db, trip('V', { terminusDelayS: null }, { stops: undefined }))
  const [t] = await live(db)
  expect(t.stops).toEqual([])
  expect(t).not.toHaveProperty('origin')
  expect(t).not.toHaveProperty('dest')
})

test('la fenêtre suit l’arrivée du plan, pas celle copiée dans la circulation', async () => {
  await seedTrip(db, trip('PL', { terminusDelayS: 0 }, { dep: '2026-11-02T11:30:00Z', arr: '2026-11-02T13:00:00Z' }))
  // Circulation périmée : arrivée 11:00Z → fenêtre close à 11:30Z si elle était la source.
  await db.query(`update circulations set arr_planned = '2026-11-02T11:00:00Z' where trip_id = 'PL'`)
  expect((await live(db)).map(t => t.trip_id)).toEqual(['PL'])
})

test('clés de stop_delays triées numériquement : "10" après "2"', async () => {
  await seedTrip(db, trip('T', { terminusDelayS: null, stopDelays: { '2': 300, '10': 600 } }))
  expect((await live(db))[0]).toMatchObject({ delay_s: 600, last_seq: 10 })
})

test('valeur "cancelled" à la plus haute clé : ignorée pour le dernier retard', async () => {
  await seedTrip(db, trip('C', { terminusDelayS: null, stopDelays: { '2': 300, '10': 'cancelled' } }))
  expect((await live(db))[0]).toMatchObject({ delay_s: 300, last_seq: 2 })
})

test('clé hors de la plage int ignorée sans faire échouer la requête', async () => {
  await seedTrip(db, trip('B', { terminusDelayS: null, stopDelays: { '1': 0, '99999999999': 5 } }))
  const trains = await live(db)
  expect(trains.map(t => t.trip_id)).toEqual(['B'])
  expect(trains[0]).toMatchObject({ delay_s: 0, last_seq: 1 })
})

test('cause tronquée à 600 caractères', async () => {
  await seedTrip(db, trip('L', { terminusDelayS: null, stopDelays: { '1': 0 }, cause: 'x'.repeat(700) }))
  expect((await live(db))[0].cause).toHaveLength(600)
})

// Trajet de cinq arrêts, un tous les ~30 min, pour tester le choix de la fenêtre selon l'heure (NOW = 12:00Z).
const route = (h: number): NonNullable<SeedTrip['stops']> => [
  { seq: 1, stopId: 'S1', name: 'Un', lat: 48, lon: 2, arr: `2026-11-02T${h}:00:00Z`, dep: `2026-11-02T${h}:00:00Z` },
  { seq: 2, stopId: 'S2', name: 'Deux', lat: 47.5, lon: 2.5, arr: `2026-11-02T${h}:20:00Z`, dep: `2026-11-02T${h}:22:00Z` },
  { seq: 3, stopId: 'S3', name: 'Trois', lat: 47, lon: 3, arr: `2026-11-02T${h}:50:00Z`, dep: `2026-11-02T${h}:52:00Z` },
  { seq: 4, stopId: 'S4', name: 'Quatre', lat: 46.5, lon: 3.5, arr: `2026-11-02T${h + 1}:20:00Z`, dep: `2026-11-02T${h + 1}:22:00Z` },
  { seq: 5, stopId: 'S5', name: 'Cinq', lat: 46, lon: 4, arr: `2026-11-02T${h + 1}:50:00Z`, dep: `2026-11-02T${h + 1}:50:00Z` },
]
const long = (id: string, h: number, delays: Record<string, number> | undefined, extra: Partial<SeedTrip> = {}) =>
  seedTrip(db, trip(id, { terminusDelayS: null, stopDelays: delays }, { dep: `2026-11-02T${h}:00:00Z`, arr: `2026-11-02T${h + 1}:50:00Z`, stops: route(h), ...extra }))

test('fenêtre : trois arrêts à partir du dernier départ effectif passé', async () => {
  await long('W', 11, { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 })
  const [t] = await live(db)
  expect(t.stops.map(s => s.seq)).toEqual([3, 4, 5]) // départ de l'arrêt 3 : 11:52 ≤ 12:00 ; arrêt 4 : 12:22 > 12:00
})

test('fenêtre : le retard décale le départ effectif (12:02 > 12:00 : l’arrêt 3 n’est pas encore parti)', async () => {
  await long('D', 11, { '1': 600, '2': 600, '3': 600, '4': 600, '5': 600 })
  const [t] = await live(db)
  expect(t.stops.map(s => s.seq)).toEqual([2, 3, 4])
  expect(t.stops.map(s => s.delay_s)).toEqual([600, 600, 600])
})

test('fenêtre : avant le départ, la fenêtre commence au premier arrêt', async () => {
  await long('F', 13, { '1': 0 }) // premier départ à 13:00 > 12:00
  const [t] = await live(db)
  expect(t.stops.map(s => s.seq)).toEqual([1, 2, 3])
})

test('fenêtre : après le dernier arrêt, seul le dernier arrêt reste', async () => {
  await long('E', 10, { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }) // arrivée 11:50 + 30 min de marge > 12:00 : encore listé
  const [t] = await live(db)
  expect(t.stops.map(s => s.seq)).toEqual([5])
})

test('fenêtre : un arrêt sans retard reprend celui de l’arrêt précédent', async () => {
  await long('C', 11, { '1': 0, '2': 900 })
  const [t] = await live(db)
  // arrêt 3 : 11:52 + 900 s = 12:07 > 12:00 ; arrêt 2 : 11:22 + 900 s = 11:37 ≤ 12:00
  expect(t.stops.map(s => s.seq)).toEqual([2, 3, 4])
  expect(t.stops.map(s => s.delay_s)).toEqual([900, 900, 900])
})

test('fenêtre : un arrêt supprimé garde cancelled et pas de retard, sans bloquer le report du retard', async () => {
  await long('X', 11, { '1': 0, '2': 300, '3': 'cancelled' as unknown as number, '4': 300 })
  const [t] = await live(db)
  const three = t.stops.find(s => s.seq === 3)
  expect(three).toMatchObject({ cancelled: true })
  expect(three).not.toHaveProperty('delay_s')
})
