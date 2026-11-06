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
