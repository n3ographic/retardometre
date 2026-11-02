import { haversineM, type Lngl } from './rail-graph.ts'
import { pairKey } from './pair-key.ts'

export type MareyStop = { stop_id: string; name: string; lat: number; lon: number }
export type MareyTrip = { trip_id: string; stops: MareyStop[] } // arrêts dans l'ordre de circulation

export type BranchConfig = { id: string; label: string; via: string[] }
// Une gare peut avoir plusieurs stop_id (quai, voie) : elle est identifiée par son nom.
export type MareyGare = { nom: string; km: number; stop_ids: string[] }
export type MareyLine = { id: string; label: string; gares: MareyGare[] }
export type MareyBranch = { id: string; label: string; lignes: MareyLine[] }

// Atlantique est un arbre : tronc Paris → Le Mans, puis trois branches. Le premier groupe dont une gare figure
// sur le parcours gagne (l'ordre compte : Angers et Sablé avant Laval, Rennes avant Tours).
export const ATLANTIQUE_BRANCHES: BranchConfig[] = [
  { id: 'pays-de-la-loire', label: 'Pays de la Loire', via: ['Angers Saint-Laud', 'Sablé-sur-Sarthe', 'Nantes', 'La Roche-sur-Yon'] },
  { id: 'bretagne', label: 'Bretagne', via: ['Rennes', 'Laval', 'Vitré'] },
  { id: 'sud-ouest', label: 'Sud-Ouest', via: ['Saint-Pierre-des-Corps', 'Tours', 'Vendôme - Villiers-sur-Loir', 'Poitiers', 'Massy TGV'] },
]
const HUB = 'Paris Montparnasse'

// Parcours orienté Paris → province ; null si Paris n'est pas une extrémité (ces trains n'ont pas de place sur l'axe).
export function orient(stops: MareyStop[]): MareyStop[] | null {
  if (stops.length < 2) return null
  if (stops[0].name.startsWith(HUB)) return stops
  if (stops[stops.length - 1].name.startsWith(HUB)) return [...stops].reverse()
  return null
}

export function branchOf(stops: MareyStop[], branches: BranchConfig[] = ATLANTIQUE_BRANCHES): string | null {
  const names = new Set(stops.map((s) => s.name))
  return branches.find((b) => b.via.some((v) => names.has(v)))?.id ?? null
}

const polyM = (line: Lngl[]) => line.slice(1).reduce((m, p, i) => m + haversineM(line[i], p), 0)

// Longueur d'un tronçon entre deux arrêts : tracé précalculé si la paire est connue, sinon ligne droite.
// ponytail: un tracé plus de 1,3 fois plus long que la ligne droite est un détour du graphe (ex. Angers → Nantes
// donnait 245 km pour 88) : on prend alors la ligne droite × 1,1. À corriger dans build:traces si ça se répète.
export const MAX_DETOUR = 1.3
export const STRAIGHT_FACTOR = 1.1
export const ON_PATH = 1.05
export function segmentM(a: MareyStop, b: MareyStop, pairs: Record<string, Lngl[]>): number {
  const pa: Lngl = [a.lon, a.lat], pb: Lngl = [b.lon, b.lat]
  const straight = haversineM(pa, pb)
  const line = pairs[pairKey(pa, pb)]
  const traced = line ? polyM([pa, ...line, pb]) : null
  return traced !== null && traced <= straight * MAX_DETOUR ? traced : straight * STRAIGHT_FACTOR
}

// Même réduction que marey_trains() : les 8 derniers caractères du stop_id (code UIC).
export const uic = (stop_id: string) => stop_id.slice(-8)

