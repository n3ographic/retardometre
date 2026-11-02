import { round, toNum } from './num';
import type { Price } from './stats';

// Axes de la vue F3 (branches validées un par un par l'auteur, le 2026-11-03).
export const MAREY_AXES = ['ATLANTIQUE', 'EST', 'NORD', 'SUD_EST', 'INTERSECTEURS'] as const;
export const DEFAULT_AXE = 'ATLANTIQUE';
export const HALF_WINDOW_S = 3 * 3600; // fenêtre de 6 h centrée sur maintenant
export const FETCH_MARGIN_S = 3600; // marge côté serveur : la réponse peut avoir jusqu'à ~11 min
export const BUCKET_S = 600; // seau du cache serveur : un appel à la base par axe toutes les 10 min au plus
// Défilement sur la journée : données par tranches de 3 h chargées à la demande ; une tranche finie depuis plus d'une heure
// change peu (seuls des trains très en retard y circulent encore) et reste une heure en cache.
export const BLOCK_S = 3 * 3600;
export const PAST_TTL_S = 3600;
export const DAY_START_H = 4; // journée de service affichée : 4 h → 2 h le lendemain (heure de Paris)
export const DAY_SPAN_H = 22;

export const blockOf = (t: number) => Math.floor(t / BLOCK_S) * BLOCK_S;

// Début et fin de la journée de service contenant `nowS` ; avant 4 h, c'est encore celle de la veille.
// ponytail: décalage de Paris pris à `nowS` ; un jour de changement d'heure, la plage glisse d'une heure.
export function serviceDay(nowS: number): [number, number] {
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
    .formatToParts(new Date(nowS * 1000)).find((x) => x.type === 'timeZoneName')!.value;
  const m = off.match(/([+-])(\d{2}):(\d{2})/);
  const offS = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3]) * 60) : 0;
  const local = nowS + offS, start = Math.floor((local - DAY_START_H * 3600) / 86_400) * 86_400 + DAY_START_H * 3600 - offS;
  return [start, start + DAY_SPAN_H * 3600];
}

// Clés produites par public.marey_trains() ; les valeurs nulles sont omises.
// Arrêt = [code UIC, arrivée (epoch s), départ (epoch s), retard (s) ou null, supprimé, stop_sequence].
// hist = changements du retard publié : [heure de collecte (epoch s), stop_sequence, retard (s)], triés par heure.
export type RawStop = [string, number, number, number | null, boolean, number?];
export type HistRow = [number, number, number];
export type MareyTrain = {
  service_date: string; brand: string; train_number: string; origin?: string; dest?: string;
  cancelled: boolean; delay_s?: number; cause?: string; comp_pct: number; last_seen_at?: string; stops: RawStop[];
  hist?: HistRow[]; cause_cat?: string; comp_eur_per_passenger_ref: number;
};
export type RawTrain = Omit<MareyTrain, 'comp_eur_per_passenger_ref'>;

export type StopRow = { stop_id: string; name: string; lat: number | null; lon: number | null };
export type MareyGares = Record<string, { nom: string; lat: number; lon: number }>;

// Réponse de /api/marey : trains de l'axe et gares qu'ils desservent (code UIC → nom et coordonnées), pour construire
// les lignes dans le navigateur. Une gare sans coordonnées est omise (ses arrêts sont alors ignorés).
export function shapeMarey(axe: string, trains: RawTrain[], prices: Price[], stops: StopRow[], now: Date) {
  const used = new Set(trains.flatMap((t) => t.stops.map((s) => s[0])));
  const gares: MareyGares = {};
  for (const s of stops) {
    const uic = s.stop_id.slice(-8);
    if (used.has(uic) && s.lat !== null && s.lon !== null && !gares[uic]) gares[uic] = { nom: s.name, lat: toNum(s.lat, 'lat'), lon: toNum(s.lon, 'lon') };
  }
  return {
    generated_at: now.toISOString(),
    axe,
    gares,
    trains: trains.map((t) => {
      const price = prices.find((x) => x.brand === t.brand);
      if (!price) throw new Error(`prix de référence absent pour ${t.brand}`);
      for (const s of t.stops) { toNum(s[1], 'arr'); toNum(s[2], 'dep'); }
      return { ...t, comp_eur_per_passenger_ref: round((toNum(t.comp_pct, 'comp_pct') / 100) * toNum(price.price_eur_ht, 'price_eur_ht'), 2) };
    }),
  };
}

// Fenêtre demandée au serveur : alignée sur le seau de 10 min du cache, élargie d'une marge de chaque côté.
export function fetchWindow(now: Date): { bucket: number; from: string; to: string } {
  const bucket = Math.floor(now.getTime() / 1000 / BUCKET_S) * BUCKET_S;
  return {
    bucket,
    from: new Date((bucket - HALF_WINDOW_S - FETCH_MARGIN_S) * 1000).toISOString(),
    to: new Date((bucket + HALF_WINDOW_S + FETCH_MARGIN_S) * 1000).toISOString(),
  };
}

