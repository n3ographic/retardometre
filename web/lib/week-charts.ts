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

// Trains en retard jour par jour (100 moins la régularité officielle) : échelle de 0 au pire jour arrondi à 5 points,
// pire jour parmi ceux d'au moins 30 trains (le plus tôt en cas d'égalité).
export function lateBars(days: { date: string; pct: number | null; small: boolean }[]) {
  const slots = weekSlots(days).map((d) => (d && d.pct !== null ? { date: d.date, small: d.small, late: Math.round((100 - d.pct) * 10) / 10 } : null));
  const measured = slots.filter((s): s is NonNullable<typeof s> => s !== null);
  const top = Math.max(5, Math.ceil(Math.max(0, ...measured.map((s) => s.late)) / 5) * 5);
  const worst = measured.filter((s) => !s.small).sort((a, b) => b.late - a.late || a.date.localeCompare(b.date))[0]?.date ?? null;
  return { top, worst, slots: slots.map((s) => s && { ...s, height: (s.late / top) * 100 }) };
}

// Phrase titre : « 1 TRAIN SUR 3 EN RETARD » ; en pourcentage à partir de la moitié, où « 1 sur 2 » ne dit plus rien.
export function lateHeadline(late: number): string {
  if (late <= 0) return 'AUCUN TRAIN EN RETARD';
  if (late >= 50) return `${late.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % DES TRAINS EN RETARD`;
  return `1 TRAIN SUR ${Math.round(100 / late)} EN RETARD`;
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
