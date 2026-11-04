import type { LiveTrain } from './live';

export type Lngl = [number, number];
export type PositionState = 'at_stop' | 'moving' | 'arrived';
export type Estimate = { lon: number; lat: number; state: PositionState };

// Tracé entre deux arrêts : droit pour l'instant ; le plan 3b le remplacera par les tracés SNCF Réseau.
export function segment(a: Lngl, b: Lngl): Lngl[] {
  return [a, b];
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unmercY = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

// Point à la fraction p (0..1) de la longueur de la polyligne.
function along(line: Lngl[], p: number): Lngl {
  // Longitude pondérée par cos(latitude) : un degré de longitude est plus court qu'un degré de latitude.
  const lens = line.slice(1).map((pt, i) => {
    const k = Math.cos((((pt[1] + line[i][1]) / 2) * Math.PI) / 180);
    return Math.hypot((pt[0] - line[i][0]) * k, pt[1] - line[i][1]);
  });
  let left = lens.reduce((s, l) => s + l, 0) * p;
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const f = lens[i] === 0 ? 0 : Math.min(left / lens[i], 1);
      // Interpolation en Mercator : la carte trace le segment droit dans cette projection, le point reste dessus.
      const y = mercY(line[i][1]) + (mercY(line[i + 1][1]) - mercY(line[i][1])) * f;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, unmercY(y)];
    }
    left -= lens[i];
  }
  return line[0];
}

const ms = (iso?: string) => (iso === undefined ? NaN : Date.parse(iso));
const okCoord = (lon?: number, lat?: number): boolean => lon != null && lat != null && Number.isFinite(lon + lat);

// Horaires effectifs (ms) de chaque arrêt : prévus + retard de l'arrêt (publié, sinon précédent, sinon du train ; jamais négatif).
function effectiveTimes(train: Pick<LiveTrain, 'stops' | 'delay_s'>): { arr: number; dep: number; delay: number }[] {
  let delay = Math.max(train.delay_s ?? 0, 0);
  return train.stops.map((st) => {
    if (st.delay_s != null) delay = Math.max(st.delay_s, 0);
    const d = delay * 1000;
    const arr = (Number.isFinite(ms(st.arr)) ? ms(st.arr) : ms(st.dep)) + d;
    const dep = (Number.isFinite(ms(st.dep)) ? ms(st.dep) : ms(st.arr)) + d;
    return { arr, dep, delay };
  });
}

// Position estimée le long de la fenêtre d'arrêts renvoyée par /api/live. Chaque arrêt a ses horaires prévus et son
// retard (publié, sinon celui de l'arrêt précédent, sinon le retard du train, sinon 0 ; jamais négatif). Le tronçon
// actif est celui qui encadre l'heure : à l'arrêt tant que le départ effectif n'est pas passé, en route ensuite jusqu'à
// l'arrivée effective suivante, à l'arrivée une fois le dernier arrêt atteint.
export function estimatePosition(
  train: Pick<LiveTrain, 'stops' | 'delay_s' | 'cancelled'>,
  now: Date,
  path: (a: Lngl, b: Lngl) => Lngl[] = segment,
): Estimate | null {
  const stops = train.stops;
  const first = stops[0];
  if (!first || !okCoord(first.lon, first.lat)) return null;
  const stopAt = (i: number, state: PositionState): Estimate => ({ lon: stops[i].lon!, lat: stops[i].lat!, state });
  if (train.cancelled || stops.length === 1) return stopAt(0, 'at_stop');

  const eff = effectiveTimes(train);

  const t = now.getTime();
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (!okCoord(a.lon, a.lat) || !okCoord(b.lon, b.lat) || !Number.isFinite(eff[i].dep) || !Number.isFinite(eff[i + 1].arr)) return null;
    if (t < eff[i].dep) return stopAt(i, 'at_stop');
    if (t < eff[i + 1].arr) {
      if (eff[i + 1].arr <= eff[i].dep) return stopAt(i + 1, 'arrived');
      const [lon, lat] = along(path([a.lon!, a.lat!], [b.lon!, b.lat!]), (t - eff[i].dep) / (eff[i + 1].arr - eff[i].dep));
      return { lon, lat, state: 'moving' };
    }
  }
  const last = stops.length - 1;
  if (!okCoord(stops[last].lon, stops[last].lat)) return null;
  return stopAt(last, 'arrived');
}

