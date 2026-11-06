import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asAnon, makeDb, resetData, seedTrip } from './sql/harness.ts'

// follow_add utilise now() : les trajets sont placés autour de l'heure réelle.
let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

const MIN = 60_000
const at = (min: number) => new Date(Date.now() + min * MIN).toISOString()
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
const EP = 'https://fcm.googleapis.com/fcm/send/abc'
const KEY = 'B'.repeat(87), AUTH = 'a'.repeat(22)

// Tours (1) → Saint-Pierre (2) → Poitiers (3) → Bordeaux (4) ; départ il y a 30 min, terminus dans 90 min.
async function seed(number = '8308', circ: { cancelled?: boolean; stopDelays?: Record<string, number | 'cancelled'> } | null = {}, arrMin = 90) {
  const s = (seq: number, name: string, min: number) =>
    ({ seq, stopId: `StopArea:OCE8757${seq}000`, name, lat: 46, lon: 0, arr: at(min), dep: at(min) })
  await seedTrip(db, {
    serviceDate: today, tripId: `T${number}`, brand: 'INOUI', axis: 'ATLANTIQUE', trainNumber: number, dep: at(-30), arr: at(arrMin),
    stops: [s(1, 'Tours', -30), s(2, 'Saint-Pierre-des-Corps', -20), s(3, 'Poitiers', 20), s(4, 'Bordeaux', arrMin)],
    circulation: circ === null ? undefined : { terminusDelayS: null, ...circ },
  })
}
const add = (number = '8308', ep = EP) =>
  asAnon(db, async () => (await db.query<{ v: { stop_sequence: number; stops: [number, string][] } }>(
    'select public.follow_add($1, $2, $3, $4) as v', [ep, KEY, AUTH, number])).rows[0].v)
const states = async (min = 0) => (await db.query<Record<string, unknown>>('select * from public.follow_states($1)', [at(min)])).rows

test('suivre : terminus par défaut, arrêts encore à venir pour le menu', async () => {
  await seed()
  const r = await add()
  expect(r.stop_sequence).toBe(4)
  expect(r.stops).toEqual([[3, 'Poitiers'], [4, 'Bordeaux']])
  // Second clic du même navigateur : pas de doublon.
  await add()
  expect((await db.query('select 1 from train_follows')).rows).toHaveLength(1)
})

test('refus : adresse d’envoi inconnue, train terminé ou supprimé, plus de 10 suivis', async () => {
  await seed('8308')
  await expect(add('8308', 'https://evil.example/push')).rejects.toMatchObject({ code: '22023' })
  await expect(add('8308', 'http://fcm.googleapis.com/x')).rejects.toMatchObject({ code: '22023' })
  await seed('8310', {}, -60)
  await expect(add('8310')).rejects.toMatchObject({ code: 'P0002' })
  await seed('8312', { cancelled: true })
  await expect(add('8312')).rejects.toMatchObject({ code: 'P0002' })
  await expect(add('99999')).rejects.toMatchObject({ code: 'P0002' })
  for (let i = 0; i < 10; i++) { await seed(String(8400 + i)); await add(String(8400 + i)) }
  await expect(add('8308')).rejects.toMatchObject({ code: '54000' })
  // Les adresses Apple et Mozilla passent.
  await expect(add('8308', 'https://web.push.apple.com/abc')).resolves.toBeTruthy()
  await expect(add('8308', 'https://updates.push.services.mozilla.com/wpush/v2/abc')).resolves.toBeTruthy()
})

test('anon : table et état illisibles', async () => {
  await seed(); await add()
  await expect(asAnon(db, () => db.query('select * from train_follows'))).rejects.toThrow()
  await expect(asAnon(db, () => db.query('select * from public.follow_states()'))).rejects.toThrow()
})

test('changer de gare : arrêt du parcours seulement, palier remis à 0 ; arrêter le suivi', async () => {
  await seed(); await add()
  await db.exec('update train_follows set last_step = 15')
  const setStop = (seq: number) => asAnon(db, () => db.query('select public.follow_set_stop($1, $2, $3)', [EP, '8308', seq]))
  await expect(setStop(9)).rejects.toMatchObject({ code: '22023' })
  await setStop(3)
  expect((await db.query('select stop_sequence, last_step from train_follows')).rows).toEqual([{ stop_sequence: 3, last_step: 0 }])
  const remove = async () => (await asAnon(db, () => db.query<{ v: boolean }>('select public.follow_remove($1, $2) as v', [EP, '8308']))).rows[0].v
  expect(await remove()).toBe(true)
  expect(await remove()).toBe(false)
})

test('état : retard connu avant la gare, arrivée à l’heure prévue + retard + 5 min, indemnité', async () => {
  await seed('8308', { stopDelays: { 2: 1800 } }); await add()
  // Bordeaux n'a pas de retard publié : celui de Saint-Pierre (30 min) vaut.
  expect(await states()).toMatchObject([{ delay_s: 1800, is_terminus: true, arrived: false, comp_pct: 25, comp_form: 'bon', stop_name: 'Bordeaux' }])
  expect((await states(90 + 30 + 4))[0].arrived).toBe(false)
  expect((await states(90 + 30 + 6))[0].arrived).toBe(true)
})

test('état : suppression du train ou de la gare ; train jamais observé jamais « arrivé »', async () => {
  await seed('8308', { stopDelays: { 4: 'cancelled' } }); await add()
  expect(await states()).toMatchObject([{ stop_cancelled: true, cancelled: false }])
  await db.exec('update circulations set cancelled = true')
  expect(await states()).toMatchObject([{ cancelled: true }])
  await resetData(db)
  await seed('8308', null); await add()
  expect((await states(200))[0]).toMatchObject({ arrived: false, delay_s: null })
})
