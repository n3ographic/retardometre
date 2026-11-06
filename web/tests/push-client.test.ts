import { expect, test } from 'vitest';
import { prune, type Followed } from '../lib/push-client';

const f = (date: string): Followed => ({ number: '8308', date, seq: 4, stops: [] });

test('trains suivis retenus : jour de service d’aujourd’hui ou d’hier à Paris', () => {
  // 7 nov. 00:30 à Paris (6 nov. 23:30 UTC) : le 6 est « hier », le 5 est oublié.
  const now = new Date('2026-11-06T23:30:00Z');
  expect(prune([f('2026-11-05'), f('2026-11-06'), f('2026-11-07')], now).map((x) => x.date)).toEqual(['2026-11-06', '2026-11-07']);
});
