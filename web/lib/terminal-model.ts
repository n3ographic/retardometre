import { SAMPLE_MIN, TERMINUS_BUCKETS, isSmallSample, suppressionPct } from './dashboard-model';
import { departed, type LiveItem } from './map-model';
import type { Group } from './stats';

export type Tone = 'ontime' | 'late' | 'strong' | 'severe' | 'cancelled';


// Quatre tons d'affichage (les classes de la carte, delayClass, gardent leurs propres seuils).
export function delayTone(delay_s: number | undefined, cancelled: boolean): Tone {
  if (cancelled) return 'cancelled';
  const d = delay_s ?? 0;
  return d >= 3600 ? 'severe' : d >= 1800 ? 'strong' : d >= 300 ? 'late' : 'ontime';
}

export function topDelays(trains: LiveItem[], n: number): LiveItem[] {
  return trains
    .filter((t) => !t.cancelled && (t.delay_s ?? 0) > 0)
    .sort((a, b) => (b.delay_s ?? 0) - (a.delay_s ?? 0) || a.train_number.localeCompare(b.train_number))
    .slice(0, n);
}

// Régularité par axe, toutes marques confondues.
export function axisRegularity(groups: Group[]): { axis: string; circulated: number; on_time: number; pct: number | null; small: boolean; cancelled: number; suppr_pct: number | null; cost: number }[] {
  const by = new Map<string, { circulated: number; on_time: number; cancelled: number; cost: number }>();
  for (const g of groups) {
    const a = by.get(g.axis) ?? { circulated: 0, on_time: 0, cancelled: 0, cost: 0 };
    a.circulated += g.circulated;
    a.on_time += g.on_time_official;
    a.cancelled += g.cancelled;
    a.cost += g.estimated_cost_eur_ht;
    by.set(g.axis, a);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([axis, a]) => ({
    axis, ...a,
    pct: a.circulated === 0 ? null : Math.round((a.on_time / a.circulated) * 1000) / 10,
    small: a.circulated < SAMPLE_MIN,
    suppr_pct: suppressionPct(a),
  }));
}

// Barre de caractères : cellules pleines, plus une demi-cellule à partir de la moitié.
export function charBar(pct: number | null, width: number): string {
  if (!pct || pct <= 0) return '';
  const cells = (Math.min(pct, 100) / 100) * width;
  const full = Math.floor(cells);
  return '█'.repeat(full) + (cells - full >= 0.5 ? '▌' : '');
}

// Période des statistiques : '7d', '14d', '31d' ou un mois 'AAAA-MM'.
export type Period = string;
export const FIXED_PERIODS = ['7d', '14d', '31d'] as const;
const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

export function periodQuery(p: Period): string {
  return /^\d+d$/.test(p) ? `period=${p}` : `month=${p}`;
}

const parisTime = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
// Heure du calcul côté serveur (unité mise en cache), à l'heure de Paris ; null si absente.
// Âge normal maximal d'un calcul : cache de données + cache CDN (s-maxage + stale-while-revalidate), avec une marge.
// Au-delà, le recalcul échoue et les caches servent encore l'ancien résultat (unstable_cache garde l'entrée tant que le
// recalcul lève) : le libellé le signale au lieu d'afficher des chiffres périmés comme s'ils étaient à jour.
export const STATS_MAX_AGE_MIN = 40; // 15 min de données + 15 + 5 min de CDN
export const CUMUL_MAX_AGE_MIN = 15; // 5 min de données + 5 + 1 min de CDN
export const isCalcStale = (iso: string | undefined, maxAgeMin: number, now = new Date()) =>
  iso !== undefined && now.getTime() - Date.parse(iso) > maxAgeMin * 60_000;
export const calcLabel = (iso: string | undefined, maxAgeMin = Infinity, now = new Date()) =>
  (iso ? `CALCULÉ À ${parisTime.format(new Date(iso))}${isCalcStale(iso, maxAgeMin, now) ? ' · PÉRIMÉ, MISE À JOUR EN ÉCHEC' : ''}` : null);

// Périodes glissantes : jours complets de J-n à J-1, la fenêtre avance à minuit ; un mois inclut le jour en cours.
export const windowLabel = (p: Period) => (/^\d+d$/.test(p) ? `JOURS COMPLETS · J-${p.slice(0, -1)} À J-1 · FENÊTRE DÉCALÉE À MINUIT` : null);

