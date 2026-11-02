import type { LiveItem } from './map-model';

// Minuscules sans accents : « Besançon » et « besancon » se valent.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Recherche parmi les trains du flux temps réel (ceux de /api/live) : numéro de train (début du numéro), marque,
// gare d'origine ou de destination (sous-chaîne). Tous les mots saisis doivent correspondre ; un mot de lettres
// compte à partir de 2 caractères. Le numéro exact passe en premier, puis ordre des numéros.
// Tout objet avec numéro, origine et destination convient (la marque est facultative : index du diagramme de Marey).
export function searchTrains<T extends Pick<LiveItem, 'train_number' | 'origin' | 'dest'> & { brand?: string }>(trains: T[], query: string, limit = 8): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.some((w) => !/^\d+$/.test(w) && w.length < 2)) return [];
  const exact = (t: T) => words.some((w) => w === t.train_number);
  return trains
    .filter((t) => {
      const brand = norm(t.brand ?? ''), stations = norm(`${t.origin ?? ''} ${t.dest ?? ''}`);
      return words.every((w) => (/^\d+$/.test(w) ? t.train_number.startsWith(w) : brand.startsWith(w) || stations.includes(w)));
    })
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || a.train_number.localeCompare(b.train_number))
    .slice(0, limit);
}
