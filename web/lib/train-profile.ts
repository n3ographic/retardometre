import { DEFAULT_OCCUPANCY, stepAt, type Price, type Scale } from './stats';

// Fiche par train (/train/XXXX) : réponse de la fonction SQL train_profile mise en forme pour la page et l'image de partage.
export const ON_TIME_S = 300; // à l'heure : retard au terminus < 5 min (comme la régularité du site)
export const SMALL_DAYS = 7; // en dessous, « ÉCHANTILLON FAIBLE »

// [date, observé, supprimé, retard au terminus (s) ou null, catégorie de cause ou null, % d'indemnité]
export type RawDay = [string, boolean, boolean, number | null, string | null, number];
export type RawProfile = {
  info: { brand: string; axis: string; origin: string | null; dest: string | null; dep_planned: string; arr_planned: string; intl?: boolean };
  today: { date: string; observed: boolean; cancelled: boolean; delay_s: number | null; last_seen_at: string | null } | null;
  days: RawDay[];
  stops: [string, string | null, number | null, number][]; // [uic, nom, retard moyen (s), jours mesurés]
  axis: [string, number, number][]; // [numéro, jours observés, jours à l'heure]
};

export type Day = { date: string; state: 'unobserved' | 'cancelled' | 'ran'; delay_s: number | null; cause: string | null; comp_pct: number };
export type Profile = {
  number: string;
  info: RawProfile['info'];
  today: RawProfile['today'];
  days: Day[];
  score: { ok: number; n: number; small: boolean; mean_min: number | null; median_min: number | null };
  causes: { category: string; days: number }[];
  comp: { days: number; eur: number; eur_bon: number | null }; // eur_bon : null sans barème (forme inconnue)
  stops: { uic: string; nom: string; avg_min: number | null; n: number }[];
  rank: { better_than_pct: number; of: number } | null;
};

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const min1 = (s: number | null) => (s === null ? null : Math.round(s / 6) / 10); // minutes à 0,1 près

export function shapeProfile(number: string, raw: RawProfile, prices: Price[], scale: Scale[] = []): Profile {
  const days: Day[] = raw.days.map(([date, observed, cancelled, delay_s, cause, comp_pct]) => ({
    date, state: !observed ? 'unobserved' : cancelled ? 'cancelled' : 'ran', delay_s, cause, comp_pct,
  }));
  // Jours comptés : observés et supprimés (une suppression compte comme un échec), sauf retard illisible (≥ 12 h, écarté).
  const counted = days.filter((d) => d.state === 'cancelled' || (d.state === 'ran' && d.delay_s !== null));
  const ran = counted.filter((d) => d.state === 'ran').map((d) => Math.max(d.delay_s!, 0));
  const ok = ran.filter((s) => s < ON_TIME_S).length;
  const mean = ran.length ? ran.reduce((a, s) => a + s, 0) / ran.length : null;

  const byCause = new Map<string, number>();
  for (const d of days) if (d.state === 'ran' && (d.delay_s ?? 0) >= ON_TIME_S && d.cause) byCause.set(d.cause, (byCause.get(d.cause) ?? 0) + 1);

  const price = prices.find((p) => p.brand === raw.info.brand);
  const compDays = days.filter((d) => d.state === 'ran' && d.comp_pct > 0);
  const dayEur = (d: Day) => (price ? (d.comp_pct / 100) * price.price_eur_ht * price.seats * DEFAULT_OCCUPANCY : 0);
  const eur = compDays.reduce((a, d) => a + dayEur(d), 0);
  const isBon = (d: Day) => stepAt(scale, raw.info.brand, d.delay_s ?? 0, raw.info.intl)?.form === 'bon';
  const eurBon = scale.length ? compDays.filter(isBon).reduce((a, d) => a + dayEur(d), 0) : null;

  // Rang dans l'axe : part des autres trains de l'axe dont la régularité est strictement plus basse.
  const rate = counted.length ? ok / counted.length : null;
  const others = raw.axis.filter(([n, total]) => n !== number && total > 0);
  const rank = rate === null || others.length === 0 ? null
    : { better_than_pct: Math.round((others.filter(([, total, good]) => good / total < rate).length / others.length) * 100), of: others.length };

  return {
    number, info: raw.info, today: raw.today, days,
    score: { ok, n: counted.length, small: counted.length < SMALL_DAYS, mean_min: min1(mean), median_min: min1(median(ran)) },
    causes: [...byCause].map(([category, n]) => ({ category, days: n })).sort((a, b) => b.days - a.days || a.category.localeCompare(b.category)),
    comp: { days: compDays.length, eur: Math.round(eur), eur_bon: eurBon === null ? null : Math.round(eurBon) },
    stops: raw.stops.map(([uic, nom, avg, n]) => ({ uic, nom: nom ?? uic, avg_min: min1(avg), n })),
    rank,
  };
}

// État du jour pour l'en-tête : supprimé, pas encore parti, en route, arrivé (à l'heure ou +X′), non prévu aujourd'hui.
export function todayLabel(p: Pick<Profile, 'today' | 'info'>, now: Date): { text: string; delay_s: number | null; en_route: boolean } {
  const t = p.today;
  if (!t) return { text: 'PAS PRÉVU AUJOURD’HUI', delay_s: null, en_route: false };
  if (t.cancelled) return { text: 'SUPPRIMÉ AUJOURD’HUI', delay_s: null, en_route: false };
  const d = Math.max(t.delay_s ?? 0, 0), late = d >= ON_TIME_S ? `+${Math.round(d / 60)}′` : 'À L’HEURE';
  const dep = Date.parse(p.info.dep_planned), arr = Date.parse(p.info.arr_planned) + d * 1000, n = now.getTime();
  if (n < dep) return { text: 'PAS ENCORE PARTI', delay_s: t.delay_s, en_route: false };
  if (n < arr) return { text: `EN ROUTE · ${late}`, delay_s: t.delay_s, en_route: true };
  return { text: `ARRIVÉ · ${late}`, delay_s: t.delay_s, en_route: false };
}