const EARTH_KM = 6371;
const rad = (d: number) => (d * Math.PI) / 180;
function lengthKm(line: Lngl[]): number {
  return line.slice(1).reduce((sum, [lon, lat], i) => {
    const [lon0, lat0] = line[i];
    const h = Math.sin(rad(lat - lat0) / 2) ** 2 + Math.cos(rad(lat0)) * Math.cos(rad(lat)) * Math.sin(rad(lon - lon0) / 2) ** 2;
    return sum + 2 * EARTH_KM * Math.asin(Math.sqrt(h));
  }, 0);
}

// Au-delà, l'horaire ou le tracé du tronçon est douteux : on n'affiche pas de vitesse.
const MAX_PLAUSIBLE_KMH = 330;

// Tronçon en cours (celui qui encadre l'heure) et retard retenu à chaque bout ; null à l'arrêt, arrivé, supprimé ou inconnu.
function activeSegment(train: Pick<LiveTrain, 'stops' | 'delay_s' | 'cancelled'>, now: Date) {
  const { stops } = train;
  if (train.cancelled || stops.length < 2) return null;
  const eff = effectiveTimes(train);
  const t = now.getTime();
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (!okCoord(a.lon, a.lat) || !okCoord(b.lon, b.lat) || !Number.isFinite(eff[i].dep) || !Number.isFinite(eff[i + 1].arr)) return null;
    if (t < eff[i].dep) return null;
    if (t < eff[i + 1].arr) return { a, b, delayA: eff[i].delay, delayB: eff[i + 1].delay, depMs: eff[i].dep, arrMs: eff[i + 1].arr };
  }
  return null;
}

// Vitesse prévue du tronçon en cours : longueur du tracé / durée prévue (départ-arrivée, sans retard). Un retard
// annoncé qui grossit sur le tronçon n'est pas une vitesse plus basse : il se lit à part (segmentProgress).
// Seulement en route : null à l'arrêt, arrivé, supprimé ou si le tronçon est inconnu.
export function segmentSpeedKmh(
  train: Pick<LiveTrain, 'stops' | 'delay_s' | 'cancelled'>,
  now: Date,
  path: (a: Lngl, b: Lngl) => Lngl[] = segment,
): number | null {
  const seg = activeSegment(train, now);
  if (!seg) return null;
  const dep = Number.isFinite(ms(seg.a.dep)) ? ms(seg.a.dep) : ms(seg.a.arr);
  const arr = Number.isFinite(ms(seg.b.arr)) ? ms(seg.b.arr) : ms(seg.b.dep);
  const hours = (arr - dep) / 3_600_000;
  if (!(hours > 0)) return null;
  const v = lengthKm(path([seg.a.lon!, seg.a.lat!], [seg.b.lon!, seg.b.lat!])) / hours;
  return v > MAX_PLAUSIBLE_KMH ? null : v;
}

// Avancement sur le tronçon en cours (horaires retardés) : temps depuis le départ, jusqu'à l'arrivée, et retard annoncé
// en plus entre les deux bouts (négatif = rattrapage). null à l'arrêt, arrivé, supprimé ou inconnu.
export type SegmentProgress = { from?: string; to?: string; sinceDepS: number; toArrS: number; growthS: number };
export function segmentProgress(train: Pick<LiveTrain, 'stops' | 'delay_s' | 'cancelled'>, now: Date): SegmentProgress | null {
  const seg = activeSegment(train, now);
  if (!seg) return null;
  const t = now.getTime();
  return {
    from: seg.a.name, to: seg.b.name,
    sinceDepS: Math.round((t - seg.depMs) / 1000), toArrS: Math.round((seg.arrMs - t) / 1000),
    growthS: seg.delayB - seg.delayA,
  };
}
