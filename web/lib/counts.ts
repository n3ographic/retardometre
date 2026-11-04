// Définitions de comptage communes à l'accueil, /semaine, /train et /methodologie.
// Un train observé (et terminé) tombe dans une seule catégorie : a roulé, supprimé, terminus non desservi ou aberrant.
// Seuls les trains qui ont roulé entrent dans la régularité et les indemnités.
export type CountKey = 'observed' | 'circulated' | 'cancelled' | 'no_terminus' | 'aberrant';
export type Counts = Record<CountKey, number>;

export const COUNT_LABELS: Record<CountKey, { short: string; long: string }> = {
  observed: { short: 'OBSERVÉS', long: 'Vus au moins une fois dans le flux temps réel, y compris supprimés' },
  circulated: { short: 'ONT ROULÉ', long: 'Observés, non supprimés, avec un retard publié au terminus (moins de 12 h)' },
  cancelled: { short: 'SUPPR.', long: 'Observés et supprimés sur tout le parcours' },
  no_terminus: { short: 'TERMINUS NON DESSERVI', long: 'Observés, non supprimés, sans retard publié au terminus : en pratique terminus supprimé (parcours limité)' },
  aberrant: { short: 'ABERRANT', long: 'Retard publié au terminus d’au moins 12 h : erreur de donnée ou train reporté, inutilisable comme retard et écarté' },
};

export const COUNT_KEYS: CountKey[] = ['observed', 'circulated', 'cancelled', 'no_terminus', 'aberrant'];
const PARTS = COUNT_KEYS.slice(1);
const nf = (n: number) => n.toLocaleString('fr-FR');

// « 7 301 OBSERVÉS · 7 104 ONT ROULÉ · 90 SUPPR. · 106 TERMINUS NON DESSERVI · 1 ABERRANT » ; les catégories rares à zéro sont omises.
export function breakdownText(c: Counts): string {
  const parts = PARTS.filter((k) => k === 'circulated' || c[k] > 0).map((k) => `${nf(c[k])} ${COUNT_LABELS[k].short}`);
  return [`${nf(c.observed)} ${COUNT_LABELS.observed.short}`, ...parts].join(' · ');
}