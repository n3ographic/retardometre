import { bucketIndex } from './terminal-model';

// Calculs des graphiques du bilan hebdo (/semaine), sans JSX pour être testés ; le dessin est dans app/semaine/[semaine]/charts.tsx.
export const dowOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0

// Colonnes du lundi au dimanche, chaque jour à la place de son jour de la semaine : une semaine qui commence un mardi
// (S43, début de la collecte) laisse le lundi vide.
export function weekSlots<T extends { date: string }>(days: T[]): (T | null)[] {
  const slots: (T | null)[] = Array.from({ length: 7 }, () => null);
  for (const d of days) slots[dowOf(d.date)] = d;
  return slots;
}

export type TrainDay = { date: string; label: string; state: 'ran' | 'cancelled' | 'unobserved'; delay_s: number | null };
// Case d'un jour du train de la semaine : jour, date et retard écrits ; à l'heure (✓) sous 5′, comme /train.
export function dayCell(d: TrainDay): { top: string; date: string; text: string; cls: string; ok: boolean } {
  const [top, date] = d.label.split(' ');
  if (d.state === 'cancelled') return { top, date, text: '×', cls: 'tp-cancel', ok: false };
  if (d.state === 'unobserved') return { top, date, text: '', cls: 'tp-unobs', ok: false };
  if (d.delay_s === null) return { top, date, text: '–', cls: 'tp-unobs', ok: false };
  const ok = d.delay_s < 300;
  return { top, date, text: ok ? '✓' : `+${Math.round(d.delay_s / 60)}′`, cls: `tp-s${bucketIndex(d.delay_s)}`, ok };
}
