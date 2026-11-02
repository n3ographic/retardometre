// Précalcul des gares et distances de l'axe Atlantique pour le diagramme de Marey (vue F3).
// Usage : npm run build:marey  — lit SUPABASE_URL et SUPABASE_ANON_KEY (clé publique) dans l'environnement.
// Écrit web/public/marey-axes.json à partir de l'horaire du dernier jour disponible et des tracés de trace-paires.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildBranches, type MareyStop, type MareyTrip } from './lib/marey-axes.ts'
import type { Lngl } from './lib/rail-graph.ts'

const AXE = 'ATLANTIQUE'
const OUT = 'web/public/marey-axes.json'
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY
if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_ANON_KEY requis (clé publique)')

async function get<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  for (let o = 0; ; o += 1000) {
    const r = await fetch(`${url}/rest/v1/${path}&limit=1000&offset=${o}`, { headers: { apikey: key! } })
    if (!r.ok) throw new Error(`${path} : ${r.status}`)
    const p = (await r.json()) as T[]
    rows.push(...p)
    if (p.length < 1000) return rows
  }
}

const [{ service_date }] = await get<{ service_date: string }>(`trips_planned?select=service_date&axis=eq.${AXE}&order=service_date.desc`).then((r) => r.slice(0, 1))
const trips = await get<{ trip_id: string }>(`trips_planned?select=trip_id&axis=eq.${AXE}&service_date=eq.${service_date}&removed_at=is.null&order=trip_id`)
const ids = new Set(trips.map((t) => t.trip_id))
const times = (await get<{ trip_id: string; stop_sequence: number; stop_id: string }>(`stop_times_planned?select=trip_id,stop_sequence,stop_id&service_date=eq.${service_date}&order=trip_id,stop_sequence`)).filter((t) => ids.has(t.trip_id))
const stops = new Map((await get<MareyStop>('stops?select=stop_id,name,lat,lon&order=stop_id')).map((s) => [s.stop_id, s]))

const byTrip = new Map<string, MareyStop[]>()
for (const t of times) {
  const s = stops.get(t.stop_id)
  if (s?.lat == null || s?.lon == null) continue
  byTrip.set(t.trip_id, [...(byTrip.get(t.trip_id) ?? []), s])
}
const pairs = (JSON.parse(readFileSync('web/public/trace-paires.json', 'utf8')) as { pairs: Record<string, Lngl[]> }).pairs
const all: MareyTrip[] = [...byTrip].map(([trip_id, s]) => ({ trip_id, stops: s }))
const branches = buildBranches(all, pairs)

writeFileSync(OUT, JSON.stringify({ version: 1, axe: AXE, generated_at: new Date().toISOString(), service_date, branches }) + '\n')
for (const b of branches) for (const l of b.lignes) console.log(`${b.label} → ${l.label} : ${l.gares.length} gares, ${l.gares.at(-1)?.km ?? 0} km`)
console.log(`${all.length} trains lus, écrit ${OUT}`)
