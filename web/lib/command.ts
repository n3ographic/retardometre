import type { LiveItem } from './map-model';
import { mareyHref } from './marey';
import { topDelays } from './terminal-model';
import { norm } from './train-search';

// Barre de commande (« / » ou Ctrl+K) : suggestions calculées à la main sur les trains du flux (/api/live) et les gares (/api/gares).
export type Kind = 'TRAIN' | 'AXE' | 'GARE' | 'PAGE' | 'CMD';
export type Suggestion = { kind: Kind; label: string; href: string | null; delay_s?: number; cancelled?: boolean };
export type CommandData = { trains: Pick<LiveItem, 'train_number' | 'brand' | 'origin' | 'dest' | 'delay_s' | 'cancelled' | 'axis'>[]; gares: [string, string][] };

export const MAX_SUGGESTIONS = 6;
export const UNKNOWN = 'COMMANDE INCONNUE · TAPEZ HELP';

const PAGES: [string, string, string][] = [['CARTE', '/', 'F1 CARTE'], ['METHODO', '/methodologie', 'F2 MÉTHODO'], ['MAREY', '/marey', 'F3 MAREY']];
const AXES: [string, string][] = [['ATL', 'ATLANTIQUE'], ['EST', 'EST'], ['NORD', 'NORD'], ['SE', 'SUD_EST'], ['INTER', 'INTERSECTEURS']];
const CMDS = ['TOP', 'HELP'];

export const HELP: [string, string][] = [
  ['8537', 'TRAIN PAR NUMÉRO'],
  ['ATL · EST · NORD · SE · INTER', 'AXE DU MAREY'],
  ['BORD', 'GARE (NOM PARTIEL)'],
  ['CARTE · MAREY · METHODO', 'PAGES F1 · F3 · F2'],
  ['TOP', '10 PLUS GROS RETARDS'],
  ['HELP', 'CETTE AIDE'],
];

const trainSuggestion = (t: CommandData['trains'][number]): Suggestion => ({
  kind: 'TRAIN', label: `${t.brand === 'OUIGO' ? 'OG' : 'IN'} ${t.train_number}${t.dest ? ` → ${t.dest.toUpperCase()}` : ''}`,
  href: mareyHref(t) ?? `/marey?train=${t.train_number}`, delay_s: t.delay_s, cancelled: t.cancelled,
});

// Suggestions dans l'ordre : commandes, pages et axes reconnus, trains (numéro qui commence par la saisie), gares (nom qui contient la saisie).
export function suggest(query: string, data: CommandData): Suggestion[] {
  const q = norm(query.trim()).toUpperCase();
  if (q === '') return [];
  const out: Suggestion[] = [];
  for (const c of CMDS) if (c.startsWith(q)) out.push({ kind: 'CMD', label: c, href: null });
  for (const [key, href, label] of PAGES) if (key.startsWith(q)) out.push({ kind: 'PAGE', label, href });
  for (const [alias, axe] of AXES) if (alias.startsWith(q) || axe.startsWith(q.replace(/[ -]/g, '_'))) out.push({ kind: 'AXE', label: axe.replace('_', '-'), href: `/marey?axe=${axe}` });
  if (/^\d{1,5}$/.test(q)) {
    const hits = data.trains.filter((t) => t.train_number.startsWith(q))
      .sort((a, b) => Number(b.train_number === q) - Number(a.train_number === q) || a.train_number.localeCompare(b.train_number));
    if (hits.length === 0) out.push({ kind: 'TRAIN', label: q, href: `/marey?train=${q}` }); // hors du flux : le Marey le cherche
    out.push(...hits.map(trainSuggestion));
  } else if (q.length >= 2) {
    const g = data.gares.map(([uic, nom]) => ({ uic, nom, n: norm(nom).toUpperCase() })).filter((x) => x.n.includes(q));
    g.sort((a, b) => Number(b.n.startsWith(q)) - Number(a.n.startsWith(q)) || a.nom.localeCompare(b.nom, 'fr'));
    out.push(...g.map((x) => ({ kind: 'GARE' as const, label: x.nom.toUpperCase(), href: `/marey?gare=${x.uic}` })));
  }
  return out.slice(0, MAX_SUGGESTIONS);
}

// Les 10 plus gros retards du moment, sous forme de suggestions (commande TOP).
export function topSuggestions(trains: LiveItem[]): Suggestion[] {
  return topDelays(trains, 10).map(trainSuggestion);
}
