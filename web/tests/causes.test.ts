import { expect, test } from 'vitest';
import { causeExcerpt } from '../lib/causes';

test('extrait de cause : fin de phrase, sinon mot entier ; texte court intact', () => {
  const t = 'Train retardé suite à un obstacle sur la voie. Les équipes sont intervenues. Pour mieux comprendre la gestion de cet incident, veuillez consulter le site.';
  expect(causeExcerpt(t, 120)).toEqual({ short: 'Train retardé suite à un obstacle sur la voie. Les équipes sont intervenues. …', cut: true });
  expect(causeExcerpt('Un seul long segment sans point qui dépasse la limite fixée', 30)).toEqual({ short: 'Un seul long segment sans …', cut: true });
  expect(causeExcerpt('Court.', 160)).toEqual({ short: 'Court.', cut: false });
});
