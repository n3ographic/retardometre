import { describe, expect, it } from 'vitest'
import tu from './fixtures/trip-updates.json'
import sa from './fixtures/service-alerts.json'
import { alertTexts, collectChanges, plannedOf, snapshotsFromFeed, type TripContext } from '../supabase/functions/_shared/snapshot.ts'

const DATE = '2026-10-20'
const T5537 = tu.entity[0].id, T6153 = tu.entity[1].id, T7853 = tu.entity[2].id
const A6153 = 'QOM:Broadcast::1024865877515074777:LOC'
const A7853 = 'QOM:Broadcast::3926910641521586324:LOC'

// Horaires prévus (docs/findings/2026-10-20-sondage-flux.md), heure de Paris = UTC+2 ce jour-là.
const I = (u: string) => `StopPoint:OCETGV INOUI-${u}`
const O = (u: string) => `StopPoint:OCEOUIGO-${u}`
const PLAN: Record<string, [string, string, string][]> = {
  [T5537]: [
    [I('87141002'), '12:26', '12:26'], [I('87212027'), '13:29', '13:37'], [I('87182014'), '14:03', '14:06'],
    [I('87182063'), '14:37', '14:41'], [I('87300822'), '15:03', '15:07'], [I('87300863'), '15:30', '15:36'],
    [I('87713040'), '16:04', '16:17'], [I('87713545'), '16:37', '16:40'], [I('87723197'), '17:59', '18:06'],
    [I('87318964'), '19:08', '19:11'], [I('87319012'), '19:32', '19:35'], [I('87751008'), '19:47', '20:01'],
    [I('87755009'), '20:44', '20:48'], [I('87755447'), '21:28', '21:31'], [I('87757526'), '21:45', '21:48'],
    [I('87757625'), '22:10', '22:14'], [I('87757674'), '22:22', '22:25'], [I('87756056'), '22:43', '22:43'],
  ],
  [T6153]: [[I('87686006'), '18:10', '18:10'], [I('87751008'), '21:13', '21:27'], [I('87755009'), '22:10', '22:10']],
  [T7853]: [
    [O('87686006'), '16:10', '16:10'], [O('87763029'), '18:23', '18:28'], [O('87755009'), '20:11', '20:15'],
    [O('87755447'), '20:52', '20:55'], [O('87757625'), '21:32', '21:36'], [O('87757674'), '21:47', '21:51'],
    [O('87756056'), '22:13', '22:13'],
  ],
}
const iso = (hm: string) => new Date(`${DATE}T${hm}:00+02:00`).toISOString()
const ctx = (tripId: string): TripContext => ({
  service_date: DATE, trip_id: tripId, brand: tripId.includes(':OGO:') ? 'OUIGO' : 'INOUI',
  axis: 'SUD_EST', train_number: tripId.match(/^OCESN(\d+)/)![1], arr_planned: iso(PLAN[tripId].at(-1)![1]),
  stops: PLAN[tripId].map(([stop_id, a, d], i) => ({ stop_sequence: i, stop_id, arr_planned: iso(a), dep_planned: iso(d) })),
  circ: null,
})
const IDS = [T5537, T6153, T7853]
const contexts = () => new Map(IDS.map((id) => [`${DATE}|${id}`, ctx(id)]))
const planned = () => new Map(IDS.map((id) => [`${DATE}|${id}`, plannedOf(ctx(id))]))
const range = (from: number, to: number, v: number | 'cancelled') =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), v]))
const by = <T extends { tripId?: string; trip_id?: string }>(xs: T[], id: string) => xs.find((x) => (x.tripId ?? x.trip_id) === id)!

const NOW = '2026-10-20T19:35:00.000Z'
const OBS = new Date(Number(tu.header.timestamp) * 1000).toISOString()
// Contexte où circulations contient déjà le résultat d'un premier passage.
const afterFirstRun = () => {
  const first = collectChanges(snapshotsFromFeed(tu, sa, planned()), contexts(), alertTexts(sa), OBS, NOW)
  const ctxs = contexts()
  for (const c of first.circulations) ctxs.get(`${c.service_date}|${c.trip_id}`)!.circ = c
  return ctxs
}

