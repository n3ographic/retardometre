import { expect, test, vi } from 'vitest';
import type { Deps } from '../lib/handlers';
import { loadRules, shapeRules } from '../lib/rules';
import { prices, scale } from './fixtures';

const now = new Date('2026-10-21T10:00:00Z');
const regularity = [
  { duration_from_s: 10801, max_delay_exclusive_s: 900, source_url: 'u' },
  { duration_from_s: 0, max_delay_exclusive_s: 300, source_url: 'u' },
  { duration_from_s: 5400, max_delay_exclusive_s: 600, source_url: 'u' },
];

test('shapeRules : nombres convertis, tri, horodatage', () => {
  const r = shapeRules({
    scale: [{ ...scale[0], from_s: '3600', pct: '25' }, scale[1], scale[2]],
    regularity,
    prices: [{ ...prices[0], price_eur_ht: '34.20', seats: '634' }, prices[1]],
  }, now);
  expect(r.generated_at).toBe('2026-10-21T10:00:00.000Z');
  expect(r.compensation_scale.map((s) => `${s.brand} ${s.from_s}`)).toEqual(['INOUI 1800', 'INOUI 7200', 'OUIGO 3600']);
  expect(r.compensation_scale[2]).toMatchObject({ from_s: 3600, pct: 25 });
  expect(r.regularity_rule.map((x) => x.duration_from_s)).toEqual([0, 5400, 10801]);
  expect(r.reference_prices.map((p) => p.brand)).toEqual(['INOUI', 'OUIGO']);
  expect(r.reference_prices[1]).toMatchObject({ price_eur_ht: 34.2, seats: 634 });
});

test('shapeRules : tables vides acceptées, valeur illisible refusée', () => {
  expect(shapeRules({ scale: [], regularity: [], prices: [] }, now))
    .toMatchObject({ compensation_scale: [], regularity_rule: [], reference_prices: [] });
  expect(() => shapeRules({ scale: [{ ...scale[0], pct: 'abc' }], regularity: [], prices: [] }, now)).toThrow(/pct/);
});

const okSelect = (table: string) =>
  Promise.resolve({ data: table === 'reference_prices' ? prices : table === 'compensation_scale' ? scale : regularity, error: null });
const deps = (select: Deps['select'], cached: Deps['cached']) => ({ select, cached, now: () => now, rpc: vi.fn() }) as unknown as Deps;

test('loadRules : trois lectures, clé de cache et durée', async () => {
  const cached = vi.fn(async <T>(_k: string[], _s: number, fn: () => Promise<T>) => fn()) as unknown as Deps['cached'];
  const select = vi.fn(okSelect) as unknown as Deps['select'];
  const r = await loadRules(deps(select, cached));
  expect(cached).toHaveBeenCalledWith(['rules', 'v3'], 3600, expect.any(Function));
  expect((select as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort())
    .toEqual(['compensation_scale', 'reference_prices', 'regularity_rule']);
  expect(r.regularity_rule).toHaveLength(3);
  expect(r.compensation_scale[0]).toMatchObject({ brand: 'INOUI', from_s: 1800 });
});

test('loadRules : une lecture en erreur fait échouer le tout', async () => {
  const cached = (async <T>(_k: string[], _s: number, fn: () => Promise<T>) => fn()) as Deps['cached'];
  const select = (async (table: string) => (table === 'regularity_rule' ? { data: null, error: { message: 'x' } } : okSelect(table))) as Deps['select'];
  await expect(loadRules(deps(select, cached))).rejects.toThrow(/regularity_rule/);
});
