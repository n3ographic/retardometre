'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CarteView, { type Focus } from '../carte-view';
import type { Cumul } from '../../lib/cumul';
import { latest } from '../../lib/latest';
import type { LiveItem } from '../../lib/map-model';
import type { StatsPayload } from '../../lib/stats';
import { collectStatus, periodQuery, tickerItems, type Period } from '../../lib/terminal-model';
import FootBar from './foot-bar';
import CausesPanel from './causes-panel';
import GroupsPanel from './groups-panel';
import LeftPanel from './left-panel';
import PeriodPicker from './period-picker';
import RightPanel from './right-panel';
import StatusBar from './status-bar';
import TrainPanel from './train-panel';
import Ticker from './ticker';

const REFRESH_MS = 60_000;

// Charge les trois sources une fois pour tout l'écran ; chaque panneau gère l'échec de la sienne.
export default function TerminalView() {
  const [trains, setTrains] = useState<LiveItem[]>([]);
  const [liveFailed, setLiveFailed] = useState(false);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [cumul, setCumul] = useState<Cumul | null>(null);
  const [cumulFailed, setCumulFailed] = useState(false);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('7d');
  const statsLatest = useRef(latest());
  const [focus, setFocus] = useState<Focus>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  // Train sélectionné gardé dans l'URL (?sel=) : un retour depuis le Marey le retrouve.
  const initialSel = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    initialSel.current = new URLSearchParams(window.location.search).get('sel');
    const load = async () => {
      try {
        const r = await fetch('/api/live');
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { trains: LiveItem[] };
        if (!alive) return;
        setTrains(d.trains);
        const sel = initialSel.current;
        initialSel.current = null;
        const hit = sel ? d.trains.find((t) => t.train_number === sel) : undefined;
        if (hit) { setFocus({ trip_id: hit.trip_id, at: Date.now() }); setSelected(hit.trip_id); }
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
    (async () => {
      try {
        const r = await fetch('/api/cumul');
        const d = (await r.json()) as Cumul;
        if (!r.ok || !Array.isArray(d.by_brand)) throw new Error(String(r.status));
        if (alive) setCumul(d);
      } catch {
        if (alive) setCumulFailed(true);
      }
    })();
    return () => { alive = false; };
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
  useEffect(() => { loadStats(period); }, [period, loadStats]);
  const reloadStats = useCallback(() => loadStats(period), [period, loadStats]);

  const select = useCallback((id: string | null) => { setSelected(id); setSpeed(null); }, []);
  useEffect(() => {
    if (initialSel.current) return; // pas avant d'avoir relu ?sel=
    const n = trains.find((t) => t.trip_id === selected)?.train_number;
    const u = new URL(window.location.href);
    if (n) u.searchParams.set('sel', n); else u.searchParams.delete('sel');
    window.history.replaceState(null, '', u);
  }, [selected]); // seule la sélection réécrit l'URL, pas chaque rafraîchissement des trains
  const rules = useMemo(() => (stats ? { compensation_scale: stats.assumptions.compensation_scale, prices: stats.assumptions.prices } : null), [stats]);
  const onFocus = useCallback((trip_id: string) => { setFocus({ trip_id, at: Date.now() }); setSelected(trip_id); }, []);
  const items = useMemo(() => tickerItems(trains, 15), [trains]);
  const status = liveFailed && trains.length === 0 ? { status: 'unknown' as const, ageMin: null } : collectStatus(trains, new Date());

  return (
    <div className="term">
      <StatusBar status={status} coveragePct={cumul?.coverage_pct ?? null} picker={<PeriodPicker value={period} onChange={setPeriod} />} />
      <Ticker items={items} failed={liveFailed} />
      <main className="term-grid">
        <h1 className="sr-only">Observatoire TGV : trains en circulation, retards et indemnités théoriques</h1>
        <LeftPanel trains={trains} liveFailed={liveFailed} stats={stats} statsFailed={statsFailed} statsLoading={statsLoading} period={period} onFocus={onFocus} />
        <div className="term-center">
          <CarteView trains={trains} failed={liveFailed} lastOk={lastOk} focus={focus} selected={selected} onSelect={select} onSpeed={setSpeed}
            overlay={selected ? <TrainPanel train={trains.find((t) => t.trip_id === selected) ?? null} rules={rules} speed={speed} onClose={() => select(null)} /> : null} />
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
