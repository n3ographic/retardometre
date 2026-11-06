'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CarteView, { type Focus, type Highlight } from '../carte-view';
import type { CumulPayload } from '../../lib/cumul';
import { latest } from '../../lib/latest';
import type { LiveItem } from '../../lib/map-model';
import type { StatsPayload } from '../../lib/stats';
import { collectHealth } from '../../lib/marey';
import { parseGares, readBoard, type Board, type Tab } from '../../lib/station';
import type { GareRow } from '../../lib/command';
import { bucketHighlight, delayThresholds, liveEvents, nextLiveDelayMs, periodQuery, tickerFeed, type Period, type TickerItem } from '../../lib/terminal-model';
import FootBar from './foot-bar';
import GroupsPanel from './groups-panel';
import LeftPanel, { type BucketFilter } from './left-panel';
import PeriodPicker from './period-picker';
import RightPanel from './right-panel';
import { parseVue, type Vue } from './stats-tabs';
import StationPanel from './station-panel';
import StatusBar from './status-bar';
import TrainPanel from './train-panel';
import Ticker from './ticker';

const REFRESH_MS = 60_000; // tableau d'une gare et reprise après un échec ; /api/live suit la durée de son cache (nextLiveDelayMs)
const EVENT_TTL_MS = 3_600_000; // un événement reste dans le bandeau une heure
const TOP_N = 10; // taille du Top retards de la colonne de gauche
const AGG_REFRESH_MS = 300_000; // agrégats : cache serveur de 5 min (cumul) à 15 min (périodes)

