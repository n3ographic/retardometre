// Libellés des catégories de cause (codes de la table cause_rules et de cause_category en base).
export const CAUSE_LABELS: Record<string, { short: string; long: string }> = {
  enchainement: { short: 'ENCHAÎNEMENT', long: 'Enchaînement (retard venu d’un trajet précédent, d’un équipage ou d’une correspondance)' },
  meteo: { short: 'MÉTÉO', long: 'Météo et végétation' },
  obstacle: { short: 'OBSTACLE / ANIMAL', long: 'Obstacle, animal, choc' },
  malveillance: { short: 'MALVEILLANCE', long: 'Malveillance (vol de câbles, vandalisme, signal d’alarme tiré abusivement)' },
  voyageurs_surete: { short: 'VOYAGEURS / SÛRETÉ', long: 'Voyageurs et sûreté' },
  infrastructure: { short: 'INFRASTRUCTURE', long: 'Infrastructure et travaux' },
  materiel: { short: 'MATÉRIEL', long: 'Matériel et préparation du train' },
  regulation: { short: 'RÉGULATION', long: 'Régulation du trafic' },
  information: { short: 'INFO SANS CAUSE', long: 'Information sans cause (itinéraire modifié, desserte, fin de perturbation)' },
  plusieurs: { short: 'PLUSIEURS CAUSES', long: 'Plusieurs causes' },
  exploitation: { short: 'EXPLOITATION', long: 'Incident d’exploitation non précisé' },
  autre: { short: 'AUTRE', long: 'Autre' },
  sans_cause: { short: 'SANS CAUSE', long: 'Sans cause déclarée' },
};

// Extrait d'un texte de cause SNCF : jusqu'à la dernière fin de phrase avant max caractères (sinon dernier mot entier),
// suivi de « … » ; texte court rendu tel quel.
export function causeExcerpt(text: string, max = 160): { short: string; cut: boolean } {
  if (text.length <= max) return { short: text, cut: false };
  const head = text.slice(0, max);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  const at = end >= 40 ? end + 1 : head.lastIndexOf(' ');
  return { short: `${head.slice(0, at > 0 ? at : max).trimEnd()} …`, cut: true };
}

// Fin d'alerte SNCF sans cause : le début du message (la vraie cause) n'est pas dans le texte stocké.
export const isGenericCause = (text: string) => /^C['’]est pourquoi, nous vous invitons à consulter/i.test(text.trim());
