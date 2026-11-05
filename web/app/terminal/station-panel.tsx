'use client';

import { boardLines, boardTitle, regPct, type Board, type Tab } from '../../lib/station';
import { bucketIndex, gare } from '../../lib/terminal-model';
import { useShortcuts } from './train-actions';

const TABS: [Tab, string][] = [['DEP', 'DÉPARTS'], ['ARR', 'ARRIVÉES']];
const tone = (p: number | null) => (p === null ? 'term-dim' : p >= 80 ? 'tone-ontime' : p >= 60 ? 'tone-late' : p >= 40 ? 'tone-strong' : 'tone-severe');

// Panneau gare (?gare=) : à la place de la fiche du train, tableau d'affichage des départs et arrivées de -30 min à +3 h.
// Un clic sur une ligne ouvre la fiche du train, comme partout sur l'accueil.
export default function StationPanel({ uics, board, failed, tab, onTab, onPick, onClose }: {
  uics: string[]; board: Board | null; failed: boolean; tab: Tab; onTab: (t: Tab) => void;
  onPick: (trip_id: string, number: string) => void; onClose: () => void;
}) {
  const marey = `/marey?gare=${uics[0]}`;
  useShortcuts({ M: marey });
  const title = board ? boardTitle(board) : 'GARE';
  const pct = board ? regPct(board) : null;
  const lines = board ? boardLines(board, tab, new Date()) : [];
  return (
    <aside className="train-modal station-panel" role="dialog" aria-label={`Gare ${title}`}>
      <header><h2 className="term-panel-title">{title}</h2><button type="button" className="term-btn" onClick={onClose} aria-label="Fermer le panneau gare">×</button></header>
      {board && board.gares.length > 1 && <p className="term-dim">{board.gares.map((g) => g.nom.toUpperCase()).join(' · ')}</p>}
      <nav className="train-actions" aria-label="Voir la gare">
        <a className="ta-btn" href={marey} aria-keyshortcuts="M"><kbd aria-hidden="true">M</kbd>MAREY</a>
      </nav>
      {failed && !board ? <p className="term-dim">INDISPONIBLE</p> : !board ? <p className="term-dim">…</p> : (
        <>
          <p>
            {board.today_trains} TRAINS AUJOURD’HUI · RÉGULARITÉ 7J{' '}
            <span className={tone(pct)}>{pct === null ? '—' : `${pct.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`}</span>
          </p>
          <div className="st-tabs" role="tablist" aria-label="Tableau">
            {TABS.map(([t, label]) => (
              <button key={t} type="button" role="tab" id={`st-tab-${t}`} aria-selected={tab === t} aria-controls="st-board"
                className={tab === t ? 'ta-btn on' : 'ta-btn'} onClick={() => onTab(t)}
                onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onTab(t === 'DEP' ? 'ARR' : 'DEP'); } }}>
                {label}
              </button>
            ))}
          </div>
          <div id="st-board" role="tabpanel" aria-labelledby={`st-tab-${tab}`}>
            {lines.length === 0 ? <p className="term-dim">AUCUN TRAIN ENTRE -30 MIN ET +3 H</p> : (
              <ol className="st-board">
                <li className="st-head" aria-hidden="true"><span>PRÉVU</span><span>ESTIMÉ</span><span>N°</span><span>{tab === 'DEP' ? 'DESTINATION' : 'PROVENANCE'}</span><span>RETARD</span></li>
                {lines.map((l) => (
                  <li key={l.trip_id} className={l.past ? 'st-past' : undefined}>
                    <button type="button" onClick={() => onPick(l.trip_id, l.train_number)}>
                      <span>{l.planned}</span>
                      <span>{l.cancelled ? '—' : l.estimated}</span>
                      <span>{l.brand === 'OUIGO' ? 'OG' : 'IN'} {l.train_number}</span>
                      <span className="st-place" title={l.place}>{gare(l.place)}</span>
                      {l.cancelled ? <span className="tone-cancelled">SUPPR.</span>
                        : <span className={`seg-c s${bucketIndex(l.delay_s)}`}>{l.delay_s >= 60 ? `+${Math.round(l.delay_s / 60)}′` : 'À L’H.'}</span>}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="term-dim">ESTIMÉ = PRÉVU + RETARD PUBLIÉ · RÉGULARITÉ AU TERMINUS DES TRAINS QUI DESSERVENT LA GARE AUJOURD’HUI</p>
        </>
      )}
    </aside>
  );
}
