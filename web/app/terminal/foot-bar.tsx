import CommandBar from './command-bar';
import FKeys from './f-keys';

export default function FootBar() {
  return (
    <footer className="term-bar term-foot">
      <nav aria-label="Pages">
        <a href="/">F1 CARTE</a>
        <a href="/methodologie">F2 MÉTHODO</a>
        <a href="/marey">F3 MAREY</a>
        <CommandBar />
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
