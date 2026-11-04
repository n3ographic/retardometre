import { expect, test } from 'vitest'
import { alertCause, snapshotsFromFeed } from '../supabase/functions/_shared/snapshot.ts'
import type { PlannedStopTimes } from '../supabase/functions/_shared/types.ts'
import tu from './fixtures/trip-updates.json'
import sa from './fixtures/service-alerts.json'

const T5537 = tu.entity[0].id, T6153 = tu.entity[1].id, T7853 = tu.entity[2].id
const DAY = '2026-10-20'
// Horaires prévus (docs/findings/2026-10-20-sondage-flux.md), heure de Paris = UTC+2 ce jour-là.
const plan = (tripId: string, stops: [string, string, string][]): PlannedStopTimes => {
  const iso = (hm: string) => new Date(`${DAY}T${hm}:00+02:00`).toISOString()
  const p: PlannedStopTimes = { serviceDate: DAY, tripId, arrPlanned: {}, depPlanned: {}, stopSeqById: {} }
  stops.forEach(([stopId, arr, dep], seq) => {
    p.arrPlanned[seq] = iso(arr); p.depPlanned[seq] = iso(dep); p.stopSeqById[stopId] = seq
  })
  return p
}
const I = (uic: string) => `StopPoint:OCETGV INOUI-${uic}`
const O = (uic: string) => `StopPoint:OCEOUIGO-${uic}`
const p5537 = plan(T5537, [
  [I('87141002'), '12:26', '12:26'], [I('87212027'), '13:29', '13:37'], [I('87182014'), '14:03', '14:06'],
  [I('87182063'), '14:37', '14:41'], [I('87300822'), '15:03', '15:07'], [I('87300863'), '15:30', '15:36'],
  [I('87713040'), '16:04', '16:17'], [I('87713545'), '16:37', '16:40'], [I('87723197'), '17:59', '18:06'],
  [I('87318964'), '19:08', '19:11'], [I('87319012'), '19:32', '19:35'], [I('87751008'), '19:47', '20:01'],
  [I('87755009'), '20:44', '20:48'], [I('87755447'), '21:28', '21:31'], [I('87757526'), '21:45', '21:48'],
  [I('87757625'), '22:10', '22:14'], [I('87757674'), '22:22', '22:25'], [I('87756056'), '22:43', '22:43'],
])
const p6153 = plan(T6153, [[I('87686006'), '18:10', '18:10'], [I('87751008'), '21:13', '21:27'], [I('87755009'), '22:10', '22:10']])
const p7853 = plan(T7853, [
  [O('87686006'), '16:10', '16:10'], [O('87763029'), '18:23', '18:28'], [O('87755009'), '20:11', '20:15'],
  [O('87755447'), '20:52', '20:55'], [O('87757625'), '21:32', '21:36'], [O('87757674'), '21:47', '21:51'],
  [O('87756056'), '22:13', '22:13'],
])
const all = new Map([p5537, p6153, p7853].map(p => [`${DAY}|${p.tripId}`, p]))
const by = (snaps: ReturnType<typeof snapshotsFromFeed>, id: string) => snaps.find(s => s.tripId === id)!

test('un trajet hors planned est ignoré', () => {
  const planned = new Map(all); planned.delete(`${DAY}|${T6153}`)
  expect(snapshotsFromFeed(tu, sa, planned).map(s => s.tripId).sort()).toEqual([T5537, T7853].sort())
})

test('CANCELED → cancelled: true, arrêts SKIPPED → cancelled', () => {
  const s = by(snapshotsFromFeed(tu, sa, all), T6153)
  expect(s).toMatchObject({ serviceDate: DAY, cancelled: true, stopDelays: { '0': 'cancelled', '1': 'cancelled', '2': 'cancelled' } })
  expect(by(snapshotsFromFeed(tu, sa, all), T5537).cancelled).toBe(false)
})

test('delay : arrivée prioritaire, sinon départ', () => {
  const s = by(snapshotsFromFeed(tu, sa, all), T5537)
  expect(s.stopDelays['0']).toBe(0) // départ seul
  expect(s.stopDelays['1']).toBe(0) // arrivée 0, départ 4200
  expect(s.stopDelays['17']).toBe(4200)
})

test('time sans delay → retard calculé en secondes', () => {
  const copy = structuredClone(tu)
  for (const u of copy.entity[0].tripUpdate.stopTimeUpdate as any[]) { delete u.arrival?.delay; delete u.departure?.delay }
  const s = by(snapshotsFromFeed(copy, sa, all), T5537)
  expect(s.stopDelays).toEqual(by(snapshotsFromFeed(tu, sa, all), T5537).stopDelays)
  expect(s.stopDelays['2']).toBe(4200)
})

test('arrêt absent du plan (StopArea ajouté) ignoré', () => {
  const copy = structuredClone(tu)
  ;(copy.entity[0].tripUpdate.stopTimeUpdate as any[]).push({ stopId: 'StopArea:OCE87703975', arrival: { delay: 60, time: '1' } })
  expect(Object.keys(by(snapshotsFromFeed(copy, sa, all), T5537).stopDelays)).toHaveLength(18)
})

test('alerte visant le numéro court → alertIds', () => {
  const snaps = snapshotsFromFeed(tu, sa, all)
  expect(by(snaps, T6153).alertIds).toEqual(['QOM:Broadcast::1024865877515074777:LOC'])
  expect(by(snaps, T7853).alertIds).toEqual(['QOM:Broadcast::3926910641521586324:LOC'])
  expect(by(snaps, T5537).alertIds).toEqual([])
})

test('alerte hors période active du jour → non rattachée', () => {
  const copy = structuredClone(sa)
  for (const e of copy.entity as any[]) e.alert.activePeriod = [{ start: '1700000000', end: '1700003600' }]
  expect(snapshotsFromFeed(tu, copy, all).flatMap(s => s.alertIds)).toEqual([])
})

test('cause : titre puis description, en français, sans HTML', () => {
  expect(alertCause(sa, ['QOM:Broadcast::3926910641521586324:LOC'])).toBe(
    'Attention, certaines gares non desservies. Cause : fortes précipitations pluvieuses ou crues affectant les voies et la vitesse des trains à TOULON.')
  expect(alertCause(sa, [])).toBeNull()
})

test('cause : titre gardé quand la description n’en est que la suite, pas de doublon', () => {
  const fr = (text: string) => ({ translation: [{ language: 'de', text: 'x' }, { language: 'fr', text }] })
  const feed = { entity: [
    { id: 'A', alert: { headerText: fr('Actuellement, nous ne sommes pas en mesure d’afficher le retard des trains.'),
      descriptionText: fr('<p>C’est pourquoi, nous vous invitons à consulter régulièrement les informations.<br> </p>') } },
    { id: 'B', alert: { headerText: fr('Travaux à Roeux'), descriptionText: fr('Travaux à Roeux du 17 août au 12 décembre.') } },
    { id: 'C', alert: { headerText: fr('Voitures hors quai') } },
  ] }
  expect(alertCause(feed, ['A'])).toBe('Actuellement, nous ne sommes pas en mesure d’afficher le retard des trains. C’est pourquoi, nous vous invitons à consulter régulièrement les informations.')
  expect(alertCause(feed, ['B'])).toBe('Travaux à Roeux du 17 août au 12 décembre.')
  expect(alertCause(feed, ['C'])).toBe('Voitures hors quai')
})
