import CommandBar from './command-bar';
import FKeys from './f-keys';
import type { CommandData } from '../../lib/command';

// data : trains et gares déjà chargés par la page (accueil), pour que la barre de commande ne les redemande pas.
export default function FootBar({ data }: { data?: CommandData }) {
  return (
    <footer className="term-bar term-foot">
      <nav aria-label="Pages">
        <a href="/">F1 CARTE</a>
        <a href="/methodologie">F2 MÉTHODO</a>
        <a href="/marey">F3 MAREY</a>
        <CommandBar data={data} />
      </nav>
      <FKeys />
      <span>POSITIONS ESTIMÉES · NON AFFILIÉ SNCF/OUIGO</span>
      {/* Limites des indemnités, détaillées sur /methodologie. */}
      <a href="/methodologie#indemnites" className="foot-limits">
        INDEMNITÉS THÉORIQUES : TRAJET DIRECT SANS CORRESPONDANCE · HORS RETARD CONNU À L’ACHAT OU REMBOURSEMENT CHOISI · PRIX MOYEN HT, OCCUPATION 0,75
      </a>
    </footer>
  );
}