// Lien vers le diagramme de Marey pour un train d'un axe couvert par la vue F3 ; null pour les autres axes.
export function mareyHref(t: { axis: string; train_number: string }): string | null {
  return (MAREY_AXES as readonly string[]).includes(t.axis) ? `/marey?axe=${t.axis}&train=${encodeURIComponent(t.train_number)}` : null;
}

export type MareyParams = { axe: string; train: string | null };
// Paramètres d'URL de la vue : axe connu et numéro de train de 1 à 5 chiffres, sinon valeurs par défaut.
export function parseMareyParams(search: URLSearchParams): MareyParams {
  const axe = (search.get('axe') ?? '').toUpperCase();
  const train = search.get('train') ?? '';
  return { axe: (MAREY_AXES as readonly string[]).includes(axe) ? axe : DEFAULT_AXE, train: /^\d{1,5}$/.test(train) ? train : null };
}

// Requête de l'API : refuse tout paramètre inconnu et tout axe hors liste.
// `bloc` (facultatif) : début d'une tranche de 3 h (epoch s, multiple de 3 h), d'hier à demain seulement.
export function parseApiParams(search: URLSearchParams, nowS: number): { ok: true; axe: string; bloc: number | null } | { ok: false; error: string } {
  for (const k of search.keys()) if (k !== 'axe' && k !== 'bloc') return { ok: false, error: `paramètre inconnu : ${k}` };
  const axe = search.get('axe') ?? DEFAULT_AXE;
  if (!(MAREY_AXES as readonly string[]).includes(axe)) return { ok: false, error: 'axe inconnu' };
  const raw = search.get('bloc');
  if (raw === null) return { ok: true, axe, bloc: null };
  const bloc = /^\d{9,11}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(bloc) || bloc % BLOCK_S !== 0 || bloc < nowS - 36 * 3600 || bloc > nowS + 30 * 3600) return { ok: false, error: 'tranche invalide' };
  return { ok: true, axe, bloc };
}

export type Line = { id: string; label: string; gares: { nom: string; km: number; stop_ids: string[] }[] };
// Une branche = plusieurs lignes, une par terminus, chacune avec le tronc commun répété (web/lib/marey-lines.ts).
export type AxesFile = { branches: { id: string; label: string; lignes: Line[] }[] };
export type Match = { branch: string; line: string };

// Lignes où un train a sa place : toutes celles qui contiennent tous ses arrêts connus de l'axe (au moins deux).
// Un Paris → Nantes figure sur → Le Croisic et → Les Sables ; un Paris → Le Mans, sur toutes les lignes.
export function matchLines(train: Pick<MareyTrain, 'stops'>, axes: AxesFile): Match[] {
  const known = new Set(axes.branches.flatMap((b) => b.lignes.flatMap((l) => l.gares.flatMap((g) => g.stop_ids))));
  const codes = train.stops.filter((s) => !s[4]).map((s) => s[0]).filter((c) => known.has(c));
  if (codes.length < 2) return [];
  const out: Match[] = [];
  for (const b of axes.branches) for (const l of b.lignes) {
    const ids = new Set(l.gares.flatMap((g) => g.stop_ids));
    if (codes.every((c) => ids.has(c))) out.push({ branch: b.id, line: l.id });
  }
  return out;
}

export type Point = { t: number; km: number };
// Morceau de la ligne pleine : même tranche de retard (échelle de la légende), passé ou futur.
export type Run = { points: Point[]; delay: number; future: boolean };
export type Trace = { planned: Point[]; actual: Point[]; runs: Run[] };

// Horaire théorique d'un train sur une ligne : à chaque arrêt, un point d'arrivée et un point de départ (le palier
// horizontal est le temps d'arrêt). Arrêts hors ligne ou supprimés ignorés.
export function plannedPoints(train: Pick<MareyTrain, 'stops'>, line: Pick<Line, 'gares'>): Point[] {
  const km = new Map(line.gares.flatMap((g) => g.stop_ids.map((id) => [id, g.km] as const)));
  const out: Point[] = [];
  for (const [code, arr, dep, , cancelled] of train.stops) {
    const k = km.get(code);
    if (k !== undefined && !cancelled) out.push({ t: arr, km: k }, { t: dep, km: k });
  }
  return out;
}

// Position théorique (km) à l'heure τ de l'horaire ; null hors du parcours.
function kmAt(planned: Point[], tau: number): number | null {
  if (planned.length === 0 || tau < planned[0].t || tau > planned[planned.length - 1].t) return null;
  for (let i = 1; i < planned.length; i++) {
    const a = planned[i - 1], b = planned[i];
    if (tau <= b.t) return b.t === a.t ? b.km : a.km + ((tau - a.t) / (b.t - a.t)) * (b.km - a.km);
  }
  return planned[planned.length - 1].km;
}