// Charge les trois sources une fois pour tout l'écran ; chaque panneau gère l'échec de la sienne.
export default function TerminalView() {
  const [trains, setTrains] = useState<LiveItem[]>([]);
  const [liveFailed, setLiveFailed] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [cumul, setCumul] = useState<CumulPayload | null>(null);
  const [cumulFailed, setCumulFailed] = useState(false);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('7d');
  const [vue, setVue] = useState<Vue>('axes');
  const [events, setEvents] = useState<{ item: TickerItem; at: number }[]>([]);
  const prevTrains = useRef<LiveItem[]>([]);
  const record = useRef(0);
  const lastGen = useRef<string | null>(null);
  const thresholds = useRef<number[]>([]);
  const statsLatest = useRef(latest());
  const [focus, setFocus] = useState<Focus>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Numéro demandé par ?sel= mais absent du flux : la fiche s'ouvre quand même, « PAS EN CIRCULATION ».
  const [missing, setMissing] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  // Panneau gare (?gare=UIC[,UIC]) : à la place de la fiche du train ; choisir un train le ferme.
  const [gare, setGare] = useState<string[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [boardFailed, setBoardFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('DEP');
  // Toutes les gares (/api/gares) : points cliquables de la carte, origine et destination cliquables dans la fiche.
  const [gares, setGares] = useState<GareRow[]>([]);
  useEffect(() => {
    fetch('/api/gares').then((r) => (r.ok ? r.json() : null)).then((d: { gares?: GareRow[] } | null) => { if (Array.isArray(d?.gares)) setGares(d.gares); }).catch(() => {});
  }, []);
  const uicByName = useMemo(() => new Map(gares.map((g) => [g[1], g[0]])), [gares]);
  const commandData = useMemo(() => ({ trains, gares }), [trains, gares]);
  // Train sélectionné gardé dans l'URL (?sel=) : un retour depuis le Marey le retrouve.
  const initialSel = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams(window.location.search), g = parseGares(q.get('gare'));
    if (g) setGare(g); else initialSel.current = q.get('sel');
    setVue(parseVue(q.get('vue')));
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = REFRESH_MS;
      try {
        const r = await fetch('/api/live');
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { trains: LiveItem[]; generated_at: string };
        if (!alive) return;
        // Événements entre deux relevés distincts (une réponse identique du CDN n'en produit pas).
        if (d.generated_at !== lastGen.current) {
          lastGen.current = d.generated_at;
          const ev = liveEvents(prevTrains.current, d.trains, thresholds.current, record.current);
          record.current = ev.record;
          const now = Date.now();
          setEvents((old) => [...ev.events.map((item) => ({ item, at: now })), ...old].filter((e) => now - e.at < EVENT_TTL_MS).slice(0, 30));
        }
        prevTrains.current = d.trains;
        setTrains(d.trains);
        setGeneratedAt(d.generated_at);
        const sel = initialSel.current;
        initialSel.current = null;
        const hit = sel ? d.trains.find((t) => t.train_number === sel) : undefined;
        if (hit) { setFocus({ trip_id: hit.trip_id, at: Date.now() }); setSelected(hit.trip_id); }
        else if (sel && /^\d{1,5}$/.test(sel)) setMissing(sel);
        setLastOk(Date.now());
        setLiveFailed(false);
        delay = nextLiveDelayMs(d.generated_at);
      } catch {
        if (alive) setLiveFailed(true); // on garde les derniers trains
      }
      if (alive) timer = setTimeout(load, delay);
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let alive = true;
    let got = false;
    const load = async () => {
      try {
        const r = await fetch('/api/cumul');
        const d = (await r.json()) as CumulPayload;
        if (!r.ok || !Array.isArray(d.by_brand)) throw new Error(String(r.status));
        got = true;
        if (alive) { setCumul(d); setCumulFailed(false); }
      } catch {
        // Un échec après un premier succès garde le dernier chiffre affiché.
        if (alive && !got) setCumulFailed(true);
      }
    };
    load();
    const t = setInterval(load, AGG_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Seule la dernière période demandée écrit l'état : une réponse arrivée trop tard est ignorée.
  const loadStats = useCallback(async (p: Period) => {
    const isLatest = statsLatest.current();
    setStatsLoading(true);
    setStatsFailed(false);
    try {
      const r = await fetch(`/api/stats?${periodQuery(p)}`);
      const d = (await r.json()) as StatsPayload;
      if (!r.ok || !Array.isArray(d.groups) || !d.totals) throw new Error(String(r.status));
      if (isLatest()) setStats(d);
    } catch {
      if (isLatest()) setStatsFailed(true);
    } finally {
      if (isLatest()) setStatsLoading(false);
    }
  }, []);
  useEffect(() => {
    loadStats(period);
    const t = setInterval(() => loadStats(period), AGG_REFRESH_MS);
    return () => clearInterval(t);
  }, [period, loadStats]);
  const reloadStats = useCallback(() => loadStats(period), [period, loadStats]);

  const select = useCallback((id: string | null) => { setSelected(id); setMissing(null); setSpeed(null); setGare(null); }, []);
  const openGare = useCallback((uic: string) => { select(null); setGare([uic]); }, [select]);
  useEffect(() => {
    if (initialSel.current) return; // pas avant d'avoir relu ?sel=
    const n = trains.find((t) => t.trip_id === selected)?.train_number ?? missing;
    const u = new URL(window.location.href);
    if (n) u.searchParams.set('sel', n); else u.searchParams.delete('sel');
    if (gare) u.searchParams.set('gare', gare.join(',')); else u.searchParams.delete('gare');
    u.searchParams.set('vue', vue);
    window.history.replaceState(null, '', u);
  }, [selected, missing, gare, vue]); // seule la sélection réécrit l'URL, pas chaque rafraîchissement des trains
  // Train choisi avant l'arrivée du flux (ou entré dans le flux depuis) : il devient une vraie sélection, carte centrée.
  useEffect(() => {
    const hit = missing ? trains.find((t) => t.train_number === missing) : undefined;
    if (!hit) return;
    setFocus({ trip_id: hit.trip_id, at: Date.now() });
    select(hit.trip_id);
  }, [trains, missing, select]);

  // Tableau de la gare : relu à chaque minute tant que le panneau est ouvert (cache serveur d'un cycle de collecte).
  useEffect(() => {
    setBoard(null);
    setBoardFailed(false);
    if (!gare) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/gare?uic=${gare.join(',')}`);
        if (!r.ok) throw new Error(String(r.status));
        const b = readBoard(await r.json());
        if (alive) { setBoard(b); setBoardFailed(false); }
      } catch {
        if (alive) setBoardFailed(true); // on garde le dernier tableau
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [gare]);
  const gareHighlight = useMemo<Highlight>(() => (gare && board
    ? { trips: board.rows.map((r) => r.trip_id), points: board.gares.map((g) => [g.lon, g.lat] as [number, number]) } : null), [gare, board]);
  // Tranche de l'histogramme survolée ou épinglée : ses trains en avant sur la carte (le panneau gare reste prioritaire).
  const [bucket, setBucket] = useState<BucketFilter>(null);
  useEffect(() => {
    if (!bucket?.pinned) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setBucket(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [bucket]);
  const highlight = useMemo<Highlight>(() => gareHighlight
    ?? (bucket ? { trips: bucketHighlight(trains, new Date(), bucket.idx, selected), points: [] } : null), [gareHighlight, bucket, trains, selected]);
  const rules = useMemo(() => (stats ? { compensation_scale: stats.assumptions.compensation_scale, prices: stats.assumptions.prices } : null), [stats]);
  // Règle unique de l'accueil : un clic sur un train le centre sur la carte (s'il a une position) et ouvre sa fiche.
  const onFocus = useCallback((trip_id: string) => { setFocus({ trip_id, at: Date.now() }); select(trip_id); }, [select]);
  // Ligne du tableau d'une gare : même règle ; un train pas encore dans le flux ouvre sa fiche « PAS EN CIRCULATION ».
  const onPick = (trip_id: string, number: string) => {
    if (trains.some((t) => t.trip_id === trip_id)) { onFocus(trip_id); return; }
    select(null);
    setMissing(number);
  };
  thresholds.current = useMemo(() => (stats ? delayThresholds(stats.assumptions.compensation_scale) : []), [stats]);
  // Événements récents d'abord ; sans événement, les trains en retard au-delà du Top 10.
  const items = useMemo(() => {
    const recent = events.filter((e) => Date.now() - e.at < EVENT_TTL_MS).map((e) => e.item);
    return tickerFeed(recent, trains, TOP_N, 15);
  }, [events, trains]);
  // Retard du collecteur mesuré à la production de la réponse (comme sur /marey), pas l'âge du cache de /api/live (jusqu'à ~6 min).
  const status = (liveFailed && trains.length === 0) || !generatedAt ? { status: 'unknown' as const, ageMin: null } : collectHealth(generatedAt, trains);

  return (
    <div className="term">
      <StatusBar status={status} coveragePct={cumul?.coverage_pct ?? null} picker={<PeriodPicker value={period} onChange={setPeriod} />} />
      <Ticker items={items} failed={liveFailed} onFocus={onFocus} />
      <main className="term-grid">
        <h1 className="sr-only">Retardomètre : trains en circulation, retards et indemnités théoriques</h1>
        <LeftPanel trains={trains} liveFailed={liveFailed} onFocus={onFocus} filter={bucket} onFilter={setBucket} />
        <div className="term-center">
          <CarteView trains={trains} failed={liveFailed} lastOk={lastOk} focus={focus} selected={selected} onSelect={select} onSpeed={setSpeed}
            highlight={highlight} gares={gares} onGare={openGare}
            overlay={gare ? <StationPanel uics={gare} board={board} failed={boardFailed} tab={tab} onTab={setTab} onPick={onPick} onClose={() => setGare(null)} />
              : selected || missing ? <TrainPanel train={trains.find((t) => t.trip_id === selected) ?? null} missing={missing} gareOf={(nom) => uicByName.get(nom) ?? null} onGare={openGare} rules={rules} speed={speed} onClose={() => select(null)} /> : null} />
          <GroupsPanel stats={stats} failed={statsFailed} loading={statsLoading} period={period} onRetry={reloadStats} />
        </div>
        <RightPanel cumul={cumul} cumulFailed={cumulFailed} stats={stats} statsFailed={statsFailed} statsLoading={statsLoading} period={period} inFeed={trains.length}
          vue={vue} onVue={setVue} keys={!gare && !selected && !missing} onRetry={reloadStats} />
      </main>
      <FootBar data={commandData} />
    </div>
  );
}
