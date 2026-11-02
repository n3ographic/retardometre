import type { Line, MareyTrain } from './marey';

// Construction automatique des vues du diagramme de Marey à partir des dessertes réelles des trains de la fenêtre :
// une ligne par terminus (deux sens confondus), branches de niveau 1 par gare de divergence, aucune liste de gares codée en dur
// pour la structure (seuls les noms de branches viennent de BRANCH_NAMES).

export type Gare = { nom: string; lat: number; lon: number };
export type Gares = Record<string, Gare>; // code UIC → gare
export type BuiltLine = Line & { trains: number; own: string[] }; // own = gares desservies par les trains de ce terminus
export type Branch = { id: string; label: string; lignes: BuiltLine[]; autres: BuiltLine[] };
export type Built = { branches: Branch[]; warnings: string[] };

export const MIN_TRAINS = 3; // destination masquée (rangée dans AUTRES) sous ce nombre de trains dans la fenêtre
// Tronc repris gare par gare si l'insérer allonge le trajet direct de moins de 8 km ou 5 %.
// Mesuré sur l'Atlantique : gares voulues ≤ 7 km de détour chacune (Libourne, Sablé), Niort ou Saint-Maixent ≥ 11 km.
export const PATH_KM = 8;
export const PATH_PCT = 0.05;
const SAME_PLACE_KM = 3;
const PARIS: [number, number] = [2.3488, 48.8534];
const IDF_KM = 60;

