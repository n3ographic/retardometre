import { expect, test } from 'vitest';
import { makeSegment, pairKey, straightLines, tracesToLines } from '../lib/traces';

const A: [number, number] = [2.3331, 48.8441];
const B: [number, number] = [4.8591, 45.7601];

test('pairKey : identique dans les deux sens, arrondi à 3 décimales', () => {
  expect(pairKey(A, B)).toBe(pairKey(B, A));
  expect(pairKey([2.3331, 48.8441], B)).toBe(pairKey([2.3334, 48.8444], B));
  expect(pairKey([2.3331, 48.8441], B)).not.toBe(pairKey([2.3341, 48.8441], B));
});

test('makeSegment : tracé stocké, inversé dans l’autre sens, repli droit', () => {
  const line: [number, number][] = [[2.333, 48.844], [3.5, 47], [4.859, 45.76]];
  const seg = makeSegment({ pairs: { [pairKey(A, B)]: line } });
  expect(seg(A, B)).toEqual([A, ...line, B]);
  expect(seg(B, A)).toEqual([B, ...[...line].reverse(), A]);
  expect(seg(A, [1, 1])).toEqual([A, [1, 1]]);
  expect(makeSegment({ pairs: {} })(A, B)).toEqual([A, B]);
});

test('makeSegment : extrémités du tracé = nœuds du réseau à plusieurs centaines de mètres des gares', () => {
  // Le premier point du tracé n'est pas la gare : le sens se décide par proximité, pas par égalité.
  const line: [number, number][] = [[2.338, 48.846], [3.5, 47], [4.855, 45.763]]; // ≈ 500 m de A et de B
  const seg = makeSegment({ pairs: { [pairKey(A, B)]: line } });
  expect(seg(A, B)).toEqual([A, ...line, B]);
  expect(seg(B, A)).toEqual([B, ...[...line].reverse(), A]);
  const rev = makeSegment({ pairs: { [pairKey(A, B)]: [...line].reverse() } });
  expect(rev(A, B)).toEqual([A, ...line, B]);
});

test('tracesToLines : une ligne par paire, polylignes de moins de deux points ignorées', () => {
  const fc = tracesToLines({ pairs: { a: [[2, 48], [3, 47]], b: [[3, 47], [4, 46], [5, 45]], c: [[1, 1]], d: [] } });
  expect(fc.type).toBe('FeatureCollection');
  expect(fc.features).toHaveLength(2);
  expect(fc.features[1].geometry).toEqual({ type: 'LineString', coordinates: [[3, 47], [4, 46], [5, 45]] });
  expect(tracesToLines({ pairs: {} }).features).toEqual([]);
});

test('straightLines : paires sans tracé, une fois chacune, arrêts sans coordonnées ignorés', () => {
  const C: [number, number] = [5.3698, 43.3026];
  const table = { pairs: { [pairKey(A, B)]: [A, B] } };
  const stop = ([lon, lat]: [number, number]) => ({ lon, lat });
  const trains = [
    { stops: [stop(A), stop(B), stop(C)] },
    { stops: [stop(C), stop(B), {}, stop(A)] },
  ];
  expect(straightLines(table, trains).features.map((f) => f.geometry.coordinates)).toEqual([[B, C]]);
  expect(straightLines({ pairs: {} }, [{ stops: [stop(A), stop(B)] }]).features).toHaveLength(1);
});