// Retard publié à l'instant T : celui de la prochaine gare non encore quittée (départ prévu + son retard à T).
// Chaque arrêt prend sa dernière valeur collectée à T ou avant (0 avant toute valeur). Sans historique (train vu sous
// une autre variante, par exemple), on retombe sur le dernier retard publié de chaque arrêt.
export function publishedDelayAt(train: Pick<MareyTrain, 'stops' | 'hist'>, T: number): number {
  const hist = train.hist ?? [];
  const at = (s: RawStop) => {
    if (hist.length === 0) return s[3] ?? 0;
    let d = 0;
    for (const [t, seq, v] of hist) { if (t > T) break; if (seq === s[5]) d = v; }
    return d;
  };
  const stops = train.stops.filter((s) => !s[4]);
  for (const s of stops) { const d = Math.max(at(s), 0); if (s[2] + d > T) return d; }
  return stops.length ? Math.max(at(stops[stops.length - 1]), 0) : 0;
}

// Ligne pleine reconstituée, échantillonnée toutes les `stepS` secondes sur [from, to] : à l'instant T, le train est à la
// position théorique de l'heure τ = T − retard publié à T. τ ne recule jamais : une hausse du retard devient un palier
// (le train « attend » le temps perdu), une baisse un rattrapage. Après `nowS`, le dernier retard connu est prolongé (future).
export function trainTrace(train: Pick<MareyTrain, 'stops' | 'hist'>, line: Pick<Line, 'gares'>, from: number, to: number, nowS: number, stepS = 60): Trace {
  const planned = plannedPoints(train, line);
  const empty = { planned, actual: [], runs: [] };
  if (planned.length < 2) return empty;
  const maxDelay = Math.max(0, ...(train.hist ?? []).map((h) => h[2]), ...train.stops.map((s) => s[3] ?? 0));
  const start = Math.max(from, planned[0].t), end = Math.min(to, planned[planned.length - 1].t + maxDelay);
  if (start > end) return empty;
  const times: number[] = [];
  for (let T = start; T < end; T += stepS) times.push(T);
  times.push(end);
  if (nowS > start && nowS < end) times.push(nowS);
  times.sort((a, b) => a - b);

  const runs: Run[] = [], actual: Point[] = [];
  let tauPrev = -Infinity, run: Run | null = null;
  for (const T of times) {
    const d = publishedDelayAt(train, T);
    const tau = Math.max(T - d, tauPrev);
    tauPrev = tau;
    const km = kmAt(planned, tau);
    if (km === null) { run = null; continue; }
    const p = { t: T, km }, delay = d, future = T > nowS;
    actual.push(p);
    if (run && run.delay === delay && run.future === future) run.points.push(p);
    else {
      const prev: Point | undefined = (run as Run | null)?.points.at(-1);
      run = { points: prev ? [prev, p] : [p], delay, future };
      runs.push(run);
    }
  }
  return { planned, actual, runs };
}

// Étendue en temps d'un tracé (horaire et ligne reconstituée), pour décider si le train croise la fenêtre.
export function span(trace: Trace): [number, number] | null {
  if (trace.planned.length === 0) return null;
  const ts = [...trace.planned, ...trace.actual].map((p) => p.t);
  return [Math.min(...ts), Math.max(...ts)];
}

// Étendue d'un train : premier passage prévu → dernier passage prévu + plus grand retard publié.
export function trainSpan(t: Pick<MareyTrain, 'stops'>): [number, number] | null {
  if (t.stops.length === 0) return null;
  return [t.stops[0][1], t.stops[t.stops.length - 1][2] + Math.max(0, ...t.stops.map((s) => s[3] ?? 0))];
}
export function inWindow(t: Pick<MareyTrain, 'stops'>, nowS: number, half = HALF_WINDOW_S): boolean {
  const sp = trainSpan(t);
  return sp !== null && sp[1] >= nowS - half && sp[0] <= nowS + half;
}

// Train désigné par ?train= : un train de ce numéro dont le parcours (retard compris) croise la fenêtre ±3 h ;
// s'il y en a deux (hier et aujourd'hui), le plus proche de maintenant. Aucun : null, jamais un autre numéro.
export function findTrain<T extends Pick<MareyTrain, 'train_number' | 'stops'>>(trains: T[], number: string, nowS: number, half = HALF_WINDOW_S): T | null {
  let best: { t: T; gap: number } | null = null;
  for (const t of trains) {
    if (t.train_number !== number || !inWindow(t, nowS, half)) continue;
    const [lo, hi] = trainSpan(t)!;
    const gap = nowS < lo ? lo - nowS : nowS > hi ? nowS - hi : 0;
    if (!best || gap < best.gap) best = { t, gap };
  }
  return best?.t ?? null;
}

// Repères horaires : chaque heure pleine de la fenêtre (Paris est à décalage entier d'heures : multiples de 3600 s).
export function hourTicks(fromS: number, toS: number): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(fromS / 3600) * 3600; t <= toS; t += 3600) out.push(t);
  return out;
}

