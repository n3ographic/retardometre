// Calque « vitesse maximale nominale » de la carte : lignes du RFN parcourues par les TGV observés.
// Usage : npm run build:vitesses  — lit web/public/trace-paires.json (lancer build:traces avant si les tracés changent).
// Écrit web/public/vitesses-lignes.json ; le jeu SNCF Réseau est gardé dans tmp/ (git-ignoré).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { selectLines, toWebFeatures, type VmaxFeature } from './lib/vitesses.ts'
import type { Lngl } from './lib/rail-graph.ts'

const SOURCE = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/vitesse-maximale-nominale-sur-ligne/exports/geojson'
const META = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/vitesse-maximale-nominale-sur-ligne'
const CACHE = 'tmp/vitesse-maximale.geojson'
const TRACES = 'web/public/trace-paires.json'
const OUT = 'web/public/vitesses-lignes.json'

if (!existsSync(CACHE)) {
  mkdirSync('tmp', { recursive: true })
  console.log('téléchargement des vitesses maximales…')
  const r = await fetch(SOURCE, { signal: AbortSignal.timeout(300_000) }) // 5 min : échoue au lieu de bloquer
  if (!r.ok) throw new Error(`vitesses maximales : ${r.status}`)
  writeFileSync(CACHE, Buffer.from(await r.arrayBuffer()))
}
// Date des données (pas du traitement) : affichée sur la carte, la source n'est pas tenue à jour en continu.
const meta = (await (await fetch(META, { signal: AbortSignal.timeout(60_000) })).json()) as { metas?: { default?: { modified?: string } } }
const modified = meta.metas?.default?.modified?.slice(0, 10) ?? null

const features = (JSON.parse(readFileSync(CACHE, 'utf8')) as { features: VmaxFeature[] }).features
const traces = Object.values((JSON.parse(readFileSync(TRACES, 'utf8')) as { pairs: Record<string, Lngl[]> }).pairs)
const keep = selectLines(features, traces)
const fc = toWebFeatures(features, keep)

const file = { version: 1, source: 'SNCF Réseau, Vitesse maximale nominale sur ligne (ODbL)', modified, generated_at: new Date().toISOString(), ...fc }
writeFileSync(OUT, JSON.stringify(file))
const lines = new Set(features.map((f) => f.properties.code_ligne))
console.log(`${features.length} tronçons, ${lines.size} lignes dans la source (données du ${modified ?? '?'})`)
console.log(`${keep.size} lignes gardées (longées par les tracés TGV), ${fc.features.length} sections`)
console.log(`fichier : ${(statSync(OUT).size / 1024).toFixed(0)} Ko`)
