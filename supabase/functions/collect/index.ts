// Collecteur GTFS-RT SNCF, appelé toutes les 2 min par pg_cron. N'écrit que des changements.
import GtfsRealtimeBindings from 'npm:gtfs-realtime-bindings@1.1.1'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { alertTexts, collectChanges, plannedOf, snapshotsFromFeed, type TripContext } from '../_shared/snapshot.ts'
import type { PlannedStopTimes } from '../_shared/types.ts'
import { runWarning } from '../_shared/health.ts'

const { FeedMessage, FeedEntity } = GtfsRealtimeBindings.transit_realtime
const TU_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-trip-updates'
const SA_URL = 'https://proxy.transport.data.gouv.fr/resource/sncf-gtfs-rt-service-alerts'
const TGV = /:(OUI|OGO):/
const TO_OBJECT = { longs: String }

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const setError = (msg: string) => db.from('collector_state').upsert({ id: 1, last_error: msg.slice(0, 1000) })

async function fetchFeed(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`)
  return FeedMessage.decode(new Uint8Array(await res.arrayBuffer()))
}

Deno.serve(async (req) => {
  const { data: authorized, error: authError } = await db.rpc('collector_secret_ok', {
    candidate: req.headers.get('x-collector-secret') ?? '',
  })
  if (authError) return json({ error: 'vérification du secret impossible' }, 500)
  if (authorized !== true) return json({ error: 'unauthorized' }, 401)

  // Flux indisponible ou illisible : seul last_error est écrit.
  let tu, sa
  try {
    ;[tu, sa] = await Promise.all([fetchFeed(TU_URL), fetchFeed(SA_URL)])
    if (!Number(tu.header?.timestamp)) throw new Error('Trip Updates : header.timestamp absent')
  } catch (e) {
    const msg = `flux : ${(e as Error).message}`
    await setError(msg)
    return json({ error: msg }, 502)
  }

  const fail = async (step: string, e: { message: string }) => {
    const msg = `${step} : ${e.message}`
    await setError(msg)
    return json({ error: msg }, 500)
  }

  const feedTs = Number(tu.header.timestamp)
  const now = new Date().toISOString()
  const { data: state, error: stateError } = await db.from('collector_state').select('last_feed_ts').eq('id', 1).maybeSingle()
  if (stateError) return fail('collector_state', stateError)
  // Flux figé, ou plus ancien qu'un flux déjà appliqué : rien à écrire (même règle que collector_apply).
  // Seul last_run_at est touché : la supervision distingue « cron arrêté » de « flux figé ».
  const prevFeedTs = state?.last_feed_ts == null ? null : Number(state.last_feed_ts)
  if (prevFeedTs != null && feedTs <= prevFeedTs) {
    const { error: touchError } = await db.from('collector_state').update({ last_run_at: now }).eq('id', 1)
    if (touchError) return fail('collector_state', touchError)
    return json({ trips: 0, events: 0, skipped: 'stale' })
  }

  // Décodage objet limité aux TGV (marque lisible dans le trip_id) pour épargner le CPU.
  const feed = {
    header: { timestamp: String(feedTs) },
    entity: tu.entity.filter((e) => TGV.test(e.tripUpdate?.trip?.tripId ?? '')).map((e) => FeedEntity.toObject(e, TO_OBJECT)),
  }
  const alerts = FeedMessage.toObject(sa, TO_OBJECT)

  const keys = feed.entity.flatMap((e: any) => {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(e.tripUpdate?.trip?.startDate ?? '')
    return m ? [[`${m[1]}-${m[2]}-${m[3]}`, e.tripUpdate.trip.tripId]] : []
  })
  // Les deux lectures sont indépendantes : lancées ensemble.
  const parisToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  const [{ data: rows, error: ctxError }, { count: plannedToday, error: countError }] = await Promise.all([
    db.rpc('collector_context', {
      p_service_dates: keys.map((k) => k[0]),
      p_trip_ids: keys.map((k) => k[1]),
    }),
    db.from('trips_planned')
      .select('trip_id', { count: 'exact', head: true }).eq('service_date', parisToday).is('removed_at', null),
  ])
  if (ctxError) return fail('collector_context', ctxError)
  if (countError) return fail('trips_planned', countError)

  const contexts = new Map<string, TripContext>()
  const planned = new Map<string, PlannedStopTimes>()
  for (const c of rows as TripContext[]) {
    const k = `${c.service_date}|${c.trip_id}`
    contexts.set(k, c)
    planned.set(k, plannedOf(c))
  }

  const snaps = snapshotsFromFeed(feed, alerts, planned)
  const { events, circulations } = collectChanges(snaps, contexts, alertTexts(alerts), new Date(feedTs * 1000).toISOString(), now)

  const tgvEntities = feed.entity.length
  const warning = runWarning({ tgvEntities, matched: snaps.length, plannedToday: plannedToday ?? 0 })
  console.log(`collect : ${tgvEntities} entités TGV, ${snaps.length} rapprochées du plan${warning ? ` ; ${warning}` : ''}`)

  // Une seule transaction : events, circulations, collector_state (voir migration collector_apply).
  const { data: applied, error } = await db.rpc('collector_apply', {
    p_events: events, p_circs: circulations, p_feed_ts: feedTs, p_now: now,
    p_prev_feed_ts: prevFeedTs, p_warning: warning,
  })
  if (error) return fail('collector_apply', error)
  if (applied === 'stale' || applied === 'conflict') return json({ trips: 0, events: 0, tgv_entities: tgvEntities, skipped: applied })

  return json({ trips: circulations.length, events: events.length, tgv_entities: tgvEntities, matched: snaps.length, warning })
})