describe('snapshotsFromFeed (compléments)', () => {
  it('retards attendus sur les trois trajets de la fixture', () => {
    const snaps = snapshotsFromFeed(tu, sa, planned())
    expect(by(snaps, T5537).stopDelays).toEqual({ '0': 0, '1': 0, ...range(2, 17, 4200) })
    expect(by(snaps, T7853).stopDelays).toEqual({ ...range(0, 1, 'cancelled'), ...range(2, 6, 5400) })
  })

  it('time seul au départ du 1er arrêt : écart à dep_planned', () => {
    const feed = structuredClone(tu)
    const u0 = feed.entity[0].tripUpdate.stopTimeUpdate[0] as any
    delete u0.departure.delay
    u0.departure.time = String(Date.parse(iso('12:26')) / 1000 + 90)
    expect(by(snapshotsFromFeed(feed, sa, planned()), T5537).stopDelays['0']).toBe(90)
  })

  it('accepte une alerte visant le trip_id exact', () => {
    const alerts = structuredClone(sa)
    alerts.entity[0].alert.informedEntity = [{ trip: { tripId: T5537 } }]
    const snaps = snapshotsFromFeed(tu, alerts, planned())
    expect(by(snaps, T5537).alertIds).toEqual([A7853])
    expect(by(snaps, T7853).alertIds).toEqual([])
  })
})

describe('dérive du trip_id (dernier segment :AAAAMMJJ)', () => {
  // Le flux RT peut porter une variante de calendrier différente du statique importé.
  const drifted = () => {
    const feed = structuredClone(tu)
    const t = feed.entity[0].tripUpdate.trip
    t.tripId = t.tripId.replace(/:\d{8}$/, ':20261116')
    feed.entity[0].id = t.tripId
    return feed
  }

  it('rattache le trajet RT au trajet planifié et garde le trip_id planifié', () => {
    const feed = drifted()
    expect(feed.entity[0].tripUpdate.trip.tripId).not.toBe(T5537)
    const s = by(snapshotsFromFeed(feed, sa, planned()), T5537)
    expect(s).toBeDefined()
    expect(s.stopDelays).toEqual(by(snapshotsFromFeed(tu, sa, planned()), T5537).stopDelays)
    const { events, circulations } = collectChanges(snapshotsFromFeed(feed, sa, planned()), contexts(), alertTexts(sa), OBS, NOW)
    expect(circulations.map((c) => c.trip_id)).toContain(T5537)
    expect(events.filter((e) => e.kind === 'first_seen').map((e) => e.trip_id)).toContain(T5537)
  })

  it('deux entités RT pour le même trajet planifié : un seul instantané, le trip_id exact gagne', () => {
    for (const exactFirst of [true, false]) {
      const feed = structuredClone(tu)
      const twin = drifted().entity[0] as any
      twin.tripUpdate.timestamp = '9999999999' // plus récent, mais jointure par base seulement
      twin.tripUpdate.stopTimeUpdate.at(-1).arrival.delay = 60
      feed.entity.splice(exactFirst ? 1 : 0, 0, twin)
      const snaps = snapshotsFromFeed(feed, sa, planned())
      expect(snaps.filter((s) => s.tripId === T5537)).toHaveLength(1)
      expect(by(snaps, T5537).stopDelays['17']).toBe(4200)
      const { circulations } = collectChanges(snaps, contexts(), alertTexts(sa), OBS, NOW)
      expect(circulations.filter((c) => c.trip_id === T5537)).toHaveLength(1)
    }
  })

  it('deux entités en dérive pour le même trajet : la plus récente gagne, puis le trip_id le plus petit', () => {
    const a = drifted().entity[0] as any
    const b = structuredClone(a)
    b.tripUpdate.trip.tripId = a.tripUpdate.trip.tripId.replace(/:\d{8}$/, ':20261117')
    b.tripUpdate.stopTimeUpdate.at(-1).arrival.delay = 60
    const run = (x: any, y: any) => by(snapshotsFromFeed({ header: tu.header, entity: [x, y] }, sa, planned()), T5537).stopDelays['17']
    a.tripUpdate.timestamp = '100'; b.tripUpdate.timestamp = '200'
    expect([run(a, b), run(b, a)]).toEqual([60, 60])
    b.tripUpdate.timestamp = '100' // égalité : ':20261116' < ':20261117'
    expect([run(a, b), run(b, a)]).toEqual([4200, 4200])
  })

  it('deux variantes planifiées de même base : choix déterministe (trip_id le plus petit)', () => {
    const variant = T5537.replace(/:\d{8}$/, ':20261101') // < ':20261115'
    for (const order of [[T5537, variant], [variant, T5537]]) {
      const p = new Map(order.map((id) => [`${DATE}|${id}`, { ...plannedOf(ctx(T5537)), tripId: id }]))
      expect(snapshotsFromFeed(drifted(), sa, p).map((s) => s.tripId)).toEqual([variant])
    }
  })

  it('réimport en cours de journée : la variante déjà observée garde la circulation', () => {
    // Le statique remplace ':20261115' par ':20261117' ; le flux RT suit la nouvelle variante.
    const next = T5537.replace(/:\d{8}$/, ':20261117')
    const ctxs = afterFirstRun()
    ctxs.set(`${DATE}|${next}`, { ...ctx(T5537), trip_id: next })
    const p = new Map([...ctxs].map(([k, c]) => [k, plannedOf(c)]))
    const feed = structuredClone(tu)
    feed.entity[0].tripUpdate.trip.tripId = next
    ;(feed.entity[0].tripUpdate.stopTimeUpdate.at(-1) as any).arrival.delay = 4500
    const snaps = snapshotsFromFeed(feed, sa, p)
    expect(snaps.map((s) => s.tripId)).not.toContain(next)
    const { events, circulations } = collectChanges(snaps, ctxs, alertTexts(sa), OBS, NOW)
    expect(circulations.map((c) => c.trip_id)).not.toContain(next)
    expect(by(circulations, T5537).terminus_delay_s).toBe(4500)
    expect(events.filter((e) => e.kind === 'first_seen')).toEqual([])
  })

  it('le préfixe seul ne suffit pas : un autre trajet reste ignoré', () => {
    const feed = drifted()
    feed.entity[0].tripUpdate.trip.tripId = T5537.replace(':18:2243:', ':18:2244:')
    expect(snapshotsFromFeed(feed, sa, planned()).map((s) => s.tripId)).toEqual([T6153, T7853])
  })
})

