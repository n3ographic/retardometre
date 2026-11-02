'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAUSE_LABELS } from '../../lib/causes';
import { TERMINUS_BUCKETS } from '../../lib/dashboard-model';
import {
  HALF_WINDOW_S, MAREY_AXES, findTrain, hourTicks, inWindow, matchLines, parseMareyParams, span, trainTrace,
  type AxesFile, type Match, type MareyGares, type MareyTrain, type Trace,
} from '../../lib/marey';
import { LABEL_MAX, isForeign, layoutLabels, pickLabels, shortName } from '../../lib/marey-layout';
import { buildAxis, type Branch, type BuiltLine } from '../../lib/marey-lines';
import { bucketIndex, delayTone } from '../../lib/terminal-model';
import FootBar from '../terminal/foot-bar';
import StatusBar from '../terminal/status-bar';

const REFRESH_MS = 60_000;
const MARGIN = { top: 22, right: 12, bottom: 16 };
const CHAR_PX = 6.6; // largeur d'un caractère des étiquettes (monospace 11 px)
const COL_PX = Math.ceil(LABEL_MAX * CHAR_PX) + 10;
const LABEL_GAP_PX = 14;
const NUM_CHAR_PX = 6.1; // numéros de train (monospace 10 px)
const HIT_PX = 8;
const HHMM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const hhmm = (s: number) => HHMM.format(new Date(s * 1000));
const keyOf = (t: Pick<MareyTrain, 'service_date' | 'train_number'>) => `${t.service_date}:${t.train_number}`;
const AXE_LABEL: Record<string, string> = { ATLANTIQUE: 'ATLANTIQUE', EST: 'EST', NORD: 'NORD', SUD_EST: 'SUD-EST', INTERSECTEURS: 'INTERSECTEURS' };

type Item = { train: MareyTrain; key: string; matches: Match[] };
type Shown = Item & { trace: Trace };
type Payload = { generated_at: string; axe: string; gares: MareyGares; trains: MareyTrain[] };
// Index tous axes : [axe, numéro, origine, destination, retard au terminus (s) ou null].
type IndexRow = [string, string, string | null, string | null, number | null];

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

// Met l'URL à jour sans recharger la page.
function writeUrl(axe: string, train: string | null) {
  const u = new URL(window.location.href);
  u.searchParams.set('axe', axe);
  if (train) u.searchParams.set('train', train); else u.searchParams.delete('train');
  window.history.replaceState(null, '', u);
}

