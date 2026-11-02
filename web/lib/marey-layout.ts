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

// Étiquettes de gares sur l'axe vertical, de haut en bas : colonne 0 si l'écart avec la précédente de cette colonne est d'au
// moins `minGap` px, sinon colonne 1 (décalée à gauche, avec un trait de rappel) si la place le permet, sinon masquée.
// La première et la dernière gare sont toujours en colonne 0.
export function layoutLabels(ys: number[], minGap: number, twoCols: boolean): (0 | 1 | null)[] {
  const out: (0 | 1 | null)[] = ys.map(() => null);
  if (ys.length === 0) return out;
  const last: [number, number] = [-Infinity, -Infinity];
  const end = ys.length - 1;
  ys.forEach((y, i) => {
    if (i === end && end > 0) return;
    if (y - last[0] >= minGap) { out[i] = 0; last[0] = y; } else if (twoCols && y - last[1] >= minGap) { out[i] = 1; last[1] = y; }
  });
  if (end > 0) {
    // La dernière gare prend la colonne 0 ; une étiquette trop proche y est déplacée en colonne 1 ou masquée.
    for (let i = end - 1; i >= 0 && ys[end] - ys[i] < minGap; i--) {
      if (out[i] !== 0) continue;
      const free = twoCols && !ys.some((y, j) => j !== i && out[j] === 1 && Math.abs(y - ys[i]) < minGap);
      out[i] = free ? 1 : null;
    }
    out[end] = 0;
  }
  return out;
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