describe('alertTexts', () => {
  it('sans description : titre français', () => {
    const alerts = structuredClone(sa)
    delete (alerts.entity[0].alert as any).descriptionText
    expect(alertTexts(alerts).get(A7853)).toBe('Attention, certaines gares non desservies')
  })
})

describe('collectChanges', () => {
  it('première observation : first_seen et lignes circulations complètes', () => {
    const { events, circulations } = collectChanges(snapshotsFromFeed(tu, sa, planned()), contexts(), alertTexts(sa), OBS, NOW)
    expect(events.filter((e) => e.kind === 'first_seen')).toHaveLength(3)
    expect(events.every((e) => e.observed_at === OBS)).toBe(true)
    const c7853 = by(circulations, T7853)
    expect(c7853).toMatchObject({
      service_date: DATE, brand: 'OUIGO', axis: 'SUD_EST', train_number: '7853', arr_planned: iso('22:13'),
      cancelled: false, terminus_delay_s: 5400, max_delay_s: 5400, alert_ids: [A7853],
      first_seen_at: NOW, last_seen_at: NOW,
    })
    expect(c7853.cause).toMatch(/^Attention, certaines gares non desservies\. Cause : fortes précipitations/)
    expect(by(circulations, T6153)).toMatchObject({ cancelled: true, alert_ids: [A6153], terminus_delay_s: null, max_delay_s: null })
  })

  it('rejouer le même flux ne crée aucun événement ; first_seen_at conservé', () => {
    const later = '2026-10-20T19:37:00.000Z'
    const again = collectChanges(snapshotsFromFeed(tu, sa, planned()), afterFirstRun(), alertTexts(sa), OBS, later)
    expect(again.events).toEqual([])
    expect(by(again.circulations, T7853)).toMatchObject({ first_seen_at: NOW, last_seen_at: later })
  })

  it("arrêts passés sortis du flux : conservés, sans événement parasite", () => {
    const feed = structuredClone(tu)
    const stus = feed.entity[0].tripUpdate.stopTimeUpdate as any[]
    stus.splice(0, 5)
    stus.at(-1).arrival.delay = 4500
    const { events, circulations } = collectChanges(snapshotsFromFeed(feed, sa, planned()), afterFirstRun(), alertTexts(sa), OBS, NOW)
    expect(events.map((e) => [e.kind, e.stop_sequence, e.value])).toEqual([['delay', 17, { from_s: 4200, delay_s: 4500 }]])
    const c = by(circulations, T5537)
    expect(c.stop_delays).toEqual({ '0': 0, '1': 0, ...range(2, 16, 4200), '17': 4500 })
    expect(c).toMatchObject({ terminus_delay_s: 4500, max_delay_s: 4500 })
  })

  it('max_delay_s garde le maximum déjà vu si le retard baisse', () => {
    const ctxs = afterFirstRun()
    const feed = structuredClone(tu)
    for (const u of feed.entity[0].tripUpdate.stopTimeUpdate as any[]) {
      if (u.arrival) u.arrival.delay = 600
      if (u.departure) u.departure.delay = 600
    }
    const c = by(collectChanges(snapshotsFromFeed(feed, sa, planned()), ctxs, alertTexts(sa), OBS, NOW).circulations, T5537)
    expect(c).toMatchObject({ terminus_delay_s: 600, max_delay_s: 4200 })
  })
})
