import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip } from './sql/harness.ts'

let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
const t = (hhmm: string) => `${today}T${hhmm}:00Z`

// Gares du cas réel 8530 (Hendaye) + 8560 (Tarbes) : jonction à Dax, puis Bordeaux et Paris ensemble.
const HENDAYE = 'StopArea:OCE87671008', TARBES = 'StopArea:OCE87677005', DAX = 'StopArea:OCE87671016', BDX = 'StopArea:OCE87581009', PARIS = 'StopArea:OCE87391003'
const stop = (seq: number, stopId: string, name: string, arr: string, dep: string) => ({ seq, stopId, name, lat: 44, lon: 0, arr: t(arr), dep: t(dep) })

type Delays = Record<string, number | 'cancelled'>
async function seedPair(d8530?: Delays, d8560?: Delays) {
  const circ = (d?: Delays) => d ? { terminusDelayS: Object.values(d).at(-1) as number, stopDelays: d } : undefined
  await seedTrip(db, {
    serviceDate: today, tripId: 'A', brand: 'INOUI', axis: 'ATLANTIQUE', trainNumber: '8530', dep: t('07:06'), arr: t('11:55'),
    stops: [stop(0, HENDAYE, 'Hendaye', '07:06', '07:06'), stop(1, DAX, 'Dax', '08:19', '08:23'), stop(2, BDX, 'Bordeaux Saint-Jean', '09:40', '09:46'), stop(3, PARIS, 'Paris Montparnasse', '11:55', '11:55')],
    circulation: circ(d8530),
  })
  await seedTrip(db, {
    serviceDate: today, tripId: 'B', brand: 'INOUI', axis: 'ATLANTIQUE', trainNumber: '8560', dep: t('06:31'), arr: t('11:55'),
    stops: [stop(0, TARBES, 'Tarbes', '06:31', '06:31'), stop(1, DAX, 'Dax', '08:14', '08:23'), stop(2, BDX, 'Bordeaux Saint-Jean', '09:40', '09:46'), stop(3, PARIS, 'Paris Montparnasse', '11:55', '11:55')],
    circulation: circ(d8560),
  })
}
const coupling = async (n: string) => asAnon(db, async () => (await db.query<{ v: Record<string, unknown> | null }>('select public.train_coupling($1) as v', [n])).rows[0].v)

test('8530 et 8560 : couplés de Dax à Paris, vu des deux côtés', async () => {
  await seedPair()
  const a = await coupling('8530'), b = await coupling('8560')
  expect(a).toMatchObject({ partner: '8560', date: today, from: ['87671016', 'Dax'], to: ['87391003', 'Paris Montparnasse'], together: null })
  expect(b).toMatchObject({ partner: '8530', from: ['87671016', 'Dax'], to: ['87391003', 'Paris Montparnasse'] })
})

test('constaté : mêmes retards après la jonction = ensemble, retards qui divergent = séparés', async () => {
  // 07/11 : 8530 part avec +10 min, rejoint 8560 à Dax ; à Bordeaux et Paris les retards sont les mêmes.
  await seedPair({ 0: 600, 1: 300, 2: 300, 3: 0 }, { 0: 0, 1: 0, 2: 300, 3: 0 })
  expect((await coupling('8530'))?.together).toBe(true)
  await resetData(db)
  // 10/11 : 8560 a heurté un animal avant Dax, 8530 arrive avec +10 min contre +35 min.
  await seedPair({ 0: 0, 1: 0, 2: 0, 3: 600 }, { 0: 0, 1: 2700, 2: 2100, 3: 2100 })
  expect((await coupling('8530'))?.together).toBe(false)
})

test('un seul retard connu ou train supprimé : pas de constat', async () => {
  await seedPair({ 0: 'cancelled', 1: 0, 2: 0, 3: 0 })
  expect((await coupling('8530'))?.together).toBeNull()
})

test('un train seul, deux arrêts communs seulement, numéro invalide ou inconnu : rien', async () => {
  await seedTrip(db, {
    serviceDate: today, tripId: 'C', brand: 'INOUI', axis: 'ATLANTIQUE', trainNumber: '8600', dep: t('08:00'), arr: t('10:00'),
    stops: [stop(0, DAX, 'Dax', '08:00', '08:00'), stop(1, BDX, 'Bordeaux Saint-Jean', '09:00', '09:05'), stop(2, PARIS, 'Paris Montparnasse', '10:00', '10:00')],
  })
  // Autre train qui ne partage que Bordeaux et Paris : 2 arrêts, pas un couplage.
  await seedTrip(db, {
    serviceDate: today, tripId: 'D', brand: 'INOUI', axis: 'ATLANTIQUE', trainNumber: '8602', dep: t('08:30'), arr: t('10:00'),
    stops: [stop(0, TARBES, 'Tarbes', '08:30', '08:30'), stop(1, BDX, 'Bordeaux Saint-Jean', '09:00', '09:05'), stop(2, PARIS, 'Paris Montparnasse', '10:00', '10:00')],
  })
  expect(await coupling('8600')).toBeNull()
  expect(await coupling('99999')).toBeNull()
  expect(await coupling('abc')).toBeNull()
})

test('séparation en route (Paris → Dax ensemble) : segment de Paris à Dax', async () => {
  const mk = async (id: string, n: string, end: [string, string], depDax: string) => seedTrip(db, {
    serviceDate: today, tripId: id, brand: 'INOUI', axis: 'ATLANTIQUE', trainNumber: n, dep: t('13:00'), arr: t('18:00'),
    stops: [stop(0, PARIS, 'Paris Montparnasse', '13:00', '13:00'), stop(1, BDX, 'Bordeaux Saint-Jean', '15:40', '15:46'), stop(2, DAX, 'Dax', '17:00', depDax), stop(3, end[0], end[1], '18:00', '18:00')],
  })
  await mk('E', '8537', [HENDAYE, 'Hendaye'], '17:05')
  await mk('F', '8572', [TARBES, 'Tarbes'], '17:10')
  expect(await coupling('8537')).toMatchObject({ partner: '8572', from: ['87391003', 'Paris Montparnasse'], to: ['87671016', 'Dax'] })
})
