'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CAUSE_LABELS } from '../../lib/causes';
import { TERMINUS_BUCKETS } from '../../lib/dashboard-model';
import {
  BLOCK_S, COLLECT_INTERVAL_S, DAY_SPAN_H, HALF_WINDOW_S, MAREY_AXES, PAST_TTL_S, blockOf, findTrain, hourTicks, inWindow, matchLines, parseMareyParams,
  collectHealth, serviceDay, span, trainSpan, trainTrace,
  type AxesFile, type Match, type MareyGares, type MareyTrain, type Trace,
} from '../../lib/marey';
import { LABEL_MAX, isForeign, spreadLabels, pickLabels, shortName } from '../../lib/marey-layout';
import { buildAxis, type Branch, type BuiltLine } from '../../lib/marey-lines';
import { searchTrains } from '../../lib/train-search';
import { bucketIndex, delayTone } from '../../lib/terminal-model';
import FootBar from '../terminal/foot-bar';
import StatusBar from '../terminal/status-bar';
import TrainActions from '../terminal/train-actions';

const REFRESH_MS = 60_000;
const MARGIN = { top: 22, right: 12, bottom: 16 };
const SCROLLBAR_PX = 12; // place de la barre de défilement horizontale
const CHAR_PX = 6.6; // largeur d'un caractère des étiquettes (monospace 11 px)
const COL_PX = Math.ceil(LABEL_MAX * CHAR_PX) + 10;
const LABEL_GAP_PX = 14;
const LEADER_PX = 16; // trait entre le nom (déplacé si besoin) et la hauteur réelle de la gare
const MIN_BRANCH_TRAINS = 5; // branche rangée dans le menu AUTRES sous ce nombre de trains
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
  u.searchParams.delete('gare'); // un choix d'axe ou de train remplace la gare demandée
  window.history.replaceState(null, '', u);
}

// Retour à la page d'où l'on vient (l'accueil retrouve son train sélectionné par son URL), sinon à l'accueil.
function goBack() {
  const fromSite = document.referrer !== '' && new URL(document.referrer).origin === window.location.origin;
  if (fromSite && window.history.length > 1) window.history.back(); else window.location.assign('/');
}