const R = 6371;
export function distKm(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Noms des branches (étiquettes seulement : le découpage est automatique). Une branche prend les noms dont un terminus
// figure parmi les siens ; aucun nom trouvé : « VIA » + sa première gare propre.
export const BRANCH_NAMES: [string, string[]][] = [
  ['PAYS DE LA LOIRE', ['Nantes', 'Le Croisic', "Les Sables-d'Olonne", 'Saint-Nazaire', 'Angers Saint-Laud']],
  ['BRETAGNE', ['Rennes', 'Brest', 'Quimper', 'Saint-Malo', 'Lorient', 'Saint-Brieuc']],
  ['SUD-OUEST', ['Bordeaux Saint-Jean', 'Hendaye', 'Tarbes', 'Toulouse Matabiau', 'La Rochelle', 'Arcachon', 'Tours', 'Poitiers', 'Agen', 'Lourdes']],
  ['CHAMPAGNE', ['Reims', 'Sedan', 'Charleville-Mézières']],
  ['LORRAINE', ['Metz', 'Nancy', 'Luxembourg', 'Remiremont', 'Saint-Dié-des-Vosges', 'Bar-le-Duc']],
  ['ALSACE', ['Strasbourg', 'Colmar', 'Freiburg (Breisgau) Hbf']],
  ['LILLE', ['Lille Flandres', 'Lille Europe', 'Tourcoing']],
  ['LITTORAL', ['Dunkerque', 'Boulogne sur Mer', 'Rang-du-Fliers - Verton - Berck', 'Calais Ville']],
  ['HAINAUT', ['Valenciennes', 'Douai', 'Arras']],
  ['LYON · ALPES', ['Lyon Perrache', 'Lyon Part Dieu', 'Grenoble', 'Annecy', 'Saint-Étienne Châteaucreux', 'MILANO PORTA GARIBALDI']],
  ["PROVENCE · CÔTE D'AZUR", ['Marseille Saint-Charles', 'Toulon', 'Nice-Ville', 'Miramas']],
  ['LANGUEDOC · CATALOGNE', ['Montpellier Saint-Roch', 'Montpellier Sud de France', 'Perpignan', 'Barcelone-Sants']],
  ['FRANCHE-COMTÉ', ['Besançon Viotte', 'Mulhouse']],
];

// Secteur d'une gare vu de Paris (relations intersecteurs) : cap depuis Paris, ou Île-de-France à moins de 60 km.
export function sector(g: Gare): string {
  const p: [number, number] = [g.lon, g.lat];
  if (distKm(PARIS, p) < IDF_KM) return 'ÎLE-DE-FRANCE';
  const rad = Math.PI / 180;
  const y = Math.sin((g.lon - PARIS[0]) * rad) * Math.cos(g.lat * rad);
  const x = Math.cos(PARIS[1] * rad) * Math.sin(g.lat * rad) - Math.sin(PARIS[1] * rad) * Math.cos(g.lat * rad) * Math.cos((g.lon - PARIS[0]) * rad);
  const cap = (Math.atan2(y, x) / rad + 360) % 360;
  return cap >= 330 || cap < 40 ? 'NORD' : cap < 110 ? 'EST' : cap < 175 ? 'SUD-EST' : cap < 235 ? 'SUD-OUEST' : 'OUEST';
}
const SECTOR_ORDER = ['NORD', 'EST', 'SUD-EST', 'SUD-OUEST', 'OUEST', 'ÎLE-DE-FRANCE'];

type Run = { names: string[]; cum: number[]; ids: string[]; end: string; group: string };

// Parcours d'un train par nom de gare, orienté : Paris en haut (radial) ou le bout le plus au nord (intersecteurs).
function runOf(train: Pick<MareyTrain, 'stops'>, gares: Gares, mode: 'radial' | 'corridor'): Run | null {
  const stops = train.stops.filter((s) => !s[4] && gares[s[0]]);
  if (stops.length < 2) return null;
  const g = (i: number) => gares[stops[i][0]];
  const first = g(0), last = g(stops.length - 1);
  const top = (a: Gare, b: Gare) => (mode === 'radial'
    ? distKm(PARIS, [a.lon, a.lat]) <= distKm(PARIS, [b.lon, b.lat])
    : a.lat >= b.lat);
  const seq = top(first, last) ? stops : [...stops].reverse();
  const names = seq.map((s) => gares[s[0]].nom);
  let km = 0;
  const cum = seq.map((s, i) => (km += i ? distKm([gares[seq[i - 1][0]].lon, gares[seq[i - 1][0]].lat], [gares[s[0]].lon, gares[s[0]].lat]) : 0));
  const end = names[names.length - 1];
  const ends = [sector(gares[seq[0][0]]), sector(gares[seq[seq.length - 1][0]])].sort((a, b) => SECTOR_ORDER.indexOf(a) - SECTOR_ORDER.indexOf(b));
  const group = mode === 'radial' ? '' : ends[0] === ends[1] ? `${ends[0]} (INTERNE)` : ends.join(' ↔ ');
  return { names, cum, ids: seq.map((s) => s[0]), end: mode === 'radial' ? end : `${names[0]} ↔ ${end}`, group };
}

// Ordre des gares d'une ligne : tri topologique des précédences observées (Kahn), à égalité par distance médiane au départ.
// Un cycle (deux trains en ordre contradictoire) est signalé et la ligne retombe sur l'ordre des distances.
function orderNames(names: string[], runs: Run[], kmHint: Map<string, number>, label: string, warnings: string[]): string[] {
  const set = new Set(names), next = new Map<string, Set<string>>(), indeg = new Map<string, number>(names.map((n) => [n, 0]));
  for (const r of runs) {
    const seq = r.names.filter((n) => set.has(n));
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (!next.has(a)) next.set(a, new Set());
      if (!next.get(a)!.has(b)) { next.get(a)!.add(b); indeg.set(b, indeg.get(b)! + 1); }
    }
  }
  const byKm = (a: string, b: string) => (kmHint.get(a) ?? 0) - (kmHint.get(b) ?? 0);
  const ready = names.filter((n) => indeg.get(n) === 0).sort(byKm), out: string[] = [];
  while (ready.length) {
    const n = ready.shift()!;
    out.push(n);
    for (const m of next.get(n) ?? []) { indeg.set(m, indeg.get(m)! - 1); if (indeg.get(m) === 0) { ready.push(m); ready.sort(byKm); } }
  }
  if (out.length === names.length) return out;
  const stuck = names.filter((n) => !out.includes(n));
  const culprits = runs.filter((r) => stuck.filter((n) => r.names.includes(n)).length >= 2).map((r) => r.names.join(' → ')).slice(0, 4);
  warnings.push(`Marey ${label} : ordre contradictoire entre ${stuck.join(', ')} ; trains : ${culprits.join(' | ')}`);
  return [...names].sort(byKm);
}

