// Performance des fonctions appelées par le site, mesurée comme le site les appelle : RPC PostgREST avec la clé anon,
// sur la base réelle. Lancé à part (npm run test:perf) : il lit web/.env.local et ne tourne pas avec npm test.
// À lancer avant d'appliquer une migration qui touche l'une de ces fonctions (le 04/11/2026, stats_period à 6,2 s
// en anon a mis /api/stats en 502).
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const MAX_MS = 2000
const env = (() => {
  const file = new URL('../web/.env.local', import.meta.url)
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter((m) => m !== null)
    .map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]))
})() as Record<string, string>
const url = process.env.SUPABASE_URL ?? env.SUPABASE_URL
const key = process.env.SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY
const run = process.env.PERF === '1' && !!url && !!key

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const iso = (offsetH: number) => new Date(Date.now() + offsetH * 3_600_000).toISOString()

async function rpc(fn: string, args: Record<string, unknown>): Promise<number> {
  const t0 = performance.now()
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: key!, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  })
  await r.arrayBuffer()
  expect(r.status, `${fn} : HTTP ${r.status}`).toBe(200)
  return performance.now() - t0
}

test.skipIf(!run).each([
  ['stats_period sur 31 jours', 'stats_period', () => ({ p_from: day(-31), p_to: day(-1) })],
  ['stats_period du jour', 'stats_period', () => ({ p_from: day(0), p_to: day(0) })],
  ['cumul_totals', 'cumul_totals', () => ({})],
  ['live_trains', 'live_trains', () => ({})],
  ['marey_trains sur 12 h', 'marey_trains', () => ({ p_axis: 'SUD_EST', p_from: iso(-6), p_to: iso(6) })],
] as const)(`%s en anon : moins de ${MAX_MS} ms`, async (_label, fn, args) => {
  const ms = await rpc(fn, args())
  console.log(`${fn} : ${Math.round(ms)} ms`)
  expect(ms).toBeLessThan(MAX_MS)
}, 30_000)
