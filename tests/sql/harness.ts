// Harnais SQL en mémoire (PGlite) : rôles et privilèges façon Supabase, puis migrations sous test.
import { PGlite } from '@electric-sql/pglite'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Axis } from '../../supabase/functions/_shared/types.ts'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))

// 0006 ne dépend que de 0001 ; les migrations absentes (plans à venir) sont ignorées.
export const MIGRATIONS_UNDER_TEST = [
  '20261020000001_schema.sql',
  '20261020000006_planned_removed.sql',
  '20261021000001_measure_rules.sql',
  '20261021000002_measures.sql',
  '20261021000003_live_trains.sql',
  '20261021000004_revoke_anon_writes.sql',
  '20261021000005_live_trains_compact.sql',
  '20261022000001_daily_stats.sql',
  '20261022000003_live_trains_window.sql',
  '20261026000001_aberrant_and_range.sql',
  '20261027000001_cause_categories.sql',
  '20261028000001_canonical_trains.sql',
  '20261029000001_cause_rules_malveillance.sql',
  '20261107000001_cause_rules_site_notice.sql',
]

const BOOTSTRAP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema if not exists extensions;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

export async function makeDb(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(BOOTSTRAP)
  for (const name of MIGRATIONS_UNDER_TEST) {
    const path = MIGRATIONS_DIR + name
    if (!existsSync(path)) continue
    // pg_cron / pg_net n'existent pas dans PGlite.
    const sql = readFileSync(path, 'utf8').replace(/^\s*create extension[^;]*;/gim, '')
    await db.exec(sql)
  }
  return db
}

export async function resetData(db: PGlite): Promise<void> {
  await db.exec(`truncate trips_planned, stop_times_planned, stops, circulations, events, collector_state, exports restart identity cascade`)
}

export type SeedTrip = {
  serviceDate: string; tripId: string; brand: 'INOUI' | 'OUIGO'; axis: Axis; trainNumber: string
  dep: string; arr: string; removedAt?: string
  circulation?: { cancelled?: boolean; terminusDelayS: number | null; stopDelays?: Record<string, number | 'cancelled'>; cause?: string; lastSeenAt?: string }
  stops?: { seq: number; stopId: string; name: string; lat: number; lon: number; arr: string; dep: string }[]
}

export async function seedTrip(db: PGlite, t: SeedTrip): Promise<void> {
  const first = t.stops?.[0]?.stopId ?? null, last = t.stops?.at(-1)?.stopId ?? null
  await db.query(
    `insert into trips_planned (service_date, trip_id, brand, train_number, axis, origin_stop_id, dest_stop_id, dep_planned, arr_planned, removed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [t.serviceDate, t.tripId, t.brand, t.trainNumber, t.axis, first, last, t.dep, t.arr, t.removedAt ?? null])
  for (const s of t.stops ?? []) {
    await db.query(`insert into stops (stop_id, name, lat, lon) values ($1,$2,$3,$4) on conflict (stop_id) do nothing`,
      [s.stopId, s.name, s.lat, s.lon])
    await db.query(`insert into stop_times_planned (service_date, trip_id, stop_sequence, stop_id, arr_planned, dep_planned) values ($1,$2,$3,$4,$5,$6)`,
      [t.serviceDate, t.tripId, s.seq, s.stopId, s.arr, s.dep])
  }
  const c = t.circulation
  if (!c) return
  const delays = Object.values(c.stopDelays ?? {}).filter((v): v is number => typeof v === 'number')
  if (c.terminusDelayS != null) delays.push(c.terminusDelayS)
  await db.query(
    `insert into circulations (service_date, trip_id, brand, axis, train_number, arr_planned, cancelled, stop_delays, terminus_delay_s, max_delay_s, cause, first_seen_at, last_seen_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [t.serviceDate, t.tripId, t.brand, t.axis, t.trainNumber, t.arr, c.cancelled ?? false, JSON.stringify(c.stopDelays ?? {}),
      c.terminusDelayS, delays.length ? Math.max(...delays) : null, c.cause ?? null, c.lastSeenAt ?? t.dep])
}

export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role anon')
  try { return await fn() } finally { await db.exec('reset role') }
}