// Distance (km) de chaque gare depuis le haut de la ligne : une gare se place depuis la précédente déjà placée sur le même
// train (médiane sur les trains) ; un départ sans prédécesseur se place depuis la suivante. Monotone le long de l'ordre.
function placeKm(order: string[], runs: Run[], where: Map<string, [number, number]>): Map<string, number> {
  const km = new Map<string, number>([[order[0], 0]]);
  const idx = (r: Run, n: string) => r.names.indexOf(n);
  for (const n of order.slice(1)) {
    const est: number[] = [];
    for (const r of runs) {
      const i = idx(r, n);
      if (i < 0) continue;
      for (let j = i - 1; j >= 0; j--) if (km.has(r.names[j])) { est.push(km.get(r.names[j])! + r.cum[i] - r.cum[j]); break; }
    }
    if (est.length) km.set(n, median(est));
  }
  for (const n of [...order].reverse()) {
    if (km.has(n)) continue;
    const est: number[] = [];
    for (const r of runs) {
      const i = idx(r, n);
      if (i < 0) continue;
      for (let j = i + 1; j < r.names.length; j++) if (km.has(r.names[j])) { est.push(km.get(r.names[j])! - (r.cum[j] - r.cum[i])); break; }
    }
    if (est.length) km.set(n, median(est));
  }
  // Gare sans train mesuré sur cette ligne (reprise du tronc, arrêt supprimé) : à sa distance de la gare précédente.
  order.forEach((n, i) => { if (!km.has(n)) km.set(n, i ? km.get(order[i - 1])! + distKm(where.get(order[i - 1])!, where.get(n)!) : 0); });
  const base = Math.min(...order.map((n) => km.get(n)!));
  let prev = -Infinity;
  for (const n of order) { const v = Math.max(km.get(n)! - base, prev); km.set(n, v); prev = v; }
  return km;
}

// Lignes d'un groupe de trains : une par terminus. Chaque ligne reprend le tronc commun des autres : les gares qu'une autre
// ligne dessert entre deux de ses propres gares, si cet itinéraire suit la même trace (détour ≤ 8 km ou 5 %).
// Ainsi Paris → Toulouse, sans arrêt jusqu'à Bordeaux, reprend Poitiers et Angoulême ; Lille → Marseille par la LGV ne reprend
// pas Douai ni Arras.
function buildLines(runs: Run[], gares: Gares, warnings: string[], label: string): BuiltLine[] {
  const where = new Map<string, [number, number]>();
  for (const g of Object.values(gares)) where.set(g.nom, [g.lon, g.lat]);
  const kmAll = new Map<string, number[]>();
  for (const r of runs) r.names.forEach((n, i) => kmAll.set(n, [...(kmAll.get(n) ?? []), r.cum[i]]));
  const hint = new Map([...kmAll].map(([n, v]) => [n, median(v)]));
  const ordered = (set: Set<string>) => [...set].sort((a, b) => hint.get(a)! - hint.get(b)!);
  const d = (a: string, b: string) => distKm(where.get(a)!, where.get(b)!);
  const byEnd = new Map<string, Set<string>>();
  for (const r of runs) byEnd.set(r.end, new Set([...(byEnd.get(r.end) ?? []), ...r.names]));
  const seqs = [...byEnd.values()].map(ordered);
  return [...byEnd].map(([end, own]) => {
    const set = new Set(own);
    for (const seq of seqs) {
      let last = -1;
      seq.forEach((n, i) => {
        if (!own.has(n)) return;
        if (last >= 0 && i > last + 1) {
          // Gare par gare : une gare de l'autre ligne est reprise si elle reste sur la trace (Colmar reprend Champagne et
          // Meuse TGV vers Strasbourg, pas Metz).
          let prev = seq[last];
          for (const m of seq.slice(last + 1, i)) {
            const extra = d(prev, m) + d(m, n) - d(prev, n);
            if (extra <= Math.max(PATH_KM, PATH_PCT * d(prev, n))) { set.add(m); prev = m; }
          }
        }
        last = i;
      });
    }
    const fits = runs.filter((r) => r.names.every((n) => set.has(n)));
    const order = orderNames([...set], fits, hint, `${label} → ${end}`, warnings);
    const km = placeKm(order, fits, where);
    const ids = new Map<string, Set<string>>();
    for (const r of fits) r.names.forEach((n, i) => ids.set(n, new Set([...(ids.get(n) ?? []), r.ids[i]])));
    return {
      id: slug(end), label: end, own: [...own],
      trains: runs.filter((r) => r.end === end).length,
      gares: order.map((n) => ({ nom: n, km: Math.round(km.get(n)! * 10) / 10, stop_ids: [...(ids.get(n) ?? [])].sort() })),
    };
  }).sort((a, b) => b.trains - a.trains);
}

