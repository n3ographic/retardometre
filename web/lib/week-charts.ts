import { bucketIndex } from './terminal-model';

// Calculs des graphiques du bilan hebdo (/semaine), sans JSX pour être testés ; le dessin est dans app/semaine/[semaine]/charts.tsx.
export const dowOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0

export type CurveDay = { date: string; pct: number | null; small: boolean };
export type CurvePoint = { x: number; y: number; hollow: boolean };

// Coordonnées de la courbe : 7 emplacements du lundi au dimanche, placés par jour de la semaine (une semaine qui commence
// un mardi laisse un trou le lundi) ; axe vertical arrondi à 5 points ; `runs` = suites de jours mesurés à relier.
export function curvePoints(days: CurveDay[], { width, height, pad }: { width: number; height: number; pad: number }) {
  const vals = days.map((d) => d.pct).filter((p): p is number => p !== null);
  let yMin = 0, yMax = 100;
  if (vals.length) {
    yMin = Math.floor(Math.min(...vals) / 5) * 5;
    yMax = Math.min(100, Math.ceil(Math.max(...vals) / 5) * 5);
    if (yMin === yMax) yMin -= 5;
  }
  const yOf = (pct: number) => pad + ((yMax - pct) / (yMax - yMin)) * (height - 2 * pad);
  const xOf = (dow: number) => pad + (dow * (width - 2 * pad)) / 6;
  const points: (CurvePoint | null)[] = Array.from({ length: 7 }, () => null);
  for (const d of days) if (d.pct !== null) points[dowOf(d.date)] = { x: xOf(dowOf(d.date)), y: yOf(d.pct), hollow: d.small };
  const runs: number[][] = [];
  points.forEach((p, i) => {
    if (!p) return;
    if (i > 0 && points[i - 1]) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  return { points, runs, yMin, yMax, yOf, xOf };
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
