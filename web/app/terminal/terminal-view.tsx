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
import { periodQuery, tickerItems, type Period } from '../../lib/terminal-model';
import FootBar from './foot-bar';
import CausesPanel from './causes-panel';
import GroupsPanel from './groups-panel';
import LeftPanel from './left-panel';
import PeriodPicker from './period-picker';
import RightPanel from './right-panel';
import StationPanel from './station-panel';
import StatusBar from './status-bar';
import TrainPanel from './train-panel';
import Ticker from './ticker';

const REFRESH_MS = 60_000;
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
  // Train sélectionné gardé dans l'URL (?sel=) : un retour depuis le Marey le retrouve.
  const initialSel = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams(window.location.search), g = parseGares(q.get('gare'));
    if (g) setGare(g); else initialSel.current = q.get('sel');
    const load = async () => {
      try {
        const r = await fetch('/api/live');
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { trains: LiveItem[]; generated_at: string };
        if (!alive) return;
        setTrains(d.trains);
        setGeneratedAt(d.generated_at);
        const sel = initialSel.current;
        initialSel.current = null;
        const hit = sel ? d.trains.find((t) => t.train_number === sel) : undefined;
        if (hit) { setFocus({ trip_id: hit.trip_id, at: Date.now() }); setSelected(hit.trip_id); }
        else if (sel && /^\d{1,5}$/.test(sel)) setMissing(sel);
        setLastOk(Date.now());
        setLiveFailed(false);
      } catch {
        if (alive) setLiveFailed(true); // on garde les derniers trains
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
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
    window.history.replaceState(null, '', u);
  }, [selected, missing, gare]); // seule la sélection réécrit l'URL, pas chaque rafraîchissement des trains
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
  const highlight = useMemo<Highlight>(() => (gare && board
    ? { trips: board.rows.map((r) => r.trip_id), points: board.gares.map((g) => [g.lon, g.lat] as [number, number]) } : null), [gare, board]);
  const rules = useMemo(() => (stats ? { compensation_scale: stats.assumptions.compensation_scale, prices: stats.assumptions.prices } : null), [stats]);
  // Règle unique de l'accueil : un clic sur un train le centre sur la carte (s'il a une position) et ouvre sa fiche.
  const onFocus = useCallback((trip_id: string) => { setFocus({ trip_id, at: Date.now() }); select(trip_id); }, [select]);
  // Ligne du tableau d'une gare : même règle ; un train pas encore dans le flux ouvre sa fiche « PAS EN CIRCULATION ».
  const onPick = (trip_id: string, number: string) => {
    if (trains.some((t) => t.trip_id === trip_id)) { onFocus(trip_id); return; }
    select(null);
    setMissing(number);
  };
  const items = useMemo(() => tickerItems(trains, 15), [trains]);
  // Retard du collecteur mesuré à la production de la réponse (comme sur /marey), pas l'âge du cache de /api/live (jusqu'à ~6 min).
  const status = (liveFailed && trains.length === 0) || !generatedAt ? { status: 'unknown' as const, ageMin: null } : collectHealth(generatedAt, trains);

  return (
    <div className="term">
      <StatusBar status={status} coveragePct={cumul?.coverage_pct ?? null} picker={<PeriodPicker value={period} onChange={setPeriod} />} />
      <Ticker items={items} failed={liveFailed} onFocus={onFocus} />
      <main className="term-grid">
        <h1 className="sr-only">Observatoire TGV : trains en circulation, retards et indemnités théoriques</h1>
        <LeftPanel trains={trains} liveFailed={liveFailed} stats={stats} statsFailed={statsFailed} statsLoading={statsLoading} period={period} onFocus={onFocus} />
        <div className="term-center">
          <CarteView trains={trains} failed={liveFailed} lastOk={lastOk} focus={focus} selected={selected} onSelect={select} onSpeed={setSpeed}
            highlight={highlight} gares={gares} onGare={openGare}
            overlay={gare ? <StationPanel uics={gare} board={board} failed={boardFailed} tab={tab} onTab={setTab} onPick={onPick} onClose={() => setGare(null)} />
              : selected || missing ? <TrainPanel train={trains.find((t) => t.trip_id === selected) ?? null} missing={missing} gareOf={(nom) => uicByName.get(nom) ?? null} onGare={openGare} rules={rules} speed={speed} onClose={() => select(null)} /> : null} />
          <div className="term-bottom">
            <GroupsPanel stats={stats} failed={statsFailed} loading={statsLoading} period={period} onRetry={reloadStats} />
            <CausesPanel stats={stats} failed={statsFailed} loading={statsLoading} period={period} />
          </div>
        </div>
        <RightPanel cumul={cumul} cumulFailed={cumulFailed} stats={stats} statsFailed={statsFailed} statsLoading={statsLoading} period={period} />
      </main>
      <FootBar />
    </div>
  );
}