// Similarité de deux lignes : distance depuis le haut de leur dernière gare commune (plus elles divergent tard, plus elles sont proches).
// Calculée sur les gares réellement desservies (pas le tronc repris), sinon tout se ressemble près de Paris ou de Lyon.
// Deux gares à moins de 3 km comptent comme une seule (Lille Flandres et Lille Europe). Si une seule des deux lignes
// s'arrête à cette gare, le lien est faible (moitié) : Paris → Lille est le tronc de Paris → Dunkerque, pas sa branche.
function similarity(a: BuiltLine, b: BuiltLine, where: Map<string, [number, number]>): number {
  const ga = a.gares.filter((g) => a.own.includes(g.nom)), gb = b.gares.filter((g) => b.own.includes(g.nom));
  const endA = a.gares[a.gares.length - 1].nom, endB = b.gares[b.gares.length - 1].nom;
  let best = -1;
  for (const x of ga) for (const y of gb) {
    if (x.nom !== y.nom && distKm(where.get(x.nom)!, where.get(y.nom)!) > SAME_PLACE_KM) continue;
    const onlyOneEnds = (x.nom === endA) !== (y.nom === endB);
    best = Math.max(best, Math.min(x.km, y.km) * (onlyOneEnds ? 0.5 : 1));
  }
  return best;
}

// Branches de niveau 1 : regroupement hiérarchique (lien simple) des lignes par gare de divergence, coupé là où l'écart
// entre deux niveaux de fusion est le plus grand, entre 2 et 5 branches.
export function clusterLines(lines: BuiltLine[], where: Map<string, [number, number]>): BuiltLine[][] {
  const n = lines.length;
  if (n <= 1) return n ? [lines] : [];
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([similarity(lines[i], lines[j], where), i, j]);
  pairs.sort((a, b) => b[0] - a[0]);
  const merge = (limit: number) => {
    const parent = lines.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const levels: number[] = [];
    for (const [s, i, j] of pairs) {
      if (levels.length === limit) break;
      const a = find(i), b = find(j);
      if (a !== b) { parent[a] = b; levels.push(s); }
    }
    return { find, levels };
  };
  // Après m fusions il reste n − m branches ; écart(k) = dernier niveau fusionné − premier niveau non fusionné.
  const { levels } = merge(n - 1);
  const lo = Math.min(2, n), hi = Math.min(5, n);
  let k = lo, gap = -Infinity;
  for (let c = lo; c <= hi; c++) {
    const m = n - c;
    // Aucune fusion (une branche par ligne) : le « niveau » d'une ligne seule est sa longueur, la plus courte comptant.
    const top = m >= 1 ? levels[m - 1] : Math.min(...lines.map((l) => l.gares[l.gares.length - 1].km));
    const g = top - (m < levels.length ? levels[m] : -Infinity);
    if (g > gap) { gap = g; k = c; }
  }
  const { find } = merge(n - k);
  const groups = new Map<number, BuiltLine[]>();
  lines.forEach((l, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), l]));
  return [...groups.values()];
}

const nameOf = (l: BuiltLine) => BRANCH_NAMES.find(([, t]) => t.includes(l.label))?.[0] ?? null;

export const CITY_KM = 15;

// Agglomération d'un terminus : les terminus sont regroupés à moins de CITY_KM du plus fréquent ; le nom est le premier mot
// partagé par au moins deux gares du groupe (« Lille » pour Lille Flandres, Lille Europe et Tourcoing), sinon le nom de la plus fréquente.
function cityOf(termini: string[], gares: Gares): (nom: string) => string {
  const where = new Map(Object.values(gares).map((g) => [g.nom, [g.lon, g.lat] as [number, number]]));
  const freq = new Map<string, number>();
  for (const t of termini) freq.set(t, (freq.get(t) ?? 0) + 1);
  const reps: { nom: string; members: string[] }[] = [];
  for (const t of [...freq.keys()].sort((a, b) => freq.get(b)! - freq.get(a)!)) {
    const rep = reps.find((r) => distKm(where.get(r.nom)!, where.get(t)!) < CITY_KM);
    if (rep) rep.members.push(t); else reps.push({ nom: t, members: [t] });
  }
  const label = new Map<string, string>();
  for (const r of reps) {
    const first = r.members.map((m) => m.split(/[\s-]/)[0]);
    const top = first.find((w) => first.filter((x) => x === w).length >= 2);
    const name = top ?? r.nom;
    for (const m of r.members) label.set(m, name);
  }
  return (nom) => label.get(nom) ?? nom;
}

