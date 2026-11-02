// Lisibilité du diagramme de Marey : noms de gares abrégés, placement des étiquettes, numéros de train sans chevauchement.

// Abréviations voulues (prioritaires) ; sinon règles génériques puis troncature avec « … », jamais de coupure brute.
const ABBR: Record<string, string> = {
  'Paris Montparnasse Hall 1 - 2': 'PARIS MONTP.',
  'Paris Montparnasse': 'PARIS MONTP.',
  'Paris Gare de Lyon Hall 1 - 2': 'PARIS GARE DE LYON',
  'Paris Gare du Nord': 'PARIS NORD',
  'Paris Est': 'PARIS EST',
  'Bordeaux Saint-Jean': 'BORDEAUX ST-JEAN',
  'Saint-Pierre-des-Corps': 'ST-PIERRE-DES-CORPS',
  'Angers Saint-Laud': 'ANGERS ST-LAUD',
  'Lyon Part Dieu': 'LYON PART-DIEU',
  'Lyon Saint-Exupéry TGV': 'LYON ST-EXUPÉRY',
  'Marseille Saint-Charles': 'MARSEILLE ST-CH.',
  'Montpellier Saint-Roch': 'MONTPELLIER ST-ROCH',
  'Montpellier Sud de France': 'MONTPELLIER SUD-FR.',
  'Saint-Étienne Châteaucreux': 'ST-ÉTIENNE CHÂT.',
  'Vendôme - Villiers-sur-Loir': 'VENDÔME',
  'Aéroport Charles de Gaulle 2 TGV': 'CDG AÉROPORT',
  'Marne-la-Vallée Chessy': 'MARNE-LA-VALLÉE',
  'Champagne-Ardenne TGV': 'CHAMPAGNE TGV',
  'Rang-du-Fliers - Verton - Berck': 'RANG-DU-FLIERS',
  'Freiburg (Breisgau) Hbf': 'FREIBURG HBF',
  'MILANO PORTA GARIBALDI': 'MILANO P. GARIBALDI',
  'Chambéry - Challes-les-Eaux': 'CHAMBÉRY',
  'Aix-les-Bains le Revard': 'AIX-LES-BAINS',
  'Mâcon - Loché TGV': 'MÂCON-LOCHÉ TGV',
  'Valence TGV Rhône-Alpes Sud': 'VALENCE TGV',
  'Belfort - Montbéliard TGV': 'BELFORT-MONTB. TGV',
  'Besançon Franche-Comté TGV': 'BESANÇON TGV',
  'TGV Haute Picardie': 'HAUTE-PICARDIE TGV',
  "Saint-Maixent-L'École": "ST-MAIXENT",
};
export const LABEL_MAX = 19;

export function shortName(nom: string, max = LABEL_MAX): string {
  const n = ABBR[nom] ?? nom
    .replace(/ Hall .*$/, '')
    .replace(/\bSaint-/g, 'St-').replace(/\bSainte-/g, 'Ste-')
    .replace(/ - /g, '-')
    .toUpperCase();
  if (n.length <= max) return n;
  // Coupe au dernier séparateur avant la limite, puis « … ».
  const cut = n.slice(0, max - 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('-'));
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[ -]+$/, '')}…`;
}

// Étiquettes de gares sur une seule colonne : chacune au plus près de sa gare, écartées d'au moins `gap` px. Les gares trop
// proches forment un groupe centré sur leur hauteur moyenne, borné à [top, bottom] ; un trait relie ensuite chaque nom à sa
// gare. S'il n'y a pas la place pour toutes, la colonne est tassée régulièrement (chevauchement plutôt que nom masqué).
export function spreadLabels(ys: number[], gap: number, top: number, bottom: number): number[] {
  const step = ys.length > 1 ? Math.min(gap, (bottom - top) / (ys.length - 1)) : gap;
  const groups: { first: number; n: number; sum: number; at: number }[] = [];
  const place = (g: (typeof groups)[number]) => {
    g.at = Math.min(Math.max(g.sum / g.n - ((g.n - 1) * step) / 2, top), bottom - (g.n - 1) * step);
  };
  ys.forEach((y, i) => {
    const g = { first: i, n: 1, sum: y, at: y };
    place(g);
    groups.push(g);
    // Fusion tant que le groupe chevauche le précédent.
    while (groups.length > 1) {
      const a = groups[groups.length - 2], b = groups[groups.length - 1];
      if (a.at + a.n * step <= b.at + 1e-9) break;
      a.n += b.n; a.sum += b.sum; place(a); groups.pop();
    }
  });
  return groups.flatMap((g) => Array.from({ length: g.n }, (_, k) => g.at + k * step));
}

export type Box = { key: string; x: number; y: number; w: number; h: number; priority: number };

// Numéros en bout de ligne : on garde, par priorité décroissante, ceux dont la boîte englobante ne touche aucune boîte déjà
// gardée (2 px de marge). Le train surligné passe en premier, puis les plus en retard.
export function pickLabels(boxes: Box[], pad = 2): Box[] {
  const kept: Box[] = [];
  for (const b of [...boxes].sort((a, c) => c.priority - a.priority)) {
    const hit = kept.some((k) => b.x < k.x + k.w + pad && k.x < b.x + b.w + pad && b.y < k.y + k.h + pad && k.y < b.y + b.h + pad);
    if (!hit) kept.push(b);
  }
  return kept;
}

// Gare hors de France : aucun de ses codes UIC ne commence par 87 (code pays SNCF).
export const isForeign = (stopIds: string[]) => stopIds.length > 0 && stopIds.every((id) => !id.startsWith('87'));
