'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TERMINUS_BUCKETS } from '../../lib/dashboard-model';
import {
  HALF_WINDOW_S, findTrain, hourTicks, inWindow, labelIndices, matchLines, parseMareyParams, span, trainTrace,
  type AxesFile, type Match, type MareyTrain, type Trace,
} from '../../lib/marey';
import { bucketIndex, delayTone } from '../../lib/terminal-model';
import FootBar from '../terminal/foot-bar';
import StatusBar from '../terminal/status-bar';

const REFRESH_MS = 60_000;
const MARGIN = { top: 22, right: 12, bottom: 16, left: 132 };
const HIT_PX = 8;
const HHMM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const hhmm = (s: number) => HHMM.format(new Date(s * 1000));
const stationName = (n: string) => n.replace(/ Hall .*$/, '');
const keyOf =(t: Pick<MareyTrain, 'service_date' | 'train_number'>) => `${t.service_date}:${t.train_number}`;

type Item = { train: MareyTrain; key: string; matches: Match[] };
type Shown = Item & { trace: Trace };
type Payload = { generated_at: string; axe: string; trains: MareyTrain[] };

// Distance d'un point à un segment, en pixels.
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export default function MareyView() {
  const [axes, setAxes] = useState<AxesFile | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [wanted, setWanted] = useState<{ axe: string; train: string | null }>({ axe: 'ATLANTIQUE', train: null });
  const [box, size] = useSize<HTMLDivElement>();

  useEffect(() => { setWanted(parseMareyParams(new URLSearchParams(window.location.search))); }, []);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/marey-axes.json');
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as AxesFile;
        if (alive) setAxes(d);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/marey?axe=${wanted.axe}`);
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Payload;
        if (!alive) return;
        setData(d);
        setFailed(false);
      } catch { if (alive) setFailed(true); } // on garde les derniers trains
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [wanted.axe]);

  const items = useMemo<Item[]>(() => {
    if (!axes || !data) return [];
    return data.trains.map((train) => ({ train, key: keyOf(train), matches: matchLines(train, axes) })).filter((i) => i.matches.length > 0);
  }, [axes, data]);

  const nowS = nowMs === null ? null : Math.floor(nowMs / 1000);
  const highlighted = useMemo(() => {
    if (!wanted.train || nowS === null) return null;
    const t = findTrain(items.map((i) => i.train), wanted.train, nowS);
    return t ? keyOf(t) : null;
  }, [items, wanted.train, nowS]);
  const hlMatches = items.find((i) => i.key === highlighted)?.matches ?? [];
  const visible = useMemo(() => (nowS === null ? [] : items.filter((i) => inWindow(i.train, nowS))), [items, nowS]);
  const countIn = (pred: (m: Match) => boolean) => visible.filter((i) => i.matches.some(pred)).length;

  // Branche : choix de l'utilisateur, sinon celle du train désigné, sinon la première qui a des trains.
  const active = tab ?? hlMatches[0]?.branch ?? axes?.branches.find((b) => countIn((m) => m.branch === b.id) > 0)?.id ?? axes?.branches[0]?.id ?? null;
  const branch = axes?.branches.find((b) => b.id === active) ?? null;
  // Ligne (terminus) : choix de l'utilisateur dans cette branche, sinon celle du train désigné, sinon la plus chargée.
  const line = branch?.lignes.find((l) => l.id === lineId)
    ?? branch?.lignes.find((l) => hlMatches.some((m) => m.branch === branch.id && m.line === l.id))
    ?? [...(branch?.lignes ?? [])].sort((a, b) => countIn((m) => m.line === b.id) - countIn((m) => m.line === a.id))[0]
    ?? null;
  const from = nowS === null ? 0 : nowS - HALF_WINDOW_S, to = nowS === null ? 0 : nowS + HALF_WINDOW_S;
  // Les tracés sont recalculés à la minute (pas à chaque seconde d'horloge) ; seule la ligne MAINTENANT suit la seconde.
  const minuteS = nowS === null ? null : Math.floor(nowS / 60) * 60;
  const shown = useMemo<Shown[]>(() => (!line || !branch || minuteS === null ? [] : visible
    .filter((i) => i.matches.some((m) => m.branch === branch.id && m.line === line.id))
    .map((i) => ({ ...i, trace: trainTrace(i.train, line, minuteS - HALF_WINDOW_S - 60, minuteS + HALF_WINDOW_S + 60, minuteS) }))
    .filter((i) => { const sp = span(i.trace); return sp !== null && sp[1] >= minuteS - HALF_WINDOW_S && sp[0] <= minuteS + HALF_WINDOW_S; })), [visible, branch, line, minuteS]);

  const W = Math.max(size.w, 320), H = Math.max(size.h, 260);
  const maxKm = line ? Math.max(...line.gares.map((g) => g.km), 1) : 1;
  const x = useCallback((t: number) => MARGIN.left + ((t - from) / (to - from)) * (W - MARGIN.left - MARGIN.right), [from, to, W]);
  const y = useCallback((km: number) => MARGIN.top + (km / maxKm) * (H - MARGIN.top - MARGIN.bottom), [maxKm, H]);

  const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    let best: { key: string; d: number } | null = null;
    for (const i of shown) {
      const pts = i.trace.actual;
      for (let k = 1; k < pts.length; k++) {
        const d = distToSeg(px, py, x(pts[k - 1].t), y(pts[k - 1].km), x(pts[k].t), y(pts[k].km));
        if (d <= HIT_PX && (!best || d < best.d)) best = { key: i.key, d };
      }
    }
    setHover(best?.key ?? null);
  };

  const focusKey = hover ?? highlighted;
  // Clic sur un train : il devient le train surligné, l'onglet et la ligne restent ceux à l'écran, l'URL suit.
  const onClick = () => {
    const it = shown.find((i) => i.key === hover);
    if (!it || !branch || !line) return;
    setTab(branch.id);
    setLineId(line.id);
    setWanted((w) => ({ ...w, train: it.train.train_number }));
    const u = new URL(window.location.href);
    u.searchParams.set('axe', wanted.axe);
    u.searchParams.set('train', it.train.train_number);
    window.history.replaceState(null, '', u);
  };
  // Numéro en bout de ligne (dernier point visible), masqué s'il chevauche un autre ; le train surligné passe en premier.
  const numbers = (() => {
    const boxes: { x: number; y: number; w: number }[] = [];
    const out: { key: string; x: number; y: number; text: string; hl: boolean }[] = [];
    const order = [...shown].sort((a, b) => Number(b.key === highlighted) - Number(a.key === highlighted) || Number(b.key === hover) - Number(a.key === hover));
    for (const i of order) {
      const pts = i.trace.actual.filter((p) => p.t >= from && p.t <= to);
      const p = pts[pts.length - 1];
      if (!p || i.train.cancelled) continue;
      const text = i.train.train_number, w = text.length * 6.2 + 2, hl = i.key === highlighted;
      let bx = x(p.t) + 4, by = y(p.km) + 3;
      // Le train surligné garde toujours son numéro, recalé dans le cadre ; les autres sont masqués s'ils débordent.
      if (hl) { bx = Math.min(bx, W - MARGIN.right - w); by = Math.min(Math.max(by, MARGIN.top + 10), H - 4); }
      else if (bx + w > W - MARGIN.right || by < MARGIN.top + 10 || by > H - MARGIN.bottom) continue;
      if (!hl && boxes.some((b) => bx < b.x + b.w && b.x < bx + w && Math.abs(b.y - by) < 11)) continue;
      boxes.push({ x: bx, y: by, w });
      out.push({ key: i.key, x: bx, y: by, text, hl });
    }
    return out;
  })();
  const halfTicks = nowS === null ? [] : hourTicks(from - 1800, to).map((t) => t + 1800).filter((t) => t >= from && t <= to);
  const focused = items.find((i) => i.key === focusKey) ?? null;
  const gareYs = line ? line.gares.map((g) => y(g.km)) : [];
  const labelled = new Set(labelIndices(gareYs, 13));
  const ticks = nowS === null ? [] : hourTicks(from, to);
  // Une étiquette « 13:00 » fait ~36 px : sous 44 px par heure, une heure sur deux.
  const hourStep = (W - MARGIN.left - MARGIN.right) / ((to - from) / 3600) < 44 ? 2 : 1;
  const status = data ? { status: 'ok' as const, ageMin: Math.round((Date.now() - Date.parse(data.generated_at)) / 60000) } : { status: 'unknown' as const, ageMin: null };

  return (
    <div className="term">
      <StatusBar status={status} />
      <main className="marey">
        <h1 className="sr-only">Diagramme de Marey de l'axe Atlantique : horaires théoriques et estimés des trains</h1>
        <div className="marey-main">
          <div className="marey-head">
            <span className="term-panel-title">MAREY · {wanted.axe}</span>
            <div role="tablist" aria-label="Branches de l'axe" className="marey-tabs">
              {axes?.branches.map((b) => (
                <button key={b.id} role="tab" aria-selected={b.id === active} className={b.id === active ? 'on' : ''} onClick={() => { setTab(b.id); setLineId(null); }}>
                  {b.label.toUpperCase()} <span className="term-dim">{countIn((m) => m.branch === b.id)}</span>
                </button>
              ))}
            </div>
            {branch && (
              <div role="tablist" aria-label="Terminus" className="marey-tabs marey-lines">
                {branch.lignes.map((l) => (
                  <button key={l.id} role="tab" aria-selected={l.id === line?.id} className={l.id === line?.id ? 'on' : ''} onClick={() => { setLineId(l.id); }}>
                    → {stationName(l.label).toUpperCase()} <span className="term-dim">{countIn((m) => m.branch === branch.id && m.line === l.id)}</span>
                  </button>
                ))}
              </div>
            )}
            <span className="marey-legend" aria-label="Légende des retards">
              {TERMINUS_BUCKETS.map((b, i) => <span key={b}><span className={`seg-c s${i}`} aria-hidden="true">█</span> {b} </span>)}MIN
            </span>
          </div>
          <div className="marey-chart" ref={box}>
            {failed && !data && <p className="mt-warn" role="status">DONNÉES INDISPONIBLES · RÉESSAI AUTOMATIQUE</p>}
            {failed && data && <p className="marey-stale" role="status">MISE À JOUR ÉCHOUÉE · DERNIÈRES DONNÉES AFFICHÉES</p>}
            {line && nowS !== null && (
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trains de la ligne Paris → ${stationName(line.label)} : distance depuis Paris selon l'heure`}
                onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
                <defs><clipPath id="marey-plot"><rect x={MARGIN.left} y={MARGIN.top} width={W - MARGIN.left - MARGIN.right} height={H - MARGIN.top - MARGIN.bottom} /></clipPath></defs>
                <rect x={x(nowS)} y={MARGIN.top} width={Math.max(0, W - MARGIN.right - x(nowS))} height={H - MARGIN.top - MARGIN.bottom} className="m-future" />
                {halfTicks.map((t) => <line key={`h${t}`} x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-grid-half" />)}
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-grid" />
                    {(t / 3600) % hourStep === 0 && <text x={x(t)} y={MARGIN.top - 8} textAnchor="middle" className="m-lab">{hhmm(t)}</text>}
                  </g>
                ))}
                {line.gares.map((g, i) => (
                  <g key={g.nom}>
                    <line x1={MARGIN.left} x2={W - MARGIN.right} y1={y(g.km)} y2={y(g.km)} className="m-grid" />
                    {labelled.has(i) && <text x={MARGIN.left - 6} y={y(g.km) + 4} textAnchor="end" className="m-lab">{stationName(g.nom).slice(0, 17).toUpperCase()}</text>}
                  </g>
                ))}
                <g clipPath="url(#marey-plot)">
                  {shown.map((i) => {
                    const hl = i.key === highlighted, hov = i.key === hover;
                    const op = hl || hov ? 1 : highlighted ? 0.25 : 1;
                    const d = i.trace.planned.map((p, k) => `${k ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.km).toFixed(1)}`).join('');
                    return (
                      <g key={i.key} opacity={op}>
                        <path d={d} className="m-plan" strokeWidth={hl || hov ? 1.25 : 1} />
                        {!i.train.cancelled && i.trace.runs.map((r, k) => (
                          <path key={k} d={r.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.km).toFixed(1)}`).join('')} className="m-run"
                            stroke={`var(--seg${bucketIndex(r.delay)})`} strokeWidth={hl ? 2.5 : hov ? 2 : 1.25} opacity={r.future ? 0.5 : 1} />
                        ))}
                      </g>
                    );
                  })}
                </g>
                {numbers.map((n) => (
                  <text key={n.key} x={n.x} y={n.y} className={n.hl ? 'm-num m-hl' : 'm-num'} opacity={n.hl || n.key === hover || !highlighted ? 1 : 0.35}>{n.text}</text>
                ))}
                <line x1={x(nowS)} x2={x(nowS)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-now" />
                <text x={x(nowS) + 4} y={H - MARGIN.bottom - 4} className="m-now-lab">MAINTENANT</text>
              </svg>
            )}
            {line && shown.length === 0 && data && !failed && <p className="term-dim marey-empty">AUCUN TRAIN DANS LA FENÊTRE SUR CETTE LIGNE</p>}
          </div>
          <p className="marey-note term-dim">POINTILLÉ = HORAIRE THÉORIQUE · PLEIN = RETARD PUBLIÉ RECONSTITUÉ À CHAQUE COLLECTE (≈ TOUTES LES 2 MIN) · APPROXIMATIF · ESTOMPÉ = PROLONGATION APRÈS MAINTENANT</p>
        </div>
        <aside className="term-panel marey-side" aria-live="polite">
          <h2 className="term-panel-title">TRAIN</h2>
          {wanted.train && data && !highlighted && <p className="bad" role="status">TRAIN {wanted.train} INTROUVABLE DANS LA FENÊTRE</p>}
          {focused ? <TrainInfo item={focused} nowS={nowS ?? 0} /> : <p className="term-dim">SURVOLEZ UN TRAIN</p>}
        </aside>
      </main>
      <FootBar />
    </div>
  );
}

function TrainInfo({ item, nowS }: { item: Item; nowS: number }) {
  const t = item.train;
  const delay = t.delay_s ?? 0;
  const tone = delayTone(t.delay_s, t.cancelled);
  const first = t.stops[0]?.[2], last = t.stops[t.stops.length - 1]?.[1];
  const state = t.cancelled ? 'SUPPRIMÉ' : first !== undefined && nowS < first ? `PART À ${hhmm(first)}` : last !== undefined && nowS > last + Math.max(delay, 0) ? 'ARRIVÉ' : 'EN ROUTE';
  return (
    <dl className="marey-info">
      <div><dt>N°</dt><dd>{t.train_number} · {t.brand}</dd></div>
      <div><dt>TRAJET</dt><dd>{[t.origin, t.dest].filter(Boolean).map((n) => stationName(n!)).join(' → ') || '—'}</dd></div>
      <div><dt>ÉTAT</dt><dd>{state}</dd></div>
      <div><dt>RETARD</dt><dd className={`tone-${tone}`}>{t.cancelled ? 'SUPPRIMÉ' : t.delay_s === undefined ? 'INCONNU' : `${delay >= 60 ? '+' : ''}${Math.round(delay / 60)} MIN`}</dd></div>
      <div><dt>CAUSE</dt><dd>{t.cause ?? 'NON DÉCLARÉE'}</dd></div>
      <div><dt>INDEMNITÉ</dt><dd>{t.comp_pct > 0 ? `≈ ${t.comp_eur_per_passenger_ref.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT PAR VOYAGEUR (${t.comp_pct} %)` : 'AUCUNE À CE RETARD'}</dd></div>
    </dl>
  );
}
