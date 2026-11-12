import { describe, expect, test } from 'vitest';
import { asCoupling, couplingLabel, shapeCoupling } from '../lib/train-coupling';

const raw = { partner: '8560', date: '2026-11-12', from: ['87671016', 'Dax'], to: ['87391003', 'Paris Montparnasse Hall 1 - 2'], together: null };

describe('shapeCoupling', () => {
  test('met en forme les noms de gare', () => {
    expect(shapeCoupling(raw)).toEqual({ partner: '8560', date: '2026-11-12', from: 'Dax', to: 'Paris Montparnasse', together: null });
  });
  test('réponse absente ou illisible : null', () => {
    for (const bad of [null, undefined, {}, { partner: 8560 }, { partner: '1', date: 'x', from: 'a', to: [] }]) expect(shapeCoupling(bad)).toBeNull();
  });
  test('nom manquant : le code UIC remplace le nom', () => {
    expect(shapeCoupling({ ...raw, from: ['87671016', null] })?.from).toBe('87671016');
  });
});

describe('asCoupling', () => {
  test('relit la réponse de l’API sans la transformer', () => {
    const served = { partner: '8560', date: '2026-11-12', from: 'Dax', to: 'Paris Montparnasse', together: true };
    expect(asCoupling(served)).toEqual(served);
    expect(asCoupling({ ...served, together: 'oui' })?.together).toBeNull();
  });
  test('null, tableau brut de la base ou champ manquant : null', () => {
    for (const bad of [null, undefined, {}, raw, { partner: '1', date: 'x', from: 'a' }]) expect(asCoupling(bad)).toBeNull();
  });
});

describe('couplingLabel', () => {
  const c = shapeCoupling(raw)!;
  test('prévu seul quand rien n’est mesuré', () => {
    expect(couplingLabel(c)).toEqual({ route: 'DE DAX À PARIS MONTPARNASSE (PRÉVU)', seen: null });
  });
  test('constat affiché seulement quand les deux trains ont circulé séparément', () => {
    expect(couplingLabel({ ...c, together: true }).seen).toBeNull();
    expect(couplingLabel({ ...c, together: false, date: '2026-11-10' }).seen).toBe('LE 10/11, LES DEUX TRAINS ONT CIRCULÉ SÉPARÉMENT (CONSTATÉ)');
  });
});