export default function MareyView() {
  const [blocks, setBlocks] = useState<Record<string, Payload>>({});
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState<IndexRow[] | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [wanted, setWanted] = useState<{ axe: string; train: string | null; gare: string | null; axeGiven: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [autresOpen, setAutresOpen] = useState(false);
  const [viewFrom, setViewFrom] = useState<number | null>(null); // heure du bord gauche du graphique (défilement)
  const [box, size] = useSize<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const placed = useRef<{ key: string; onTrain: boolean; user: boolean } | null>(null); // centrage déjà fait pour (axe, train)

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
  // ?gare= sans axe : premier axe dont la tranche en cours dessert la gare (réponses en cache serveur).
  // ponytail: jusqu'à 5 requêtes, une seule fois par ouverture ; une route gare → axes si ça devient fréquent.
  useEffect(() => {
    if (!wanted || wanted.axeGiven || !wanted.gare) return;
    let alive = true;
    (async () => {
      let found = wanted.axe; // axe par défaut si aucun ne dessert la gare
      for (const a of MAREY_AXES) {
        try {
          const r = await fetch(`/api/marey?axe=${a}&bloc=${blockOf(Date.now() / 1000)}`);
          if (r.ok && ((await r.json()) as Payload).gares[wanted.gare!]) { found = a; break; }
        } catch { /* axe suivant */ }
      }
      if (alive) setWanted({ ...wanted, axeGiven: true, axe: found });
    })();
    return () => { alive = false; };
  }, [wanted]);
  const axe = wanted && (wanted.axeGiven || (!wanted.train && !wanted.gare)) ? wanted.axe : null;

  const nowS = nowMs === null ? null : Math.floor(nowMs / 1000);
  const [dayStart, dayEnd] = nowS === null ? [0, 0] : serviceDay(nowS);
  const vFrom = viewFrom ?? (nowS ?? 0) - HALF_WINDOW_S;
  const vTo = vFrom + 2 * HALF_WINDOW_S;
  // Tranches de 3 h nécessaires : celles qui couvrent l'écran, plus une heure de chaque côté, dans la journée de service.
  const needed = useMemo(() => {
    if (nowS === null) return [];
    const out: number[] = [];
    for (let b = blockOf(Math.max(vFrom - 3600, dayStart - BLOCK_S)); b < Math.min(vTo + 3600, dayEnd); b += BLOCK_S) out.push(b);
    return out;
  }, [vFrom, vTo, dayStart, dayEnd, nowS]);
  const inflight = useRef(new Set<string>());
  useEffect(() => { setBlocks({}); inflight.current.clear(); }, [axe]);
  const fetchBlock = useCallback(async (a: string, b: number) => {
    const key = `${a}:${b}`;
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    try {
      const r = await fetch(`/api/marey?axe=${a}&bloc=${b}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as Payload;
      setBlocks((prev) => (d.axe === a ? { ...prev, [key]: d } : prev));
      setFailed(false);
    } catch { setFailed(true); } finally { inflight.current.delete(key); }
  }, []);
  useEffect(() => {
    if (!axe) return;
    for (const b of needed) if (!blocks[`${axe}:${b}`]) fetchBlock(axe, b);
  }, [axe, needed, blocks, fetchBlock]);
  // Rafraîchissement : seules les tranches encore vivantes (finies il y a moins d'une heure) sont relues.
  useEffect(() => {
    if (!axe) return;
    const t = setInterval(() => {
      const n = Date.now() / 1000;
      for (const key of Object.keys(blocks)) {
        const [a, b] = key.split(':');
        if (a === axe && Number(b) + BLOCK_S >= n - PAST_TTL_S) fetchBlock(a, Number(b));
      }
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [axe, blocks, fetchBlock]);
  // Trains de toutes les tranches chargées, sans doublon (un train à cheval sur deux tranches y figure deux fois).
  const data = useMemo<Payload | null>(() => {
    const list = Object.entries(blocks).filter(([k]) => k.startsWith(`${axe}:`)).map(([, v]) => v);
    if (!axe || list.length === 0) return null;
    const trains = new Map<string, MareyTrain>(), gares: MareyGares = {};
    for (const p of list) { Object.assign(gares, p.gares); for (const t of p.trains) trains.set(keyOf(t), t); }
    return { axe, gares, trains: [...trains.values()], generated_at: list.map((p) => p.generated_at).sort().at(-1)! };
  }, [blocks, axe]);

  // Lignes et branches : construites sur les trains de l'écran (fenêtre de 6 h, arrondie à la demi-heure), une fois par
  // réponse ou par demi-heure de défilement, jamais à chaque rendu. Le seuil « moins de 3 trains » en dépend.
  const winMid = Math.round((vFrom + HALF_WINDOW_S) / 1800) * 1800;
  const built = useMemo(() => (data ? buildAxis(data.trains.filter((t) => inWindow(t, winMid)), data.gares, data.axe) : null), [data, winMid]);
  useEffect(() => { for (const w of built?.warnings ?? []) console.warn(w); }, [built]);
  const axesFile = useMemo<AxesFile | null>(() => (built ? { branches: built.branches.map((b) => ({ ...b, lignes: [...b.lignes, ...b.autres] })) } : null), [built]);
  const items = useMemo<Item[]>(() => {
    if (!axesFile || !data) return [];
    return data.trains.map((train) => ({ train, key: keyOf(train), matches: matchLines(train, axesFile) })).filter((i) => i.matches.length > 0);
  }, [axesFile, data]);

  // Train désigné : cherché dans toute la journée chargée.
  const highlighted = useMemo(() => {
    if (!wanted?.train || nowS === null) return null;
    const t = findTrain(items.map((i) => i.train), wanted.train, nowS, DAY_SPAN_H * 3600);
    return t ? keyOf(t) : null;
  }, [items, wanted, nowS]);
  const hlItem = items.find((i) => i.key === highlighted) ?? null;
  const hlMatches = hlItem?.matches ?? [];

  // Branches de moins de 5 trains (surtout des corridors intersecteurs) : rangées dans un menu « AUTRES », triées par trafic.
  // Seuil distinct de celui des destinations (MIN_TRAINS = 3) : choisi par l'auteur pour alléger la rangée d'onglets.
  const allBranches: Branch[] = built?.branches ?? [];
  const branchTotal = (b: Branch) => [...b.lignes, ...b.autres].reduce((n, l) => n + l.trains, 0);
  const smallBranches = allBranches.filter((b) => branchTotal(b) < MIN_BRANCH_TRAINS).sort((a, b) => branchTotal(b) - branchTotal(a));
  const bigBranches = smallBranches.length === allBranches.length ? allBranches : allBranches.filter((b) => !smallBranches.includes(b));
  const branches: Branch[] = bigBranches === allBranches ? allBranches : [...bigBranches, ...smallBranches];
  const gare = wanted?.gare ?? null;
  const hasGare = (l: BuiltLine) => gare !== null && l.gares.some((g) => g.stop_ids.includes(gare));
  const branch = branches.find((b) => b.id === tab) ?? branches.find((b) => hlMatches.some((m) => m.branch === b.id))
    ?? branches.find((b) => [...b.lignes, ...b.autres].some(hasGare)) ?? branches[0] ?? null;
  const allLines: BuiltLine[] = branch ? [...branch.lignes, ...branch.autres] : [];
  const line = allLines.find((l) => l.id === lineId)
    ?? allLines.find((l) => hlMatches.some((m) => m.branch === branch!.id && m.line === l.id))
    ?? allLines.find(hasGare)
    ?? branch?.lignes[0] ?? branch?.autres[0] ?? null;

  // Tracés : trains de la ligne sur l'écran ± 3 h, recalculés à la minute, au changement de ligne ou par demi-heure de défilement.
  const minuteS = nowS === null ? null : Math.floor(nowS / 60) * 60;
  const shown = useMemo<Shown[]>(() => (!line || !branch || minuteS === null ? [] : items
    .filter((i) => inWindow(i.train, winMid, 2 * HALF_WINDOW_S) && i.matches.some((m) => m.branch === branch.id && m.line === line.id))
    .map((i) => ({ ...i, trace: trainTrace(i.train, line, winMid - 2 * HALF_WINDOW_S, winMid + 2 * HALF_WINDOW_S, minuteS) }))
    .filter((i) => span(i.trace) !== null)), [items, branch, line, minuteS, winMid]);

  const W = Math.max(size.w, 320), H = Math.max(size.h - SCROLLBAR_PX, 240);
  const maxKm = line ? Math.max(...line.gares.map((g) => g.km), 1) : 1;
  const y = useCallback((km: number) => MARGIN.top + (km / maxKm) * (H - MARGIN.top - MARGIN.bottom), [maxKm, H]);
  // Étiquettes de gares (colonne fixe) : une colonne, noms écartés au besoin et reliés à leur gare par un trait.
  const labelYs = useMemo(() => (line ? spreadLabels(line.gares.map((g) => y(g.km)), LABEL_GAP_PX, MARGIN.top, H - MARGIN.bottom) : []), [line, y, H]);
  const left = COL_PX + LEADER_PX + 8;
  const plotW = Math.max(W - left, 160);
  const pxPerS = plotW / (2 * HALF_WINDOW_S); // l'écran montre toujours 6 h
  const totalW = Math.ceil((dayEnd - dayStart) * pxPerS) + MARGIN.right;
  const x = useCallback((t: number) => (t - dayStart) * pxPerS, [dayStart, pxPerS]);

  // Défilement : l'heure du bord gauche suit la barre de défilement.
  const scrollTo = useCallback((t: number, smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, (t - dayStart) * pxPerS - plotW / 2), behavior: smooth ? 'smooth' : 'auto' });
  }, [dayStart, pxPerS, plotW]);
  const programmatic = useRef(false);
  const onScroll = () => {
    const el = scroller.current;
    if (el && pxPerS > 0) setViewFrom(dayStart + el.scrollLeft / pxPerS);
    if (programmatic.current) programmatic.current = false;
    else if (placed.current) placed.current.user = true; // défilement à la main : plus de recentrage automatique
  };
  // Centrage : à l'ouverture d'un axe ou d'un train (sur le train s'il est chargé, sinon sur maintenant), puis une seule fois
  // sur le train dès qu'il arrive, sauf si l'utilisateur a déjà fait défiler. Le recalcul des lignes au défilement ne recentre pas.
  useEffect(() => {
    if (!axe || nowS === null || !scroller.current || size.w === 0) return;
    const key = `${axe}:${wanted?.train ?? ''}`;
    const sp = hlItem ? trainSpan(hlItem.train) : null;
    const center = (t: number) => { programmatic.current = true; scrollTo(t); };
    const onTrain = (s: [number, number]) => center(Math.min(Math.max((s[0] + s[1]) / 2, s[0] + HALF_WINDOW_S / 2), s[1]));
    if (placed.current?.key !== key) {
      placed.current = { key, onTrain: sp !== null, user: false };
      if (sp) onTrain(sp); else center(nowS);
    } else if (!placed.current.onTrain && sp && !placed.current.user) {
      placed.current.onTrain = true;
      onTrain(sp);
    }
  });

  const selectTrain = (axeId: string, number: string) => {
    setTab(null); setLineId(null); setHover(null);
    setWanted({ axe: axeId, train: number, gare: null, axeGiven: true });
    writeUrl(axeId, number);
  };
  const selectAxe = (axeId: string) => {
    setTab(null); setLineId(null); setHover(null);
    setWanted({ axe: axeId, train: null, gare: null, axeGiven: true });
    writeUrl(axeId, null);
  };
  // Clavier : 1 à 5 change d'axe, ← → change de branche, Échap revient à la page précédente (sauf pendant une saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (e.key === 'Escape' && !autresOpen) { e.preventDefault(); goBack(); return; }
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
    placed.current = { key: `${axe}:${it.train.train_number}`, onTrain: true, user: true }; // pas de recentrage sur un clic
    setWanted({ axe, train: it.train.train_number, gare: null, axeGiven: true });
    writeUrl(axe, it.train.train_number);
  };

  // Numéros en bout de ligne (dernier point tracé) : boîtes englobantes, le surligné puis les plus en retard d'abord.
  const numbers = pickLabels(shown.flatMap((i) => {
    const p = i.trace.actual[i.trace.actual.length - 1];
    if (!p || i.train.cancelled) return [];
    const w = i.train.train_number.length * NUM_CHAR_PX, h = 10;
    const bx = Math.min(x(p.t) + 4, totalW - MARGIN.right - w), by = Math.min(Math.max(y(p.km) - 7, MARGIN.top), H - h - 2);
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
  const ticks = nowS === null ? [] : hourTicks(dayStart, dayEnd);
  const halfTicks = ticks.map((t) => t + 1800).filter((t) => t < dayEnd);
  const hourStep = pxPerS * 3600 < 44 ? 2 : 1;
  const uicByName = useMemo(() => new Map(Object.entries(data?.gares ?? {}).map(([uic, g]) => [g.nom, uic])), [data]);
  const focused = items.find((i) => i.key === (hover ?? highlighted)) ?? null;
  // Bandeau : retard de la collecte d'après la tranche la plus récente (celle qui contient maintenant).
  const health = useMemo(() => {
    const cur = nowS === null ? undefined : blocks[`${axe}:${blockOf(nowS)}`];
    return cur ? collectHealth(cur.generated_at, cur.trains) : { status: 'unknown' as const, ageMin: null };
  }, [blocks, axe, nowS]);
  const axisCount = (a: string) => (index ? index.filter((r) => r[0] === a).length : null);
  // Recherche : mêmes règles et même liste que celle de la carte, sur l'index de tous les axes.
  const entries = useMemo(() => (index ?? []).map((r) => ({ axe: r[0], train_number: r[1], origin: r[2] ?? undefined, dest: r[3] ?? undefined, delay_s: r[4] ?? undefined })), [index]);
  const results = useMemo(() => searchTrains(entries, query), [entries, query]);
  const pickResult = (r: (typeof entries)[number]) => { setQuery(''); selectTrain(r.axe, r.train_number); };
  const nowOffscreen = nowS !== null && (nowS < vFrom || nowS > vTo);
  const plotH = H - MARGIN.top - MARGIN.bottom;

  return (
    <div className="term">
      <StatusBar status={health} />
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
            <form className="carte-search marey-search" role="search" onSubmit={(e) => { e.preventDefault(); if (results[0]) pickResult(results[0]); }}>
              <input id="marey-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
                placeholder="N° DE TRAIN OU GARE" aria-label="Rechercher un train par numéro ou gare, tous axes" autoComplete="off" />
              {query.trim() !== '' && (
                <ul className="carte-results" aria-label="Résultats">
                  {results.length === 0 ? <li className="term-dim carte-none">AUCUN TRAIN CORRESPONDANT DANS LA FENÊTRE</li> : results.map((r) => (
                    <li key={`${r.axe}:${r.train_number}`}>
                      <button type="button" onClick={() => pickResult(r)}>
                        <span>{r.train_number}</span>
                        <span className="carte-res-route">{[r.origin, r.dest].filter(Boolean).map((n) => shortName(n!, 40)).join(' → ')}</span>
                        <span className="term-dim">{AXE_LABEL[r.axe] ?? r.axe}</span>
                        <span className={`tone-${delayTone(r.delay_s, false)}`}>{(r.delay_s ?? 0) >= 300 ? `+${Math.round((r.delay_s ?? 0) / 60)}′` : ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </div>
          <div className="marey-head">
            <div role="tablist" aria-label="Branches" className="marey-tabs">
              {bigBranches.map((b) => (
                <button key={b.id} role="tab" aria-selected={b.id === branch?.id} className={b.id === branch?.id ? 'on' : ''} onClick={() => { setTab(b.id); setLineId(null); }}>
                  {b.label} <span className="term-dim">{branchTotal(b)}</span>
                </button>
              ))}
            </div>
            {smallBranches.length > 0 && bigBranches !== allBranches && (
              <div className="marey-autres" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAutresOpen(false); }}
                onKeyDown={(e) => { if (e.key === 'Escape') setAutresOpen(false); }}>
                <div className="marey-tabs">
                  <button type="button" aria-haspopup="true" aria-expanded={autresOpen} className={smallBranches.includes(branch!) ? 'on' : ''} onClick={() => setAutresOpen((o) => !o)}>
                    AUTRES{smallBranches.includes(branch!) ? ` · ${branch!.label}` : ''} <span className="term-dim">{smallBranches.length}</span> ▾
                  </button>
                </div>
                {autresOpen && (
                  <ul className="carte-results" aria-label="Autres corridors, moins de 5 trains">
                    {smallBranches.map((b) => (
                      <li key={b.id}>
                        <button type="button" onClick={() => { setTab(b.id); setLineId(null); setAutresOpen(false); }}>
                          <span className="carte-res-route">{b.label}</span>
                          <span className="term-dim">{branchTotal(b)} TRAIN{branchTotal(b) > 1 ? 'S' : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
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
              <>
                {/* Nom d'une gare = lien vers son panneau sur l'accueil (départs et arrivées). */}
                <svg className="marey-labels" width={left} height={H}>
                  {line.gares.map((g, i) => {
                    const on = gare !== null && g.stop_ids.includes(gare);
                    const gy = y(g.km), ly = labelYs[i] ?? gy, lx = left - LEADER_PX - 4;
                    return (
                      <g key={g.nom}>
                        <polyline points={`${lx + 2},${ly} ${left - LEADER_PX / 2},${ly} ${left},${gy}`} className={on ? 'm-leader m-leader-on' : 'm-leader'} aria-hidden="true" />
                        <a href={`/?gare=${g.stop_ids.slice(0, 8).join(',')}`} className="m-lab-link" aria-label={`Gare ${g.nom} : départs et arrivées`}>
                          <text x={lx} y={ly + 4} textAnchor="end" className={on ? 'm-lab m-lab-on' : isForeign(g.stop_ids) ? 'm-lab m-lab-foreign' : 'm-lab'}><title>{g.nom}</title>{on ? '▸ ' : ''}{shortName(g.nom)}</text>
                        </a>
                      </g>
                    );
                  })}
                </svg>
                <div className="marey-scroll" ref={scroller} onScroll={onScroll} style={{ left }} tabIndex={0} aria-label="Défilement horaire de la journée">
                  <svg width={totalW} height={H} role="img" aria-label={`Trains vers ${line.label} : distance selon l'heure, journée de service`}
                    onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick}>
                    {foreign.map((f, k) => (
                      <g key={`f${k}`}>
                        <rect x={0} y={f.y0} width={totalW} height={Math.max(0, f.y1 - f.y0)} className="m-foreign" />
                        {ticks.filter((t) => ((t - dayStart) / 3600) % 3 === 0).map((t) => (
                          <text key={t} x={x(t) + 4} y={f.y0 + 11} className="m-foreign-lab">HORS FRANCE</text>
                        ))}
                      </g>
                    ))}
                    <rect x={x(nowS)} y={MARGIN.top} width={Math.max(0, totalW - x(nowS))} height={plotH} className="m-future" />
                    {halfTicks.map((t) => <line key={`h${t}`} x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-grid-half" />)}
                    {ticks.map((t) => (
                      <g key={t}>
                        <line x1={x(t)} x2={x(t)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-grid" />
                        {(t / 3600) % hourStep === 0 && <text x={x(t)} y={MARGIN.top - 8} textAnchor={t === dayStart ? 'start' : 'middle'} className="m-lab">{hhmm(t)}</text>}
                      </g>
                    ))}
                    {line.gares.map((g) => <line key={g.nom} x1={0} x2={totalW} y1={y(g.km)} y2={y(g.km)} className={gare !== null && g.stop_ids.includes(gare) ? 'm-grid m-grid-on' : 'm-grid'} />)}
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
                    {numbers.map((n) => {
                      const hl = n.key === highlighted;
                      return <text key={n.key} x={n.x} y={n.y + 8} className={hl ? 'm-num m-hl' : 'm-num'} opacity={hl || n.key === hover || !highlighted ? 1 : 0.35}>{n.key.split(':')[1]}</text>;
                    })}
                    <line x1={x(nowS)} x2={x(nowS)} y1={MARGIN.top} y2={H - MARGIN.bottom} className="m-now" />
                    <text x={x(nowS) + 4} y={H - MARGIN.bottom - 4} className="m-now-lab">MAINTENANT</text>
                  </svg>
                </div>
                {nowOffscreen && <button type="button" className="marey-now-btn" onClick={() => scrollTo(nowS, true)}>{nowS < vFrom ? '← ' : ''}MAINTENANT{nowS > vTo ? ' →' : ''}</button>}
              </>
            )}
            {line && shown.length === 0 && data && !failed && <p className="term-dim marey-empty">AUCUN TRAIN SUR CETTE LIGNE DANS LES HEURES CHARGÉES</p>}
          </div>
          <dl className="marey-foot">
            <dt>RETARD</dt>
            <dd className="marey-legend" aria-label="Légende des retards">
              {TERMINUS_BUCKETS.map((b, i) => <span key={b}><span className={`seg-c s${i}`} aria-hidden="true">█</span> {b} </span>)}MIN <span className="term-dim">· RETARDS PUBLIÉS PAR PAS DE 5 MIN</span>
            </dd>
            <dt>TRAIT</dt>
            <dd>POINTILLÉ = HORAIRE THÉORIQUE · PLEIN = RETARD PUBLIÉ, RECONSTITUÉ À CHAQUE COLLECTE (≈ TOUTES LES {COLLECT_INTERVAL_S / 60} MIN) · ESTOMPÉ = APRÈS MAINTENANT · APPROXIMATIF</dd>
            <dt>COMMANDES</dt>
            <dd>FAITES DÉFILER POUR VOIR LA JOURNÉE (4 H → 2 H) · TOUCHES 1-5 : AXE · ← → : BRANCHE · ÉCHAP : RETOUR</dd>
          </dl>
        </div>
        <aside className="term-panel marey-side" aria-live="polite">
          <h2 className="term-panel-title">TRAIN</h2>
          {wanted?.train && data && !highlighted && <p className="bad" role="status">TRAIN {wanted.train} INTROUVABLE DANS LES HEURES CHARGÉES</p>}
          {focused ? <TrainInfo item={focused} nowS={nowS ?? 0} gareUic={(nom) => uicByName.get(nom) ?? null} /> : <p className="term-dim">SURVOLEZ UN TRAIN</p>}
        </aside>
      </main>
      <FootBar />
    </div>
  );
}

function TrainInfo({ item, nowS, gareUic }: { item: Item; nowS: number; gareUic: (nom: string) => string | null }) {
  const t = item.train;
  const delay = t.delay_s ?? 0;
  const tone = delayTone(t.delay_s, t.cancelled);
  const first = t.stops[0]?.[2], last = t.stops[t.stops.length - 1]?.[1];
  const state = t.cancelled ? 'SUPPRIMÉ' : first !== undefined && nowS < first ? `PART À ${hhmm(first)}` : last !== undefined && nowS > last + Math.max(delay, 0) ? 'ARRIVÉ' : 'EN ROUTE';
  const cat = t.cause_cat ? CAUSE_LABELS[t.cause_cat]?.short : undefined;
  return (
    <>
    <dl className="marey-info">
      <div><dt>N°</dt><dd>{t.train_number} · {t.brand}</dd></div>
      <div><dt>TRAJET</dt><dd>{[t.origin, t.dest].some(Boolean) ? [t.origin, t.dest].filter((n): n is string => Boolean(n)).map((n, i) => {
        // Gare connue des gares chargées : son nom ouvre son panneau sur l'accueil.
        const uic = gareUic(n);
        return <span key={i}>{i > 0 && ' → '}{uic ? <a className="to-marey" href={`/?gare=${uic}`}>{shortName(n, 40)}</a> : shortName(n, 40)}</span>;
      }) : '—'}</dd></div>
    </dl>
    <TrainActions number={t.train_number} current="MAREY" onMap={state === 'EN ROUTE'} />
    <dl className="marey-info">
      <div><dt>ÉTAT</dt><dd>{state}</dd></div>
      <div><dt>RETARD</dt><dd className={`tone-${tone}`}>{t.cancelled ? 'SUPPRIMÉ' : t.delay_s === undefined ? 'INCONNU' : `${delay >= 60 ? '+' : ''}${Math.round(delay / 60)} MIN`}</dd></div>
      <div><dt>CAUSE</dt><dd>{cat ?? (t.cause ? '' : 'NON DÉCLARÉE')}{t.cause && <span className="marey-cause-text">{t.cause}</span>}</dd></div>
      <div><dt>INDEMNITÉ</dt><dd>{t.comp_pct > 0 ? `≈ ${t.comp_eur_per_passenger_ref.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT PAR VOYAGEUR (${t.comp_pct} %)` : 'AUCUNE À CE RETARD'}</dd></div>
    </dl>
    </>
  );
}
