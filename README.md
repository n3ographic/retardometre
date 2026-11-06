# Retardomètre

Les retards de la grande vitesse en France, mesurés en direct à partir des données ouvertes.

**Site : https://retardometre.vercel.app**

> Projet indépendant, non affilié à SNCF ni à OUIGO. Aucune donnée privée : tout vient des flux publics de SNCF.

## Ce que montre le site

- **La carte en direct** : chaque TGV INOUI et OUIGO en circulation, coloré selon son retard, avec sa cause quand le flux en donne une et l'indemnité théorique par voyageur.
- **Les chiffres du jour et de la période** (7, 14 ou 31 jours, ou un mois) : régularité, suppressions, répartition des retards, par marque et par axe, et causes des retards.
- **Les indemnités théoriques** : ce que SNCF devrait verser aux voyageurs selon ses propres barèmes, cumulé depuis le début de la collecte.
- **Le graphique de Marey** (`/marey`) : la marche des trains d'un axe sur six heures, gare par gare.
- **La fiche de chaque train** (`/train/6611`) et le **bilan de chaque semaine** (`/semaine/2026-W44`), avec leurs images de partage.
- **La méthodologie** (`/methodologie`) : sources, définitions, barèmes et limites, en détail.

## Ce qu'il faut savoir avant de citer un chiffre

- **Les positions sur la carte sont estimées**, à partir des horaires et des retards publiés, pas mesurées.
- **Le flux publie les retards par pas de 5 minutes.** La régularité est donc approchée, et les indemnités sont données en fourchette (basse, centrale, haute).
- **Les indemnités sont théoriques** : prix moyen par marque, une rame par train, occupation de 75 %. Elles ne tiennent compte ni des correspondances, ni des retards connus à l'achat, ni des remboursements choisis par les voyageurs.
- **Seuls les trains vus dans le flux sont comptés**, jamais extrapolés. La collecte a commencé le 20 octobre 2026.
- **Périmètre** : TGV INOUI et OUIGO TGV. Les OUIGO Train Classique, Intercités et TER n'en font pas partie.

Le détail de chaque règle, avec ses sources, est sur la page [Méthodologie](https://retardometre.vercel.app/methodologie).

## Réutiliser les données

- **Export mensuel** : chaque mois, le journal des événements du mois précédent est publié en CSV gzip dans les [Releases](https://github.com/n3ographic/retardometre/releases), sous le tag `events-AAAA-MM`.
- **API publique en lecture seule** : `/api/stats`, `/api/live`, `/api/cumul`, `/api/rules`, `/api/gares`, `/api/gare` et `/api/marey`. Paramètres, réponses et caches : [docs/technique.md](docs/technique.md).
- **Règles de calcul en JSON** : [`/api/rules`](https://retardometre.vercel.app/api/rules) donne les barèmes, les seuils de régularité et les prix de référence utilisés.

## Sources

- Flux temps réel GTFS-RT de SNCF (Trip Updates et Service Alerts), via [transport.data.gouv.fr](https://transport.data.gouv.fr).
- Horaires théoriques GTFS de SNCF Voyageurs ([SNCF Open Data](https://ressources.data.sncf.com)).
- Formes des lignes du Réseau Ferré National (SNCF Réseau) et, pour les tronçons qu'il ne couvre pas, les [tracés ferroviaires de Train Nomade](https://trainnomade.fr/donnees/), d'après les contributeurs OpenStreetMap.
- Vitesses maximales nominales sur ligne (SNCF Réseau), pour le calque VMAX de la carte.
- Fond de carte [OpenFreeMap](https://openfreemap.org), données © contributeurs OpenStreetMap.

## Licences

- **Code** : licence [MIT](LICENSE).
- **Données** : licence [ODbL 1.0](data/LICENSE-ODbL.txt). Le site et ses exports contiennent des informations de SNCF Open Data, de transport.data.gouv.fr, de SNCF Réseau, de Train Nomade et des contributeurs OpenStreetMap, sous licence ODbL. Les données publiées et les bases dérivées (comme `web/public/trace-paires.json`) ne sont pas couvertes par la licence MIT.

## Pour les développeurs

Architecture, API, définitions de calcul, développement et supervision : [docs/technique.md](docs/technique.md).
