import { expect, test } from 'vitest';
import { MAX_SUGGESTIONS, actionsOf, cityOf, emptySuggestions, pushRecent, suggest, type CommandData, type Suggestion } from '../lib/command';
import type { LiveItem } from '../lib/map-model';

const NOW = new Date('2026-11-02T12:00:00Z');
const t = (train_number: string, axis: string, delay_s = 0, dest = 'Bordeaux St-Jean') =>
  ({ train_number, brand: 'INOUI', origin: 'Paris', dest, delay_s, cancelled: false, axis });
// Un seul arrêt connu, avec coordonnées : position estimée (le train est sur la carte).
const onMap = { ...t('8537', 'ATLANTIQUE', 1200), stops: [{ seq: 1, lat: 44.8, lon: -0.55 }] };
const data: CommandData = {
  trains: [onMap, t('8538', 'ATLANTIQUE'), t('85', 'INCONNU'), t('6612', 'SUD_EST')],
  gares: [['87581009', 'Bordeaux St-Jean'], ['87713040', 'Le Creusot TGV'], ['87471003', 'Angers St-Laud'],
    ['87773002', 'Montpellier Saint-Roch'], ['87688887', 'Montpellier Sud de France'], ['87396002', 'Le Mans']],
};
const labels = (q: string) => suggest(q, data, NOW).map((s) => `${s.kind} ${s.label} ${s.href}`);
const acts = (s: Suggestion) => actionsOf(s).map((a) => `${a.label} ${a.href}`);

test('train : sur la carte, Entrée = CARTE puis MAREY et FICHE ; sinon FICHE puis MAREY ; hors flux, sa fiche', () => {
  expect(labels('8537')).toEqual(['TRAIN IN 8537 → BORDEAUX ST-JEAN /?sel=8537']);
  expect(acts(suggest('8537', data, NOW)[0])).toEqual(['CARTE /?sel=8537', 'MAREY /marey?train=8537', 'FICHE /train/8537']);
  expect(suggest('8537', data, NOW)[0]).toMatchObject({ delay_s: 1200, cancelled: false });
  expect(acts(suggest('8538', data, NOW)[0])).toEqual(['FICHE /train/8538', 'MAREY /marey?train=8538']); // sans position
  expect(labels('853')).toEqual(['TRAIN IN 8537 → BORDEAUX ST-JEAN /?sel=8537', 'TRAIN IN 8538 → BORDEAUX ST-JEAN /train/8538']);
  expect(labels('9999')).toEqual(['TRAIN 9999 /train/9999']);
  expect(acts(suggest('9999', data, NOW)[0])).toEqual(['FICHE /train/9999', 'MAREY /marey?train=9999']);
});

test('axes, pages et commandes : alias, insensibles à la casse', () => {
  expect(labels('atl')).toEqual(['AXE ATLANTIQUE /marey?axe=ATLANTIQUE']);
  expect(acts(suggest('atl', data, NOW)[0])).toEqual(['MAREY /marey?axe=ATLANTIQUE']);
  expect(labels('se')[0]).toBe('AXE SUD-EST /marey?axe=SUD_EST');
  expect(labels('Inter')).toEqual(['AXE INTERSECTEURS /marey?axe=INTERSECTEURS']);
  expect(labels('carte')).toEqual(['PAGE F1 CARTE /']);
  expect(labels('méthodo')).toEqual(['PAGE F2 MÉTHODO /methodologie']);
  expect(labels('top')).toEqual(['CMD TOP null']);
  expect(labels('help')).toEqual(['CMD HELP null']);
});

test('gares : nom partiel sans accents, début du nom en premier, ville regroupée en tête ; rien d’inconnu ; 6 suggestions au plus', () => {
  expect(labels('bord')).toEqual(['GARE BORDEAUX ST-JEAN /?gare=87581009']);
  expect(acts(suggest('bord', data, NOW)[0])).toEqual(['CARTE /?gare=87581009', 'MAREY /marey?gare=87581009']);
  expect(labels('creus')).toEqual(['GARE LE CREUSOT TGV /?gare=87713040']);
  expect(labels('st')).toEqual(['GARE ANGERS ST-LAUD /?gare=87471003', 'GARE BORDEAUX ST-JEAN /?gare=87581009']);
  expect(labels('montp')).toEqual([
    'GARE MONTPELLIER (2 GARES) /?gare=87773002,87688887', 'GARE MONTPELLIER SAINT-ROCH /?gare=87773002', 'GARE MONTPELLIER SUD DE FRANCE /?gare=87688887',
  ]);
  expect(labels('le ')).toEqual(['GARE LE CREUSOT TGV /?gare=87713040', 'GARE LE MANS /?gare=87396002']); // « Le » n'est pas une ville
  expect(cityOf('Lyon Part Dieu')).toBe('Lyon');
  expect(cityOf('Le Mans')).toBe('Le Mans');
  expect(suggest('zzz', data)).toEqual([]);
  expect(suggest('  ', data)).toEqual([]);
  const many = { ...data, trains: Array.from({ length: 9 }, (_, i) => t(`70${i}`, 'EST')) };
  expect(suggest('70', many, NOW)).toHaveLength(MAX_SUGGESTIONS);
});

test('saisie vide : 3 plus gros retards puis récents sans doublon ; récents en tête, dédoublonnés', () => {
  const live = [t('1', 'EST', 600), t('2', 'EST', 1800), t('3', 'EST', 60), t('4', 'EST', 120), t('5', 'EST', 0)] as unknown as LiveItem[];
  const gare: Suggestion = { kind: 'GARE', label: 'BORDEAUX ST-JEAN', href: '/?gare=87581009' };
  const train2: Suggestion = { kind: 'TRAIN', label: 'IN 2', href: '/train/2' };
  let recents: Suggestion[] = [];
  recents = pushRecent(recents, train2);
  recents = pushRecent(recents, gare);
  recents = pushRecent(recents, { ...train2, group: 'TOP RETARDS' });
  expect(recents.map((r) => r.href)).toEqual([train2.href, gare.href]);
  expect(recents[0].group).toBeUndefined();
  const out = emptySuggestions(live, recents, NOW);
  expect(out.map((s) => `${s.group} ${s.href}`)).toEqual([
    'TOP RETARDS /train/2', 'TOP RETARDS /train/1', 'TOP RETARDS /train/4',
    'RÉCENTS /?gare=87581009',
  ]);
  // Récent d'avant (sans actions nommées) : seule l'action par défaut.
  expect(actionsOf({ kind: 'GARE', label: 'X', href: '/marey?gare=1' })).toEqual([{ label: '', href: '/marey?gare=1' }]);
});
