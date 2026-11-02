import { expect, test } from 'vitest';
import type { RawStop } from '../lib/marey';
import { buildAxis, sector, type Gares } from '../lib/marey-lines';

const gares: Gares = {
  P: { nom: 'Paris Montparnasse Hall 1 - 2', lat: 48.84, lon: 2.32 },
  LM: { nom: 'Le Mans', lat: 48.0, lon: 0.19 },
  SB: { nom: 'Sablé-sur-Sarthe', lat: 47.84, lon: -0.34 },
  AN: { nom: 'Angers Saint-Laud', lat: 47.46, lon: -0.56 },
  N: { nom: 'Nantes', lat: 47.22, lon: -1.54 },
  SN: { nom: 'Saint-Nazaire', lat: 47.29, lon: -2.21 },
  C: { nom: 'Le Croisic', lat: 47.29, lon: -2.51 },
  L: { nom: 'Laval', lat: 48.08, lon: -0.76 },
  R: { nom: 'Rennes', lat: 48.1, lon: -1.67 },
  B: { nom: 'Brest', lat: 48.39, lon: -4.48 },
  T: { nom: 'Saint-Pierre-des-Corps', lat: 47.39, lon: 0.72 },
  PO: { nom: 'Poitiers', lat: 46.58, lon: 0.33 },
  BX: { nom: 'Bordeaux Saint-Jean', lat: 44.83, lon: -0.56 },
  NI: { nom: 'Niort', lat: 46.32, lon: -0.45 },
  LR: { nom: 'La Rochelle', lat: 46.15, lon: -1.15 },
  LI: { nom: 'Lille Europe', lat: 50.64, lon: 3.08 },
  BR: { nom: 'Bruxelles Midi', lat: 50.84, lon: 4.34 },
  MA: { nom: 'Marseille Saint-Charles', lat: 43.3, lon: 5.38 },
  LY: { nom: 'Lyon Part Dieu', lat: 45.76, lon: 4.86 },
};
const train = (...codes: string[]) => ({ stops: codes.map((c, i): RawStop => [c, i * 1000, i * 1000, 0, false, i]) });
const times = (n: number, ...codes: string[]) => Array.from({ length: n }, () => train(...codes));
const names = (l: { gares: { nom: string }[] }) => l.gares.map((g) => g.nom);

test('radial : une vue par terminus (deux sens), Paris en haut, branches nommées, petite destination dans AUTRES', () => {
  const b = buildAxis([
    ...times(4, 'P', 'LM', 'SB', 'AN', 'N'),
    ...times(3, 'C', 'SN', 'N', 'AN', 'LM', 'P'), // sens inverse : même vue, Paris en haut
    ...times(3, 'P', 'LM', 'L', 'R', 'B'),
    ...times(3, 'P', 'T', 'PO', 'BX'),
    ...times(2, 'P', 'T', 'PO', 'NI', 'LR'),
  ], gares, 'ATLANTIQUE');
  expect(b.branches.map((x) => x.label).sort()).toEqual(['BRETAGNE', 'PAYS DE LA LOIRE', 'SUD-OUEST']);
  const pdl = b.branches.find((x) => x.label === 'PAYS DE LA LOIRE')!;
  expect(pdl.lignes.map((l) => l.label)).toEqual(['Nantes', 'Le Croisic']);
  // Le Croisic reprend le tronc des Nantes, dont Sablé que ses trains ne desservent pas.
  expect(names(pdl.lignes[1])).toEqual(['Paris Montparnasse Hall 1 - 2', 'Le Mans', 'Sablé-sur-Sarthe', 'Angers Saint-Laud', 'Nantes', 'Saint-Nazaire', 'Le Croisic']);
  const km = pdl.lignes[1].gares.map((g) => g.km);
  expect(km[0]).toBe(0);
  expect([...km].sort((x, y) => x - y)).toEqual(km); // distances croissantes
  const so = b.branches.find((x) => x.label === 'SUD-OUEST')!;
  expect(so.autres.map((l) => [l.label, l.trains])).toEqual([['La Rochelle', 2]]);
  // Niort n'est pas sur le chemin Poitiers → Bordeaux : la vue Bordeaux ne le reprend pas.
  expect(names(so.lignes[0])).not.toContain('Niort');
  expect(b.warnings).toEqual([]);
});

test('ordre contradictoire entre deux trains : signalé, la vue garde un ordre unique', () => {
  const b = buildAxis([...times(2, 'P', 'LM', 'L', 'R'), ...times(2, 'P', 'L', 'LM', 'R')], gares, 'ATLANTIQUE');
  expect(b.warnings).toHaveLength(1);
  expect(b.warnings[0]).toContain('ordre contradictoire');
  const l = b.branches[0].lignes[0] ?? b.branches[0].autres[0];
  expect(new Set(names(l)).size).toBe(names(l).length);
});

test('intersecteurs : pas de tronc parisien, corridor par secteurs, le bout le plus au nord en haut, gares étrangères incluses', () => {
  expect(sector(gares.LI)).toBe('NORD');
  expect(sector(gares.MA)).toBe('SUD-EST');
  expect(sector(gares.R)).toBe('OUEST');
  const b = buildAxis([...times(3, 'MA', 'LY', 'LI', 'BR'), ...times(3, 'R', 'LM', 'LY', 'MA')], gares, 'INTERSECTEURS');
  expect(b.branches.map((x) => x.label).sort()).toEqual(['NORD ↔ SUD-EST', 'SUD-EST ↔ OUEST']);
  const nse = b.branches.find((x) => x.label === 'NORD ↔ SUD-EST')!.lignes[0];
  expect(names(nse)).toEqual(['Bruxelles Midi', 'Lille Europe', 'Lyon Part Dieu', 'Marseille Saint-Charles']);
  expect(nse.label).toBe('Bruxelles Midi ↔ Marseille Saint-Charles');
});
