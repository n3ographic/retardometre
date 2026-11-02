import { expect, test } from 'vitest';
import { MAX_SUGGESTIONS, emptySuggestions, pushRecent, suggest, type CommandData, type Suggestion } from '../lib/command';
import type { LiveItem } from '../lib/map-model';

const t = (train_number: string, axis: string, delay_s = 0, dest = 'Bordeaux St-Jean') =>
  ({ train_number, brand: 'INOUI', origin: 'Paris', dest, delay_s, cancelled: false, axis });
const data: CommandData = {
  trains: [t('8537', 'ATLANTIQUE', 1200), t('8538', 'ATLANTIQUE'), t('85', 'INCONNU'), t('6612', 'SUD_EST')],
  gares: [['87581009', 'Bordeaux St-Jean'], ['87713040', 'Le Creusot TGV'], ['87471003', 'Angers St-Laud']],
};
const labels = (q: string) => suggest(q, data).map((s) => `${s.kind} ${s.label} ${s.href}`);

test('train : numéro exact en premier, lien Marey avec axe ; hors axe ou hors flux, le Marey cherche par numéro', () => {
  expect(labels('8537')).toEqual(['TRAIN IN 8537 → BORDEAUX ST-JEAN /marey?axe=ATLANTIQUE&train=8537']);
  expect(suggest('8537', data)[0]).toMatchObject({ delay_s: 1200, cancelled: false });
  expect(labels('85')[0]).toBe('TRAIN IN 85 → BORDEAUX ST-JEAN /marey?train=85');
  expect(labels('853')).toEqual(['TRAIN IN 8537 → BORDEAUX ST-JEAN /marey?axe=ATLANTIQUE&train=8537', 'TRAIN IN 8538 → BORDEAUX ST-JEAN /marey?axe=ATLANTIQUE&train=8538']);
  expect(labels('9999')).toEqual(['TRAIN 9999 /marey?train=9999']);
});

test('axes, pages et commandes : alias, insensibles à la casse', () => {
  expect(labels('atl')).toEqual(['AXE ATLANTIQUE /marey?axe=ATLANTIQUE']);
  expect(labels('se')[0]).toBe('AXE SUD-EST /marey?axe=SUD_EST');
  expect(labels('Inter')).toEqual(['AXE INTERSECTEURS /marey?axe=INTERSECTEURS']);
  expect(labels('carte')).toEqual(['PAGE F1 CARTE /']);
  expect(labels('méthodo')).toEqual(['PAGE F2 MÉTHODO /methodologie']);
  expect(labels('top')).toEqual(['CMD TOP null']);
  expect(labels('help')).toEqual(['CMD HELP null']);
});

test('gares : nom partiel sans accents, début du nom en premier ; rien d’inconnu ; 6 suggestions au plus', () => {
  expect(labels('bord')).toEqual(['GARE BORDEAUX ST-JEAN /marey?gare=87581009']);
  expect(labels('creus')).toEqual(['GARE LE CREUSOT TGV /marey?gare=87713040']);
  expect(labels('st')).toEqual(['GARE ANGERS ST-LAUD /marey?gare=87471003', 'GARE BORDEAUX ST-JEAN /marey?gare=87581009']);
  expect(suggest('zzz', data)).toEqual([]);
  expect(suggest('  ', data)).toEqual([]);
  const many = { ...data, trains: Array.from({ length: 9 }, (_, i) => t(`70${i}`, 'EST')) };
  expect(suggest('70', many)).toHaveLength(MAX_SUGGESTIONS);
});

test('saisie vide : 3 plus gros retards puis récents sans doublon ; récents en tête, dédoublonnés', () => {
  const live = [t('1', 'EST', 600), t('2', 'EST', 1800), t('3', 'EST', 60), t('4', 'EST', 120), t('5', 'EST', 0)] as unknown as LiveItem[];
  const gare: Suggestion = { kind: 'GARE', label: 'BORDEAUX ST-JEAN', href: '/marey?gare=87581009' };
  const train2: Suggestion = { kind: 'TRAIN', label: 'IN 2', href: '/marey?axe=EST&train=2' };
  let recents: Suggestion[] = [];
  recents = pushRecent(recents, train2);
  recents = pushRecent(recents, gare);
  recents = pushRecent(recents, { ...train2, group: 'TOP RETARDS' });
  expect(recents.map((r) => r.href)).toEqual([train2.href, gare.href]);
  expect(recents[0].group).toBeUndefined();
  const out = emptySuggestions(live, recents);
  expect(out.map((s) => `${s.group} ${s.href}`)).toEqual([
    'TOP RETARDS /marey?axe=EST&train=2', 'TOP RETARDS /marey?axe=EST&train=1', 'TOP RETARDS /marey?axe=EST&train=4',
    'RÉCENTS /marey?gare=87581009',
  ]);
});