// Point d'entrée : vues d'un axe. Radial : branches par divergence depuis Paris. Intersecteurs : une branche par corridor
// (couple de secteurs vus de Paris), destinations = relations origine ↔ terminus.
export function buildAxis(trains: Pick<MareyTrain, 'stops'>[], gares: Gares, axe: string): Built {
  const mode = axe === 'INTERSECTEURS' ? 'corridor' : 'radial';
  const warnings: string[] = [];
  const runs = trains.map((t) => runOf(t, gares, mode)).filter((r): r is Run => r !== null);
  const split = (lines: BuiltLine[]) => ({ lignes: lines.filter((l) => l.trains >= MIN_TRAINS), autres: lines.filter((l) => l.trains < MIN_TRAINS) });
  const total = (b: Pick<Branch, 'lignes' | 'autres'>) => [...b.lignes, ...b.autres].reduce((n, l) => n + l.trains, 0);
  if (mode === 'corridor') {
    // Une destination = un couple d'agglomérations : les terminus à moins de 15 km l'un de l'autre (Lille Flandres, Lille
    // Europe, Tourcoing) sont réunis sous le nom de ville commun.
    const city = cityOf(runs.flatMap((r) => [r.names[0], r.names[r.names.length - 1]]), gares);
    for (const r of runs) r.end = `${city(r.names[0])} ↔ ${city(r.names[r.names.length - 1])}`;
    const byGroup = new Map<string, Run[]>();
    for (const r of runs) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
    const branches = [...byGroup].map(([group, rs]) => ({ id: slug(group), label: group, ...split(buildLines(rs, gares, warnings, group)) }))
      .sort((a, b) => total(b) - total(a));
    return { branches, warnings };
  }
  const where = new Map<string, [number, number]>();
  for (const g of Object.values(gares)) where.set(g.nom, [g.lon, g.lat]);
  const lines = buildLines(runs, gares, warnings, axe);
  const shown = lines.filter((l) => l.trains >= MIN_TRAINS);
  const visible = shown.length ? shown : lines;
  // Branche d'une ligne : son nom (BRANCH_NAMES) s'il en a un ; sinon celui de son groupe automatique (divergence),
  // sinon « VIA » + la première gare propre au groupe.
  const key = new Map<BuiltLine, string>();
  for (const group of clusterLines(visible, where)) {
    const named = group.map(nameOf).filter((n): n is string => n !== null);
    const major = named.sort((x, y) => named.filter((n) => n === y).length - named.filter((n) => n === x).length)[0];
    const elsewhere = new Set(visible.filter((l) => !group.includes(l)).flatMap((l) => l.own));
    const own = group[0].gares.find((g) => !elsewhere.has(g.nom)) ?? group[0].gares[group[0].gares.length - 1];
    for (const l of group) key.set(l, nameOf(l) ?? major ?? `VIA ${own.nom.toUpperCase()}`);
  }
  const named = new Map<string, Branch>();
  const add = (k: string, l: BuiltLine, hidden: boolean) => {
    const b = named.get(k) ?? { id: slug(k), label: k, lignes: [], autres: [] };
    (hidden ? b.autres : b.lignes).push(l);
    named.set(k, b);
  };
  for (const l of visible) add(key.get(l)!, l, false);
  // Une destination masquée rejoint sa branche nommée, sinon celle de la ligne visible dont elle diverge le plus tard.
  for (const h of shown.length ? lines.filter((l) => l.trains < MIN_TRAINS) : []) {
    let best = visible[0], sim = -Infinity;
    for (const l of visible) { const s = similarity(h, l, where); if (s > sim) { sim = s; best = l; } }
    add(nameOf(h) ?? key.get(best)!, h, true);
  }
  return {
    branches: [...named.values()].sort((a, b) => b.lignes.reduce((s, l) => s + l.trains, 0) - a.lignes.reduce((s, l) => s + l.trains, 0)),
    warnings,
  };
}
