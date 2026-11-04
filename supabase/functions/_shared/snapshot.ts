// Passage flux décodé -> instantanés -> événements et lignes circulations. TS pur (Node et Deno).
import { serviceDateOf } from './classify.ts'
import { diffTrip } from './diff.ts'
import type { Axis, Brand, CirculationRow, DecodedFeed, EventRow, PlannedStopTimes, TripSnapshot } from './types.ts'

const CANCELED = 3 // TripDescriptor.ScheduleRelationship
const SKIPPED = 1 // StopTimeUpdate.ScheduleRelationship

// protobufjs : un champ absent n'est pas une propriété propre (voir docs/findings).
const own = (o: any, k: string) => o != null && Object.hasOwn(o, k)
// Id court des alertes : « OCESN6153F » pour « OCESN6153F1187_F:OUI:… ».
const shortId = (tripId: string) => tripId.match(/^OCE[A-Z]+\d+[A-Z]/)?.[0] ?? tripId

// Retard d'un arrêt : arrival.delay, sinon arrival.time − arrivée prévue, puis idem au départ.
function stopDelay(u: any, seq: string, p: PlannedStopTimes): number | null {
  for (const [ev, planned] of [['arrival', p.arrPlanned[seq]], ['departure', p.depPlanned[seq]]] as const) {
    const e = u[ev]
    if (own(e, 'delay')) return Number(e.delay)
    if (own(e, 'time') && planned) return Number(e.time) - Date.parse(planned) / 1000
  }
  return null
}

function isActive(alert: any, t: number): boolean {
  const periods: any[] = alert.activePeriod ?? []
  return periods.length === 0 || periods.some((p) =>
    (!own(p, 'start') || Number(p.start) <= t) && (!own(p, 'end') || Number(p.end) >= t))
}

// Ids d'alertes actives à l'instant t, indexés par trip_id visé (court ou exact), ordre du flux.
function alertsByTrip(alerts: DecodedFeed, t: number): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const e of alerts.entity ?? []) {
    if (!e.alert || !isActive(e.alert, t)) continue
    for (const ie of e.alert.informedEntity ?? []) {
      const id = ie.trip?.tripId
      if (!id) continue
      const ids = m.get(id) ?? []
      if (!ids.includes(e.id)) ids.push(e.id)
      m.set(id, ids)
    }
  }
  return m
}

// trip_id sans son dernier segment :AAAAMMJJ (variante de calendrier, peut différer RT/statique).
export const baseTripId = (tripId: string) => tripId.replace(/:[0-9]{8}$/, '')

// Clé `${serviceDate}|${tripId}` ; trajets absents de planned et arrêts hors plan ignorés.
// Jointure exacte d'abord, sinon sur baseTripId ; l'instantané porte le trip_id planifié.
// Un seul instantané par trajet planifié : exact > base, puis trip_update.timestamp le plus récent,
// puis trip_id RT le plus petit. Entre deux variantes planifiées de même base : le trip_id le plus petit.
// Une variante déjà observée l'emporte sur tout : un réimport du statique en cours de journée
// ne doit pas ouvrir une seconde ligne circulations pour le même train.
export function snapshotsFromFeed(feed: DecodedFeed, alerts: DecodedFeed, planned: Map<string, PlannedStopTimes>): TripSnapshot[] {
  const byTrip = alertsByTrip(alerts, Number(feed.header?.timestamp))
  const byBase = new Map<string, PlannedStopTimes>()
  const seenByBase = new Map<string, PlannedStopTimes>()
  for (const p of [...planned.values()].sort((a, b) => (a.tripId < b.tripId ? -1 : 1))) {
    const k = `${p.serviceDate}|${baseTripId(p.tripId)}`
    if (!byBase.has(k)) byBase.set(k, p)
    if (p.observed && !seenByBase.has(k)) seenByBase.set(k, p)
  }
  type Pick = { snap: TripSnapshot; exact: boolean; ts: number; rtTripId: string }
  const better = (a: Pick, b: Pick) =>
    a.exact !== b.exact ? a.exact : a.ts !== b.ts ? a.ts > b.ts : a.rtTripId < b.rtTripId
  const picks = new Map<string, Pick>()
  for (const e of feed.entity ?? []) {
    const tu = e.tripUpdate
    // Une entité mal formée ne doit pas faire échouer tout le passage.
    if (!tu?.trip?.tripId || !/^\d{8}$/.test(tu.trip.startDate ?? '')) continue
    const serviceDate = serviceDateOf(tu.trip.startDate)
    const rtTripId: string = tu.trip.tripId
    const exactP = planned.get(`${serviceDate}|${rtTripId}`)
    const base = `${serviceDate}|${baseTripId(rtTripId)}`
    const p = seenByBase.get(base) ?? exactP ?? byBase.get(base)
    if (!p) continue
    const tripId = p.tripId
    const stopDelays: TripSnapshot['stopDelays'] = {}
    for (const u of tu.stopTimeUpdate ?? []) {
      const seq = p.stopSeqById[u.stopId]
      if (seq === undefined) continue
      const k = String(seq)
      if (u.scheduleRelationship === SKIPPED) stopDelays[k] = 'cancelled'
      else {
        const d = stopDelay(u, k, p)
        if (d !== null) stopDelays[k] = d
      }
    }
    const alertIds = [...new Set([...(byTrip.get(rtTripId) ?? []), ...(byTrip.get(tripId) ?? []), ...(byTrip.get(shortId(rtTripId)) ?? [])])]
    const pick: Pick = {
      snap: { serviceDate, tripId, cancelled: tu.trip.scheduleRelationship === CANCELED, stopDelays, alertIds },
      exact: p === exactP, ts: Number(tu.timestamp ?? 0), rtTripId,
    }
    const key = `${serviceDate}|${tripId}`
    const cur = picks.get(key)
    if (!cur || better(pick, cur)) picks.set(key, pick)
  }
  return [...picks.values()].map((x) => x.snap)
}

