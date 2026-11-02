import { expect, test } from 'vitest'
import { branchOf, buildBranches, orient, type MareyStop, type MareyTrip } from '../scripts/lib/marey-axes.ts'
import { pairKey } from '../scripts/lib/pair-key.ts'

const s = (stop_id: string, name: string, lon: number, lat: number): MareyStop => ({ stop_id, name, lon, lat })
const paris = s('P', 'Paris Montparnasse Hall 1 - 2', 2.32, 48.84)
const lemans = s('LM', 'Le Mans', 0.19, 48.0)
const rennes = s('R', 'Rennes', -1.67, 48.1)
const nantes = s('N', 'Nantes', -1.54, 47.22)
const croisic = s('C', 'Le Croisic', -2.51, 47.29)
const nazaire = s('SN', 'Saint-Nazaire', -2.21, 47.29)
const roche = s('RY', 'La Roche-sur-Yon', -1.44, 46.67)
const sables = s('SO', "Les Sables-d'Olonne", -1.78, 46.5)
const tours = s('T', 'Saint-Pierre-des-Corps', 0.72, 47.39)
const pairKeyOf = (a: MareyStop, b: MareyStop) => pairKey([a.lon, a.lat], [b.lon, b.lat])
const trip = (id: string, ...stops: MareyStop[]): MareyTrip => ({ trip_id: id, stops })
const names = (l: { gares: { nom: string }[] }) => l.gares.map((g) => g.nom)

test('orient : Paris en tête, sens inverse retourné, sans Paris refusé', () => {
  expect(orient([paris, lemans])?.map((x) => x.stop_id)).toEqual(['P', 'LM'])
  expect(orient([rennes, lemans, paris])?.map((x) => x.stop_id)).toEqual(['P', 'LM', 'R'])
  expect(orient([rennes, nantes])).toBeNull()
})

test('branchOf : la gare qui sépare les branches décide, le tronc seul ne classe pas', () => {
  expect(branchOf([paris, lemans, rennes])).toBe('bretagne')
  expect(branchOf([paris, lemans, nantes])).toBe('pays-de-la-loire')
  expect(branchOf([paris, tours])).toBe('sud-ouest')
  expect(branchOf([paris, lemans])).toBeNull()
})

test('buildBranches : une ligne par terminus sous Nantes, tronc répété, ligne contenue fusionnée', () => {
  const pdl = buildBranches([
    trip('a', paris, lemans, nantes, nazaire, croisic),
    trip('b', croisic, nazaire, nantes, lemans, paris),
    trip('c', paris, lemans, nantes, roche, sables),
    trip('d', paris, lemans, nantes), // Paris → Nantes : contenu dans les deux lignes, pas de ligne à lui
  ], {}).find((b) => b.id === 'pays-de-la-loire')!
  expect(pdl.lignes.map((l) => [l.id, l.label])).toEqual([['le-croisic', 'Le Croisic'], ['les-sables-d-olonne', "Les Sables-d'Olonne"]])
  expect(names(pdl.lignes[0])).toEqual(['Paris Montparnasse Hall 1 - 2', 'Le Mans', 'Nantes', 'Saint-Nazaire', 'Le Croisic'])
  expect(names(pdl.lignes[1])).toEqual(['Paris Montparnasse Hall 1 - 2', 'Le Mans', 'Nantes', 'La Roche-sur-Yon', "Les Sables-d'Olonne"])
  expect(pdl.lignes[0].gares[0].km).toBe(0)
  expect(pdl.lignes[0].gares[2].km).toBe(pdl.lignes[1].gares[2].km) // Nantes au même km sur les deux lignes
})

test('buildBranches : une gare à deux stop_id est fusionnée ; un tracé en détour est remplacé par la ligne droite', () => {
  const lemans2 = { ...lemans, stop_id: 'LM2' }
  const detour = { [pairKeyOf(paris, lemans)]: [[2.32, 48.84], [10, 60], [0.19, 48.0]] as [number, number][] }
  const [b] = buildBranches([trip('a', paris, lemans, rennes), trip('b', paris, lemans2, rennes)], detour).filter((x) => x.id === 'bretagne')
  const g = b.lignes[0].gares.find((x) => x.nom === 'Le Mans')!
  expect(g.stop_ids).toEqual(['LM', 'LM2'])
  expect(g.km).toBeLessThan(220) // Paris–Le Mans à vol d'oiseau ≈ 180 km, × 1,1
})