export function periodLabel(p: Period): string {
  if (/^\d+d$/.test(p)) return `${p.slice(0, -1)}J`;
  const [y, m] = p.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Barre de tranches en caractères : `width` cases réparties par plus forts restes ; une tranche trop petite peut disparaître.
export function bucketBar(buckets: Record<string, number>, width: number): { i: number; bucket: string; len: number }[] {
  const ns = TERMINUS_BUCKETS.map((b) => buckets[b] ?? 0);
  const total = ns.reduce((a, n) => a + n, 0);
  if (total === 0) return [];
  const exact = ns.map((n) => (n / total) * width);
  const lens = exact.map(Math.floor);
  const order = exact.map((x, i) => i).sort((a, b) => (exact[b] - lens[b]) - (exact[a] - lens[a]) || a - b);
  for (let k = width - lens.reduce((a, n) => a + n, 0), j = 0; k > 0; k--, j++) lens[order[j]]++;
  return TERMINUS_BUCKETS.map((bucket, i) => ({ i, bucket, len: lens[i] })).filter((s) => s.len > 0);
}

// Ce que veulent dire les bornes de la fourchette (infobulle).
export const RANGE_HINT = 'Bas : retard publié − 4 min 59 s, sans les trains qui sautent un arrêt. Haut : retard publié + 4 min 59 s. Occupation de 0,75 dans les deux cas.';

// Fourchette d'indemnités lisible, dans l'unité de la borne haute ; null s'il manque une borne.
export function eurRange(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  const [div, unit, digits] = high >= 1e6 ? [1e6, ' M€', 2] : high >= 1e3 ? [1e3, ' k€', 0] : [1, ' €', 0];
  const fmt = (n: number) => (n / div).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const a = fmt(low), b = fmt(high);
  return a === b ? `${a}${unit}` : `${a} – ${b}${unit}`;
}

// Trains en route (partis, non supprimés) par tranche de retard (minutes) ; retard absent ou négatif = tranche 0.
const BUCKET_FROM_MIN = [0, 5, 15, 30, 60, 120, 180];
// Indice dans TERMINUS_BUCKETS du retard (secondes) ; absent ou négatif = tranche 0.
export function bucketIndex(delay_s: number | undefined): number {
  const min = Math.floor(Math.max(delay_s ?? 0, 0) / 60);
  return BUCKET_FROM_MIN.filter((b) => min >= b).length - 1;
}
export function liveBuckets(trains: LiveItem[], now: Date): { bucket: string; n: number }[] {
  const counts = TERMINUS_BUCKETS.map(() => 0);
  for (const t of trains) {
    if (!departed(t, now)) continue;
    counts[bucketIndex(t.delay_s)]++;
  }
  return TERMINUS_BUCKETS.map((bucket, i) => ({ bucket, n: counts[i] }));
}

const HHMM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// Les n trains en route qui arrivent le plus tôt : heure prévue + retard publié.
export function nextArrivals(trains: LiveItem[], n: number, now: Date): (LiveItem & { eta: string })[] {
  const at = (t: LiveItem) => Date.parse(t.arr_planned) + (t.delay_s ?? 0) * 1000;
  return trains
    .filter((t) => departed(t, now) && at(t) > now.getTime()) // arrivée estimée (prévue + retard publié) encore à venir
    .sort((a, b) => at(a) - at(b) || a.train_number.localeCompare(b.train_number))
    .slice(0, n)
    .map((t) => ({ ...t, eta: HHMM.format(at(t)) }));
}

// Répartition par marque sur la période ; parts en % de la somme des marques présentes.
export function brandSplit(groups: Group[]): { brand: string; circulated: number; pct: number | null; cost: number; small: boolean; trains_share: number; cost_share: number }[] {
  const by = new Map<string, { circulated: number; on_time: number; cost: number }>();
  for (const g of groups) {
    const a = by.get(g.brand) ?? { circulated: 0, on_time: 0, cost: 0 };
    a.circulated += g.circulated;
    a.on_time += g.on_time_official;
    a.cost += g.estimated_cost_eur_ht;
    by.set(g.brand, a);
  }
  const totalN = [...by.values()].reduce((s, a) => s + a.circulated, 0);
  const totalC = [...by.values()].reduce((s, a) => s + a.cost, 0);
  const share = (v: number, t: number) => (t === 0 ? 0 : Math.round((v / t) * 100));
  return ['INOUI', 'OUIGO'].filter((b) => by.has(b)).map((brand) => {
    const a = by.get(brand)!;
    return {
      brand, circulated: a.circulated, cost: a.cost, small: isSmallSample(a),
      pct: a.circulated === 0 ? null : Math.round((a.on_time / a.circulated) * 1000) / 10,
      trains_share: share(a.circulated, totalN), cost_share: share(a.cost, totalC),
    };
  });
}

// Dernier jour entier de la période (« 7J · 28/10 → 03/11 ») : les bornes from/to de /api/stats, en JJ/MM.
export const rangeLabel = (from: string, to: string) => `${from.slice(8, 10)}/${from.slice(5, 7)} → ${to.slice(8, 10)}/${to.slice(5, 7)}`;

// Durée du cache de données de /api/live (handlers.ts, createLiveHandler) : inutile de rappeler plus tôt, la réponse est la même.
export const LIVE_CACHE_S = 300;
// Prochain appel de /api/live : juste après le renouvellement du cache (generated_at + durée), au plus tôt dans 20 s
// (réponse du CDN encore ancienne : on réessaie), au plus tard à la durée du cache.
export function nextLiveDelayMs(generatedAt: string, now: number = Date.now()): number {
  const due = Date.parse(generatedAt) + (LIVE_CACHE_S + 3) * 1000 - now;
  return Math.min(LIVE_CACHE_S * 1000, Math.max(20_000, Number.isFinite(due) ? due : 60_000));
}

// Seuils d'indemnité (minutes) tirés du barème en vigueur, sans doublon : +30′, +60′, +120′… selon les règles chargées.
export const delayThresholds = (scale: { from_s: number }[]): number[] =>
  [...new Set(scale.map((s) => Math.round(s.from_s / 60)))].sort((a, b) => a - b);

export type TickerItem = { key: string; trip_id: string; tag: string; label: string; tone: Tone };
const trainLabel = (t: LiveItem) =>
  [`${t.brand} ${t.train_number}`, [t.origin, t.dest].filter(Boolean).join(' → ')].filter(Boolean).join(' ');

// Événements entre deux relevés du flux : seuil d'indemnité franchi (le plus haut seulement), suppression, nouveau record
// de retard. `record` = plus grand retard (s) déjà vu depuis l'ouverture de la page ; le premier relevé (prev vide) fixe la base.
export function liveEvents(prev: LiveItem[], next: LiveItem[], thresholdsMin: number[], record: number): { events: TickerItem[]; record: number } {
  const before = new Map(prev.map((t) => [t.trip_id, t]));
  const events: TickerItem[] = [];
  let top: LiveItem | undefined;
  for (const t of next) {
    const d = t.delay_s ?? 0;
    if (!t.cancelled && d > (top?.delay_s ?? 0)) top = t;
    const p = before.get(t.trip_id);
    if (!p) continue;
    if (t.cancelled && !p.cancelled) events.push({ key: `${t.trip_id}:supp`, trip_id: t.trip_id, tag: 'SUPPRIMÉ', label: trainLabel(t), tone: 'cancelled' });
    if (t.cancelled) continue;
    const crossed = thresholdsMin.filter((m) => (p.delay_s ?? 0) < m * 60 && d >= m * 60).pop();
    if (crossed !== undefined) events.push({ key: `${t.trip_id}:s${crossed}`, trip_id: t.trip_id, tag: `SEUIL +${crossed}′`, label: trainLabel(t), tone: delayTone(d, false) });
  }
  const best = top?.delay_s ?? 0;
  if (prev.length > 0 && top && best > record) {
    events.push({ key: `${top.trip_id}:rec${best}`, trip_id: top.trip_id, tag: `RECORD +${Math.round(best / 60)}′`, label: trainLabel(top), tone: delayTone(best, false) });
  }
  return { events, record: Math.max(record, best) };
}

// Sans événement récent : les trains en retard au-delà du Top 10 de la colonne de gauche.
export function beyondTop(trains: LiveItem[], skip: number, n: number): TickerItem[] {
  return topDelays(trains, skip + n).slice(skip).map((t) => ({
    key: t.trip_id, trip_id: t.trip_id, tag: `▼ +${Math.round((t.delay_s ?? 0) / 60)}′`, label: trainLabel(t), tone: delayTone(t.delay_s, t.cancelled),
  }));
}

// Montant court pour les tableaux serrés : 1,02 M€, 310 k€, 840 €. Le montant exact reste dans les infobulles et le cumul.
export function eurShort(n: number): string {
  const [div, unit, digits] = n >= 1e6 ? [1e6, ' M€', 2] : n >= 1e3 ? [1e3, ' k€', 0] : [1, ' €', 0];
  return `${(n / div).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`;
}
