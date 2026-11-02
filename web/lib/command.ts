import type { LiveItem } from './map-model';
import { estimatePosition } from './position';
import { topDelays } from './terminal-model';
import { norm } from './train-search';

// Les trois vues d'un train (barre d'actions et barre de commande).
export type View = 'CARTE' | 'MAREY' | 'FICHE';
export const viewHref = (v: View, n: string) => (v === 'CARTE' ? `/?sel=${n}` : v === 'MAREY' ? `/marey?train=${n}` : `/train/${n}`);

// Barre de commande (« / » ou Ctrl+K) : suggestions calculées à la main sur les trains du flux (/api/live) et les gares (/api/gares).
// `href` est l'action par défaut (Entrée), nommée `go` ; `alt` : les autres actions, atteintes par → ou Tab.
export type Kind = 'TRAIN' | 'AXE' | 'GARE' | 'PAGE' | 'CMD';
export type Action = { label: string; href: string };
export type Suggestion = { kind: Kind; label: string; href: string | null; go?: string; alt?: Action[]; delay_s?: number; cancelled?: boolean; group?: string };
type CommandTrain = Pick<LiveItem, 'train_number' | 'brand' | 'origin' | 'dest' | 'delay_s' | 'cancelled' | 'axis'> & { stops?: LiveItem['stops'] };
// Gare de /api/gares : code UIC, nom, et coordonnées quand elles sont connues.
export type GareRow = [uic: string, nom: string, lat?: number, lon?: number];
export type CommandData = { trains: CommandTrain[]; gares: GareRow[] };

export const MAX_SUGGESTIONS = 6;
export const UNKNOWN = 'COMMANDE INCONNUE · TAPEZ HELP';

const PAGES: [string, string, string][] = [['CARTE', '/', 'F1 CARTE'], ['METHODO', '/methodologie', 'F2 MÉTHODO'], ['MAREY', '/marey', 'F3 MAREY'], ['SEMAINE', '/semaine', 'BILAN SEMAINE']];
const AXES: [string, string][] = [['ATL', 'ATLANTIQUE'], ['EST', 'EST'], ['NORD', 'NORD'], ['SE', 'SUD_EST'], ['INTER', 'INTERSECTEURS']];
const CMDS = ['TOP', 'HELP'];

export const HELP: [string, string][] = [
  ['8537', 'TRAIN : CARTE (SINON FICHE) · → MAREY, FICHE'],
  ['ATL · EST · NORD · SE · INTER', 'AXE DU MAREY'],
  ['MONTP', 'GARE OU VILLE (NOM PARTIEL) · → MAREY'],
  ['CARTE · MAREY · METHODO', 'PAGES F1 · F3 · F2'],
  ['SEMAINE', 'BILAN DE LA DERNIÈRE SEMAINE COMPLÈTE'],
  ['TOP', '10 PLUS GROS RETARDS'],
  ['HELP', 'CETTE AIDE'],
];

// Toutes les actions d'une suggestion, la par défaut en tête (les récents d'avant n'ont que `href`).
export function actionsOf(s: Suggestion): Action[] {
  return s.href ? [{ label: s.go ?? '', href: s.href }, ...(s.alt ?? [])] : [];
}

// Un train sur la carte s'ouvre sur la carte ; sinon sur sa fiche (CARTE n'est alors pas proposé).
const views = (number: string, first: View[]): Pick<Suggestion, 'href' | 'go' | 'alt'> => ({
  href: viewHref(first[0], number), go: first[0], alt: first.slice(1).map((v) => ({ label: v, href: viewHref(v, number) })),
});
const trainSuggestion = (t: CommandTrain, now: Date): Suggestion => ({
  kind: 'TRAIN', label: `${t.brand === 'OUIGO' ? 'OG' : 'IN'} ${t.train_number}${t.dest ? ` → ${t.dest.toUpperCase()}` : ''}`,
  ...views(t.train_number, t.stops && estimatePosition({ ...t, stops: t.stops }, now) ? ['CARTE', 'MAREY', 'FICHE'] : ['FICHE', 'MAREY']),
  delay_s: t.delay_s, cancelled: t.cancelled,
});
const gareSuggestion = (label: string, uics: string[]): Suggestion => ({
  kind: 'GARE', label, href: `/?gare=${uics.join(',')}`, go: 'CARTE', alt: [{ label: 'MAREY', href: `/marey?gare=${uics[0]}` }],
});

