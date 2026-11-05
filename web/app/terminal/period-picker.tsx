'use client';

import { useMemo } from 'react';
import { monthOptions } from '../../lib/dashboard-model';
import { FIXED_PERIODS, periodLabel, type Period } from '../../lib/terminal-model';

// Filtre global des statistiques (bloc Période, tableau marque × axe, taux de suppression) ; la carte, le direct et le cumul n'en dépendent pas.
export default function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const months = useMemo(() => monthOptions(new Date()), []);
  const isMonth = !/^\d+d$/.test(value);
  return (
    <div className="period" role="group" aria-label="Période des statistiques">
      <span className="term-dim">STATISTIQUES</span>
      {FIXED_PERIODS.map((p) => (
        <button key={p} type="button" aria-pressed={value === p} onClick={() => onChange(p)}>{periodLabel(p)}</button>
      ))}
      <select aria-label="Mois" autoComplete="off" value={isMonth ? value : ''} className={isMonth ? 'on' : undefined}
        onChange={(e) => e.target.value && onChange(e.target.value)}>
        <option value="">MOIS</option>
        {months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}
      </select>
    </div>
  );
}