const tr = (ts: any): string | null => {
  const list: any[] = ts?.translation ?? []
  const t = list.find((x) => x.language === 'fr') ?? list[0]
  const text = t?.text?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text || null
}

// alert id -> texte : titre fr puis description fr, sans HTML. Le titre porte souvent le sens et la description
// n'en est que la suite (« Actuellement, nous ne sommes pas en mesure… » / « C'est pourquoi, nous vous invitons… »).
export function alertTexts(alerts: DecodedFeed): Map<string, string> {
  const m = new Map<string, string>()
  for (const e of alerts.entity ?? []) {
    if (!e.alert) continue
    const h = tr(e.alert.headerText), d = tr(e.alert.descriptionText)
    const text = h && d && !d.startsWith(h) ? `${h}${/[.!?:…]$/.test(h) ? '' : '.'} ${d}` : (d ?? h)
    if (text) m.set(e.id, text)
  }
  return m
}

// Trajet planifié, ses arrêts et sa ligne circulations courante (renvoyés par collector_context).
export interface TripContext {
  service_date: string
  trip_id: string
  brand: Brand
  axis: Axis
  train_number: string
  arr_planned: string | null
  stops: { stop_sequence: number; stop_id: string | null; arr_planned: string | null; dep_planned: string | null }[]
  circ: CirculationRow | null
}

export function plannedOf(c: TripContext): PlannedStopTimes {
  const p: PlannedStopTimes = { serviceDate: c.service_date, tripId: c.trip_id, arrPlanned: {}, depPlanned: {}, stopSeqById: {}, observed: c.circ !== null }
  for (const s of c.stops) {
    const k = String(s.stop_sequence)
    if (s.arr_planned) p.arrPlanned[k] = s.arr_planned
    if (s.dep_planned) p.depPlanned[k] = s.dep_planned
    if (s.stop_id) p.stopSeqById[s.stop_id] = s.stop_sequence
  }
  return p
}

// Texte de la dernière alerte (ordre de alertIds) qui en a un, sinon null.
export function alertCause(alerts: DecodedFeed | Map<string, string>, alertIds: string[]): string | null {
  const texts = alerts instanceof Map ? alerts : alertTexts(alerts)
  for (let i = alertIds.length - 1; i >= 0; i--) {
    const t = texts.get(alertIds[i])
    if (t) return t
  }
  return null
}

// Événements à insérer et lignes circulations à upserter. Le flux oublie les arrêts passés :
// on fusionne avec stop_delays stocké avant de comparer, pour ne rien inventer.
export function collectChanges(
  snaps: TripSnapshot[], contexts: Map<string, TripContext>, texts: Map<string, string>,
  observedAt: string, now: string,
): { events: EventRow[]; circulations: CirculationRow[] } {
  const events: EventRow[] = []
  const circulations: CirculationRow[] = []
  for (const snap of snaps) {
    const c = contexts.get(`${snap.serviceDate}|${snap.tripId}`)
    if (!c) continue
    const row = c.circ
    const prev: TripSnapshot | null = row &&
      { serviceDate: row.service_date, tripId: row.trip_id, cancelled: row.cancelled, stopDelays: row.stop_delays, alertIds: row.alert_ids }
    const next = { ...snap, stopDelays: { ...prev?.stopDelays, ...snap.stopDelays } }
    events.push(...diffTrip(prev, next, observedAt))

    const nums = Object.values(next.stopDelays).filter((d): d is number => typeof d === 'number')
    const maxNow = nums.length ? Math.max(...nums) : null
    const max = row?.max_delay_s != null && (maxNow === null || row.max_delay_s > maxNow) ? row.max_delay_s : maxNow
    const terminus = next.stopDelays[String(Math.max(-1, ...c.stops.map((s) => s.stop_sequence)))]
    circulations.push({
      service_date: c.service_date, trip_id: c.trip_id, brand: c.brand, axis: c.axis,
      train_number: c.train_number, arr_planned: c.arr_planned,
      cancelled: next.cancelled, stop_delays: next.stopDelays,
      terminus_delay_s: typeof terminus === 'number' ? terminus : null,
      max_delay_s: max, alert_ids: next.alertIds,
      cause: alertCause(texts, next.alertIds) ?? row?.cause ?? null,
      first_seen_at: row?.first_seen_at ?? now, last_seen_at: now,
    })
  }
  return { events, circulations }
}