// Ville d'une gare : premier mot du nom, deux après un article (« Le Mans » et « Le Creusot » restent distincts).
// ponytail: heuristique sur les noms, une table ville → gares si un regroupement tombe faux.
export const cityOf = (nom: string) => {
  const w = nom.split(' ');
  return (/^(le|la|les)$/i.test(w[0]) ? w.slice(0, 2) : w.slice(0, 1)).join(' ');
};

// Suggestions dans l'ordre : commandes, pages et axes reconnus, trains (numéro qui commence par la saisie), gares (nom qui
// contient la saisie, sans accents), précédées de leur ville quand elle regroupe plusieurs gares trouvées.
export function suggest(query: string, data: CommandData, now = new Date()): Suggestion[] {
  const q = norm(query.trim()).toUpperCase();
  if (q === '') return [];
  const out: Suggestion[] = [];
  for (const c of CMDS) if (c.startsWith(q)) out.push({ kind: 'CMD', label: c, href: null });
  // Axes avant pages : « SE » reste l'axe Sud-Est et non la page SEMAINE.
  for (const [alias, axe] of AXES) if (alias.startsWith(q) || axe.startsWith(q.replace(/[ -]/g, '_'))) out.push({ kind: 'AXE', label: axe.replace('_', '-'), href: `/marey?axe=${axe}`, go: 'MAREY' });
  for (const [key, href, label] of PAGES) if (key.startsWith(q)) out.push({ kind: 'PAGE', label, href });
  if (/^\d{1,5}$/.test(q)) {
    const hits = data.trains.filter((t) => t.train_number.startsWith(q))
      .sort((a, b) => Number(b.train_number === q) - Number(a.train_number === q) || a.train_number.localeCompare(b.train_number));
    if (hits.length === 0) out.push({ kind: 'TRAIN', label: q, ...views(q, ['FICHE', 'MAREY']) }); // hors du flux : sa fiche
    out.push(...hits.map((t) => trainSuggestion(t, now)));
  } else if (q.length >= 2) {
    const g = data.gares.map(([uic, nom]) => ({ uic, nom, n: norm(nom).toUpperCase() })).filter((x) => x.n.includes(q));
    g.sort((a, b) => Number(b.n.startsWith(q)) - Number(a.n.startsWith(q)) || a.nom.localeCompare(b.nom, 'fr'));
    const cities = new Map<string, typeof g>();
    for (const x of g) cities.set(cityOf(x.nom), [...(cities.get(cityOf(x.nom)) ?? []), x]);
    for (const [city, xs] of cities) if (xs.length > 1) out.push(gareSuggestion(`${city.toUpperCase()} (${xs.length} GARES)`, xs.map((x) => x.uic)));
    out.push(...g.map((x) => gareSuggestion(x.nom.toUpperCase(), [x.uic])));
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

// Les n plus gros retards du moment, sous forme de suggestions (commande TOP : 10).
export function topSuggestions(trains: LiveItem[], n = 10, now = new Date()): Suggestion[] {
  return topDelays(trains, n).map((t) => trainSuggestion(t, now));
}

// Saisie vide : 3 plus gros retards puis les 3 dernières commandes ouvertes (sans doublon de lien).
export const RECENT_MAX = 3;
export function emptySuggestions(trains: LiveItem[], recents: Suggestion[], now = new Date()): Suggestion[] {
  const top = topSuggestions(trains, 3, now).map((s) => ({ ...s, group: 'TOP RETARDS' }));
  const seen = new Set(top.map((s) => s.href));
  return [...top, ...recents.filter((s) => !seen.has(s.href)).slice(0, RECENT_MAX).map((s) => ({ ...s, group: 'RÉCENTS' }))];
}

// Mémorise une commande ouverte en tête des récents (la plus récente d'abord, sans doublon).
export function pushRecent(recents: Suggestion[], s: Suggestion): Suggestion[] {
  const { group: _g, ...clean } = s;
  return [clean, ...recents.filter((r) => r.href !== s.href)].slice(0, RECENT_MAX + 3); // marge : les récents déjà dans le top sont masqués
}