const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const slug = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Lignes de chaque branche : une par terminus, gares réellement desservies en séquence, tronc commun répété.
// Une ligne dont les gares sont toutes sur une ligne plus longue y est fusionnée (Paris → Nantes dans Paris → Le Croisic).
// km = distance médiane depuis Paris le long de la voie, calculée sur les trains qui tiennent dans la ligne.
export function buildBranches(trips: MareyTrip[], pairs: Record<string, Lngl[]>, config: BranchConfig[] = ATLANTIQUE_BRANCHES): MareyBranch[] {
  type Run = { names: string[]; kms: number[]; ids: string[] }
  const runs = new Map<string, Run[]>(config.map((b) => [b.id, []]))
  const where = new Map<string, Lngl>()
  for (const trip of trips) {
    const stops = orient(trip.stops)
    const id = stops && branchOf(stops, config)
    if (!stops || !id) continue
    let km = 0
    const kms = stops.map((s, i) => (km += i > 0 ? segmentM(stops[i - 1], s, pairs) / 1000 : 0))
    for (const s of stops) where.set(s.name, [s.lon, s.lat])
    runs.get(id)!.push({ names: stops.map((s) => s.name), kms, ids: stops.map((s) => uic(s.stop_id)) })
  }
  return config.map((b) => {
    const rs = runs.get(b.id)!
    const kmAll = new Map<string, number[]>()
    for (const r of rs) r.names.forEach((n, i) => kmAll.set(n, [...(kmAll.get(n) ?? []), r.kms[i]]))
    const order = (set: Set<string>) => [...set].sort((x, y) => median(kmAll.get(x)!) - median(kmAll.get(y)!))
    // Une gare est sur le chemin d'une ligne si l'insérer entre deux gares consécutives allonge le trajet de moins de 5 % (Niort, sur la ligne de La Rochelle, est à 12 % de Poitiers–Bordeaux).
    const onPath = (n: string, line: Set<string>) => {
      const seq = order(line), p = where.get(n)!
      return seq.slice(1).some((q, i) => {
        const a = where.get(seq[i])!, c = where.get(q)!
        return haversineM(a, p) + haversineM(p, c) <= ON_PATH * haversineM(a, c)
      })
    }
    const byEnd = new Map<string, Set<string>>()
    for (const r of rs) {
      const end = r.names[r.names.length - 1]
      byEnd.set(end, new Set([...(byEnd.get(end) ?? []), ...r.names]))
    }
    const kept: [string, Set<string>][] = []
    for (const [end, set] of [...byEnd].sort((x, y) => y[1].size - x[1].size)) {
      const host = kept.find(([, k]) => [...set].every((n) => k.has(n) || onPath(n, k)))
      if (host) for (const n of set) host[1].add(n)
      else kept.push([end, new Set(set)])
    }
    // Tronc répété en entier : chaque ligne reprend les gares des autres lignes situées sur son chemin,
    // puis une ligne devenue contenue dans une autre disparaît (Paris → Bordeaux dans Paris → Hendaye).
    const every = new Set(kept.flatMap(([, k]) => [...k]))
    for (const [, k] of kept) {
      const base = new Set(k)
      for (const n of every) if (!k.has(n) && onPath(n, base)) k.add(n)
    }
    const lines = kept.filter(([, k], i) => !kept.some(([, o], j) => j !== i && o.size > k.size && [...k].every((n) => o.has(n))))
    const lignes = lines.map(([end, set]) => {
      const acc = new Map<string, { ids: Set<string>; kms: number[] }>()
      const fits = rs.filter((r) => r.names.every((n) => set.has(n)))
      for (const r of fits) r.names.forEach((n, i) => {
        const g = acc.get(n) ?? { ids: new Set<string>(), kms: [] }
        g.ids.add(r.ids[i])
        g.kms.push(r.kms[i])
        acc.set(n, g)
      })
      const gares = [...acc].map(([nom, g]) => ({ nom, km: Math.round(median(g.kms) * 10) / 10, stop_ids: [...g.ids].sort() })).sort((x, y) => x.km - y.km)
      return { id: slug(end), label: end, gares, trains: fits.length }
    }).sort((x, y) => y.trains - x.trains).map(({ trains: _, ...l }) => l)
    return { id: b.id, label: b.label, lignes }
  })
}