export default function MareyView() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState<IndexRow[] | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [wanted, setWanted] = useState<{ axe: string; train: string | null; axeGiven: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [box, size] = useSize<HTMLDivElement>();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setWanted({ ...parseMareyParams(q), axeGiven: q.has('axe') });
  }, []);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Index léger de tous les axes : compteurs des onglets, ?train= sans axe, recherche. Absent : la vue marche sans.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/marey/index');
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { trains: IndexRow[] };
        if (alive) setIndex(d.trains);
      } catch { /* compteurs et recherche indisponibles */ }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // ?train= sans axe : l'axe vient de l'index.
  useEffect(() => {
    if (!wanted || wanted.axeGiven || !wanted.train || !index) return;
    const row = index.find((r) => r[1] === wanted.train);
    setWanted({ ...wanted, axeGiven: true, axe: row?.[0] ?? wanted.axe });
  }, [wanted, index]);
  const axe = wanted && (wanted.axeGiven || !wanted.train) ? wanted.axe : null;
  useEffect(() => {
    if (!axe) return;
    let alive = true;
    setData(null);
    const load = async () => {
      try {
        const r = await fetch(`/api/marey?axe=${axe}`);
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
  }, [axe]);

  // Lignes et branches : construites une fois par réponse (toutes les 60 s au plus), jamais à chaque rendu.
  // Seulement les trains de la fenêtre ±3 h (au moment de la réponse) : le seuil « moins de 3 trains » et les compteurs en dépendent.
  const built = useMemo(() => {
    if (!data || data.axe !== axe) return null;
    const at = Math.floor(Date.now() / 1000);
    return buildAxis(data.trains.filter((t) => inWindow(t, at)), data.gares, data.axe);
  }, [data, axe]);
  useEffect(() => { for (const w of built?.warnings ?? []) console.warn(w); }, [built]);
  const axesFile = useMemo<AxesFile | null>(() => (built ? { branches: built.branches.map((b) => ({ ...b, lignes: [...b.lignes, ...b.autres] })) } : null), [built]);
  const items = useMemo<Item[]>(() => {
    if (!axesFile || !data) return [];
    return data.trains.map((train) => ({ train, key: keyOf(train), matches: matchLines(train, axesFile) })).filter((i) => i.matches.length > 0);
  }, [axesFile, data]);

  const nowS = nowMs === null ? null : Math.floor(nowMs / 1000);
  const highlighted = useMemo(() => {
    if (!wanted?.train || nowS === null) return null;
    const t = findTrain(items.map((i) => i.train), wanted.train, nowS);
    return t ? keyOf(t) : null;
  }, [items, wanted, nowS]);
  const hlMatches = items.find((i) => i.key === highlighted)?.matches ?? [];
  const minuteS = nowS === null ? null : Math.floor(nowS / 60) * 60;
  const visible = useMemo(() => (minuteS === null ? [] : items.filter((i) => inWindow(i.train, minuteS))), [items, minuteS]);

  const branches: Branch[] = built?.branches ?? [];
  const branch = branches.find((b) => b.id === tab) ?? branches.find((b) => hlMatches.some((m) => m.branch === b.id)) ?? branches[0] ?? null;
  const allLines: BuiltLine[] = branch ? [...branch.lignes, ...branch.autres] : [];
  const line = allLines.find((l) => l.id === lineId)
    ?? allLines.find((l) => hlMatches.some((m) => m.branch === branch!.id && m.line === l.id))
    ?? branch?.lignes[0] ?? branch?.autres[0] ?? null;

  const from = nowS === null ? 0 : nowS - HALF_WINDOW_S, to = nowS === null ? 0 : nowS + HALF_WINDOW_S;
  // Tracés recalculés à la minute et au changement de ligne ; seule la ligne MAINTENANT suit la seconde.
  const shown = useMemo<Shown[]>(() => (!line || !branch || minuteS === null ? [] : visible
    .filter((i) => i.matches.some((m) => m.branch === branch.id && m.line === line.id))
    .map((i) => ({ ...i, trace: trainTrace(i.train, line, minuteS - HALF_WINDOW_S - 60, minuteS + HALF_WINDOW_S + 60, minuteS) }))
    .filter((i) => { const sp = span(i.trace); return sp !== null && sp[1] >= minuteS - HALF_WINDOW_S && sp[0] <= minuteS + HALF_WINDOW_S; })), [visible, branch, line, minuteS]);

  const W = Math.max(size.w, 320), H = Math.max(size.h, 260);
  const maxKm = line ? Math.max(...line.gares.map((g) => g.km), 1) : 1;
  const y = useCallback((km: number) => MARGIN.top + (km / maxKm) * (H - MARGIN.top - MARGIN.bottom), [maxKm, H]);
  // Étiquettes de gares : deux colonnes si la largeur le permet (la seconde décalée à gauche, avec un trait de rappel).
  const cols = useMemo(() => (line ? layoutLabels(line.gares.map((g) => y(g.km)), LABEL_GAP_PX, W >= 640) : []), [line, y, W]);
  const left = (cols.includes(1) ? 2 * COL_PX : COL_PX) + 8;
  const x = useCallback((t: number) => left + ((t - from) / (to - from)) * (W - left - MARGIN.right), [from, to, W, left]);

  const selectTrain = (axeId: string, number: string) => {
    setTab(null); setLineId(null); setHover(null);
    setWanted({ axe: axeId, train: number, axeGiven: true });
    writeUrl(axeId, number);
  };
  const selectAxe = (axeId: string) => {
    setTab(null); setLineId(null); setHover(null);
    setWanted((w) => ({ axe: axeId, train: null, axeGiven: true, ...(w ? {} : {}) }));
    writeUrl(axeId, null);
  };
  // Clavier : 1 à 5 change d'axe, ← → change de branche (sauf pendant une saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MAREY_AXES.length) { e.preventDefault(); selectAxe(MAREY_AXES[n - 1]); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && branches.length > 1 && branch) {
        e.preventDefault();
        const i = branches.indexOf(branch), j = (i + (e.key === 'ArrowRight' ? 1 : branches.length - 1)) % branches.length;
        setTab(branches[j].id); setLineId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
  // Clic sur un train : il devient le train surligné, l'onglet et la ligne restent ceux à l'écran, l'URL suit.
  const onClick = () => {
    const it = shown.find((i) => i.key === hover);
    if (!it || !branch || !line || !axe) return;
    setTab(branch.id); setLineId(line.id);
    setWanted({ axe, train: it.train.train_number, axeGiven: true });
    writeUrl(axe, it.train.train_number);
  };

  // Numéros en bout de ligne (dernier point visible) : boîtes englobantes, le surligné puis les plus en retard d'abord.
  const numbers = pickLabels(shown.flatMap((i) => {
    const pts = i.trace.actual.filter((p) => p.t >= from && p.t <= to);
    const p = pts[pts.length - 1];
    if (!p || i.train.cancelled) return [];
    const w = i.train.train_number.length * NUM_CHAR_PX, h = 10;
    const bx = Math.min(x(p.t) + 4, W - MARGIN.right - w), by = Math.min(Math.max(y(p.km) - 7, MARGIN.top), H - h - 2);
    return [{ key: i.key, x: bx, y: by, w, h, priority: i.key === highlighted ? 1e9 : (i.train.delay_s ?? 0) }];
  }));
  // Bandes HORS FRANCE : suites de gares étrangères, jusqu'à mi-chemin des gares françaises voisines (ou au bord).
  const foreign = (() => {
    if (!line) return [];
    const g = line.gares, out: { y0: number; y1: number }[] = [];
    let i = 0;
    while (i < g.length) {
      if (!isForeign(g[i].stop_ids)) { i++; continue; }
      let j = i;
      while (j + 1 < g.length && isForeign(g[j + 1].stop_ids)) j++;
      const y0 = i === 0 ? MARGIN.top : (y(g[i - 1].km) + y(g[i].km)) / 2;
      const y1 = j === g.length - 1 ? H - MARGIN.bottom : (y(g[j].km) + y(g[j + 1].km)) / 2;
      out.push({ y0, y1 });
      i = j + 1;
    }
    return out;
  })();
  const halfTicks = nowS === null ? [] : hourTicks(from - 1800, to).map((t) => t + 1800).filter((t) => t >= from && t <= to);
  const ticks = nowS === null ? [] : hourTicks(from, to);
  const hourStep = (W - left - MARGIN.right) / ((to - from) / 3600) < 44 ? 2 : 1;
  const focused = items.find((i) => i.key === (hover ?? highlighted)) ?? null;
  const status = data ? { status: 'ok' as const, ageMin: Math.round((Date.now() - Date.parse(data.generated_at)) / 60000) } : { status: 'unknown' as const, ageMin: null };
  const axisCount = (a: string) => (index ? index.filter((r) => r[0] === a).length : null);
  const options = useMemo(() => (index ?? []).map((r) => `${r[1]} · ${shortName(r[2] ?? '?', 40)} → ${shortName(r[3] ?? '?', 40)}`), [index]);
  const onSearch = (v: string) => {
    setQuery(v);
    const num = v.match(/^\s*(\d{1,5})\b/)?.[1];
    const row = num && index?.find((r) => r[1] === num);
    if (row && (v.includes('·') || v.trim() === num)) { selectTrain(row[0], num); setQuery(''); }
  };

  return (
    <div className="term">
      <StatusBar status={status} />
      <main className="marey">
        <h1 className="sr-only">Diagramme de Marey : horaires théoriques et retards reconstitués des TGV, par axe</h1>
        <div className="marey-main">
          <div className="marey-head">
            <div role="tablist" aria-label="Axes" className="marey-tabs marey-axes">
              {MAREY_AXES.map((a, i) => (
                <button key={a} role="tab" aria-selected={a === axe} className={a === axe ? 'on' : ''} onClick={() => selectAxe(a)} title={`Touche ${i + 1}`}>
                  {AXE_LABEL[a]} {axisCount(a) !== null && <span className="term-dim">{axisCount(a)}</span>}
                </button>
              ))}
            </div>
            <form className="marey-search" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(query.trim()); }}>
              <input id="marey-search" list="marey-trains" value={query} onChange={(e) => onSearch(e.target.value)} placeholder="N° DE TRAIN OU GARE" aria-label="Chercher un train" autoComplete="off" />
              <datalist id="marey-trains">{options.map((o) => <option key={o} value={o} />)}</datalist>
            </form>
          </div>
          <div className="marey-head">
            <div role="tablist" aria-label="Branches" className="marey-tabs">
              {branches.map((b) => (
                <button key={b.id} role="tab" aria-selected={b.id === branch?.id} className={b.id === branch?.id ? 'on' : ''} onClick={() => { setTab(b.id); setLineId(null); }}>
                  {b.label} <span className="term-dim">{[...b.lignes, ...b.autres].reduce((n, l) => n + l.trains, 0)}</span>
                </button>
              ))}
            </div>
            <span className="marey-legend" aria-label="Légende des retards">
              {TERMINUS_BUCKETS.map((b, i) => <span key={b}><span className={`seg-c s${i}`} aria-hidden="true">█</span> {b} </span>)}MIN
            </span>
          </div>
          {branch && (
            <div className="marey-head">
              <div role="tablist" aria-label="Destinations" className="marey-tabs marey-lines">
                {[...branch.lignes, ...branch.autres].map((l) => {
                  const minor = branch.autres.includes(l);
                  return (
                    <button key={l.id} role="tab" aria-selected={l.id === line?.id} className={[l.id === line?.id ? 'on' : '', minor ? 'minor' : ''].join(' ').trim()}
                      onClick={() => setLineId(l.id)} title={minor ? 'Moins de 3 trains dans la fenêtre' : undefined}>
                      → {shortName(l.label, 30)} <span className="term-dim">{l.trains}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="marey-chart" ref={box}>
            {failed && !data && <p className="mt-warn" role="status">DONNÉES INDISPONIBLES · RÉESSAI AUTOMATIQUE</p>}
            {failed && data && <p className="marey-stale" role="status">MISE À JOUR ÉCHOUÉE · DERNIÈRES DONNÉES AFFICHÉES</p>}
            {!data && !failed && <p className="term-dim marey-empty">CHARGEMENT…</p>}
            {line && nowS !== null && (
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trains vers ${line.label} : distance selon l'heure`}
                onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
                <defs><clipPath id="marey-plot"><rect x={left} y={MARGIN.top} width={W - left - MARGIN.right} height={H - MARGIN.top - MARGIN.bottom} /></clipPath></defs>
                {foreign.map((f, k) => (
                  <g key={`f${k}`}>
                    <rect x={left} y={f.y0} width={W - left - MARGIN.right} height={Math.max(0, f.y1 - f.y0)} className="m-foreign" />
                    <text x={W - MARGIN.right - 4} y={f.y0 + 11} textAnchor="end" className="m-foreign-lab">HORS FRANCE</text>
                  </g>
                ))}
                <rect x={x(nowS)} y={MARGIN.top} width={Math.max(0, W - MARGIN.right - x(nowS))} height={H - MARGIN.top - MARGIN.bottom} className="m-future" />
                {halfTicks.map((t) => <line key={`h${t}`} x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-grid-half" />)}
                {ticks.map((t) => (
                  <g key={t}>
                    <line x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-grid" />
                    {(t / 3600) % hourStep === 0 && <text x={x(t)} y={MARGIN.top - 8} textAnchor="middle" className="m-lab">{hhmm(t)}</text>}
                  </g>
                ))}
                {line.gares.map((g, i) => {
                  const gy = y(g.km), col = cols[i];
                  const lx = col === 1 ? left - COL_PX - 8 : left - 6;
                  return (
                    <g key={g.nom}>
                      <line x1={left} x2={W - MARGIN.right} y1={gy} y2={gy} className="m-grid" />
                      {col === 1 && <line x1={lx + 3} x2={left - 2} y1={gy} y2={gy} className="m-leader" />}
                      {col !== null && <text x={lx} y={gy + 4} textAnchor="end" className={isForeign(g.stop_ids) ? 'm-lab m-lab-foreign' : 'm-lab'}><title>{g.nom}</title>{shortName(g.nom)}</text>}
                    </g>
                  );
                })}
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
                {numbers.map((n) => {
                  const hl = n.key === highlighted;
                  return <text key={n.key} x={n.x} y={n.y + 8} className={hl ? 'm-num m-hl' : 'm-num'} opacity={hl || n.key === hover || !highlighted ? 1 : 0.35}>{n.key.split(':')[1]}</text>;
                })}
                <line x1={x(nowS)} x2={x(nowS)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-now" />
                <text x={x(nowS) + 4} y={H - MARGIN.bottom - 4} className="m-now-lab">MAINTENANT</text>
              </svg>
            )}
            {line && shown.length === 0 && data && !failed && <p className="term-dim marey-empty">AUCUN TRAIN DANS LA FENÊTRE SUR CETTE LIGNE</p>}
          </div>
          <p className="marey-note term-dim">POINTILLÉ = HORAIRE THÉORIQUE · PLEIN = RETARD PUBLIÉ RECONSTITUÉ À CHAQUE COLLECTE (≈ TOUTES LES 2 MIN) · APPROXIMATIF · ESTOMPÉ = PROLONGATION APRÈS MAINTENANT · TOUCHES 1-5 : AXE, ← → : BRANCHE</p>
        </div>
        <aside className="term-panel marey-side" aria-live="polite">
          <h2 className="term-panel-title">TRAIN</h2>
          {wanted?.train && data && !highlighted && <p className="bad" role="status">TRAIN {wanted.train} INTROUVABLE DANS LA FENÊTRE</p>}
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
  const cat = t.cause_cat ? CAUSE_LABELS[t.cause_cat]?.short : undefined;
  return (
    <dl className="marey-info">
      <div><dt>N°</dt><dd>{t.train_number} · {t.brand}</dd></div>
      <div><dt>TRAJET</dt><dd>{[t.origin, t.dest].filter(Boolean).map((n) => shortName(n!, 40)).join(' → ') || '—'}</dd></div>
      <div><dt>ÉTAT</dt><dd>{state}</dd></div>
      <div><dt>RETARD</dt><dd className={`tone-${tone}`}>{t.cancelled ? 'SUPPRIMÉ' : t.delay_s === undefined ? 'INCONNU' : `${delay >= 60 ? '+' : ''}${Math.round(delay / 60)} MIN`}</dd></div>
      <div><dt>CAUSE</dt><dd>{cat ?? (t.cause ? '' : 'NON DÉCLARÉE')}{t.cause && <span className="marey-cause-text">{t.cause}</span>}</dd></div>
      <div><dt>INDEMNITÉ</dt><dd>{t.comp_pct > 0 ? `≈ ${t.comp_eur_per_passenger_ref.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT PAR VOYAGEUR (${t.comp_pct} %)` : 'AUCUNE À CE RETARD'}</dd></div>
    </dl>
  );
}
