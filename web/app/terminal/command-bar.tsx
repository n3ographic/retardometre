'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { HELP, UNKNOWN, emptySuggestions, pushRecent, suggest, topSuggestions, type CommandData, type Suggestion } from '../../lib/command';
import type { LiveItem } from '../../lib/map-model';
import { bucketIndex } from '../../lib/terminal-model';

type Mode = 'suggest' | 'top' | 'help';
const RECENTS_KEY = 'cmd-recents';

// Récents propres à ce navigateur : confort seulement, tout échec de lecture ou d'écriture est ignoré.
const readRecents = (): Suggestion[] => { try { const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveRecents = (r: Suggestion[]) => { try { localStorage.setItem(RECENTS_KEY, JSON.stringify(r)); } catch { /* stockage indisponible */ } };

export const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

// Barre de commande façon terminal : « / » (hors champ texte) ou Ctrl+K / Cmd+K, sur toutes les pages (montée dans le pied).
// Données chargées à la première ouverture : trains du flux (/api/live) et gares (/api/gares).
export default function CommandBar() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<Mode>('suggest');
  const [msg, setMsg] = useState<string | null>(null);
  const [trains, setTrains] = useState<LiveItem[]>([]);
  const [gares, setGares] = useState<[string, string][]>([]);
  const [recents, setRecents] = useState<Suggestion[]>([]);
  const loaded = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((k === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey) || (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(e.target))) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    setRecents(readRecents());
    if (loaded.current) return;
    loaded.current = true;
    fetch('/api/live').then((r) => (r.ok ? r.json() : null)).then((d: { trains: LiveItem[] } | null) => d && setTrains(d.trains)).catch(() => {});
    fetch('/api/gares').then((r) => (r.ok ? r.json() : null)).then((d: { gares: [string, string][] } | null) => d && setGares(d.gares)).catch(() => {});
  }, [open]);

  const data = useMemo<CommandData>(() => ({ trains, gares }), [trains, gares]);
  const list: Suggestion[] = mode === 'top' ? topSuggestions(trains) : mode === 'help' ? [] : value.trim() === '' ? emptySuggestions(trains, recents) : suggest(value, data);
  const close = () => { setOpen(false); setValue(''); setSel(0); setMode('suggest'); setMsg(null); };
  const run = (s: Suggestion | undefined) => {
    if (!s) { setMsg(value.trim() === '' ? null : UNKNOWN); return; }
    if (s.kind === 'CMD') { setMode(s.label === 'TOP' ? 'top' : 'help'); setValue(''); setSel(0); setMsg(null); return; }
    if (!s.href) return;
    saveRecents(pushRecent(recents, s));
    window.location.assign(s.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length) setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); run(list[sel] ?? list[0]); }
  };

  if (!open) return <button type="button" className="cmd-hint" onClick={() => setOpen(true)} title="Barre de commande (/ ou Ctrl+K)">/ COMMANDE</button>;
  const title = mode === 'top' ? 'TOP · 10 PLUS GROS RETARDS' : mode === 'help' ? 'HELP · COMMANDES' : null;
  return (
    <div className="cmd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div className="cmd-bar" role="dialog" aria-modal="true" aria-label="Barre de commande" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close(); }}>
      <div className="cmd-line">
        <span className="cmd-prompt" aria-hidden="true">&gt;</span>
        {/* Saisie réelle transparente posée sur son reflet : le reflet porte le curseur bloc clignotant et « <GO> ». */}
        <span className="cmd-echo" aria-hidden="true">{value.toUpperCase()}<span className="cmd-caret">█</span>{value.trim() !== '' && <span className="cmd-go"> &lt;GO&gt;</span>}</span>
        <input ref={input} className="cmd-input" value={value} spellCheck={false} autoComplete="off"
          role="combobox" aria-expanded={list.length > 0} aria-controls="cmd-list" aria-activedescendant={list.length ? `cmd-opt-${sel}` : undefined}
          aria-label="Commande : numéro de train, axe, gare, page, TOP ou HELP"
          onChange={(e) => { setValue(e.target.value); setSel(0); setMode('suggest'); setMsg(null); }} onKeyDown={onKeyDown} />
      </div>
      {title && <p className="cmd-title">{title}</p>}
      {msg && <p className="cmd-msg bad" role="status">{msg}</p>}
      {mode === 'help' && (
        <dl className="cmd-help">{HELP.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      )}
      {list.length > 0 && (
        <ul id="cmd-list" className="cmd-list" role="listbox">
          {list.map((s, i) => [
            s.group && s.group !== list[i - 1]?.group && <li key={`g${s.group}`} role="presentation" className="cmd-group">{s.group}</li>,
            <li key={`${s.group ?? ''}${s.kind}${s.label}`} id={`cmd-opt-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'on' : undefined}
              onMouseDown={(e) => { e.preventDefault(); run(s); }} onMouseEnter={() => setSel(i)}>
              <span className="cmd-label">{s.label}</span>
              {s.kind === 'TRAIN' && s.delay_s !== undefined && (s.cancelled
                ? <span className="tone-cancelled">ANNULÉ</span>
                : <span className={`seg-c s${bucketIndex(s.delay_s)}`}>+{Math.round(Math.max(s.delay_s, 0) / 60)}′</span>)}
              <span className="cmd-kind">{s.kind === 'CMD' ? 'COMMANDE' : s.kind === 'TRAIN' ? 'MAREY' : s.kind}</span>
            </li>,
          ])}
        </ul>
      )}
      <p className="cmd-keys">↑ ↓ CHOISIR · ENTRÉE VALIDER · ÉCHAP FERMER · HELP : COMMANDES</p>
    </div>
    </div>
  );
}
