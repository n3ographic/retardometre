import { unwrap } from './db';
import type { Deps } from './handlers';
import { toNum } from './num';
import { SCALE_COLUMNS, type Price, type Scale } from './stats';

export type RegularityRule = { duration_from_s: number; max_delay_exclusive_s: number; source_url: string };
export type Rules = {
  generated_at: string;
  compensation_scale: Scale[];
  regularity_rule: RegularityRule[];
  reference_prices: Price[];
};

type Raw = { scale: unknown[]; regularity: unknown[]; prices: unknown[] };

// Postgres renvoie les numeric en chaîne : on convertit, on trie, on refuse tout non-fini.
export function shapeRules(raw: Raw, now: Date): Rules {
  const compensation_scale = (raw.scale as Scale[])
    .map((x) => ({ ...x, from_s: toNum(x.from_s, 'from_s'), pct: toNum(x.pct, 'pct') }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || Number(a.scope === 'international') - Number(b.scope === 'international') || a.from_s - b.from_s);
  const regularity_rule = (raw.regularity as RegularityRule[])
    .map((x) => ({
      ...x,
      duration_from_s: toNum(x.duration_from_s, 'duration_from_s'),
      max_delay_exclusive_s: toNum(x.max_delay_exclusive_s, 'max_delay_exclusive_s'),
    }))
    .sort((a, b) => a.duration_from_s - b.duration_from_s);
  const reference_prices = (raw.prices as Price[])
    .map((x) => ({ ...x, price_eur_ht: toNum(x.price_eur_ht, 'price_eur_ht'), seats: toNum(x.seats, 'seats') }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
  return { generated_at: now.toISOString(), compensation_scale, regularity_rule, reference_prices };
}

// Une seule lecture de la base par heure, quel que soit le trafic (page et route partagent cette fonction).
export function loadRules(deps: Deps): Promise<Rules> {
  return deps.cached(['rules', 'v3'], 3600, async () => {
    const [scale, regularity, prices] = await Promise.all([
      unwrap<unknown[]>(deps.select('compensation_scale', SCALE_COLUMNS), 'compensation_scale'),
      unwrap<unknown[]>(deps.select('regularity_rule', 'duration_from_s,max_delay_exclusive_s,source_url'), 'regularity_rule'),
      unwrap<unknown[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
    ]);
    return shapeRules({ scale, regularity, prices }, deps.now());
  });
}
