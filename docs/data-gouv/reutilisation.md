# Réutilisation data.gouv.fr — texte prêt à publier

Préparé le 2026-10-26. À créer avec ton compte data.gouv.fr (menu « Publier », puis réutilisation).
Les champs ci-dessous viennent du schéma de l'API data.gouv.fr (obligatoires : titre, description, thématique, type, URL) ; je n'ai pas vérifié l'interface du formulaire elle-même, les libellés peuvent différer un peu.

## Champs

| Champ | Valeur |
|---|---|
| Titre | Observatoire TGV : retards, suppressions et indemnités théoriques en temps réel |
| Type | Application |
| Thématique | Transports et mobilité |
| URL | https://sncf-tracking.vercel.app |
| Propriétaire | ton compte personnel (ou une organisation, au choix) |
| Tags | `tgv`, `sncf`, `ouigo`, `inoui`, `ponctualite`, `retards`, `transport-ferroviaire`, `temps-reel`, `gtfs-rt`, `observatoire` |
| Image | facultative, carrée : une capture de l'écran d'accueil (carte et panneaux) |

## Jeux de données à lier

1. **Réseau SNCF TGV, Intercités et TER** (`horaires-sncf`, ODbL) : fournit les horaires théoriques (GTFS) et les deux flux temps réel (Trip Updates, Service Alerts) que le site lit. https://www.data.gouv.fr/datasets/horaires-sncf
2. **Régularité mensuelle TGV par liaisons** (`regularite-mensuelle-tgv-par-liaisons`, ODbL) : la règle « à l'heure » du site en est reprise. https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons
3. **Fichier de formes des lignes du Réseau Ferré National** (`fichier-de-formes-des-lignes-du-reseau-ferre-national`, ODbL) : sert à tracer les trains sur les voies. https://www.data.gouv.fr/datasets/fichier-de-formes-des-lignes-du-reseau-ferre-national

## Description (Markdown, à coller telle quelle)

```markdown
**Observatoire TGV** suit la ponctualité des TGV INOUI et OUIGO à partir des données ouvertes de SNCF : le flux temps réel (GTFS-RT, relevé toutes les 2 minutes) est confronté aux horaires théoriques (GTFS).

**Ce que montre le site**
- une carte des trains en circulation, avec leur retard et les suppressions ;
- la régularité, le taux de suppression et la répartition des retards à l'arrivée, par marque et par axe, sur 7, 14 ou 31 jours ou sur un mois ;
- un compteur cumulé d'indemnités théoriques, calculé d'après les barèmes publiés par SNCF Voyageurs.

**Ce qu'il faut savoir avant d'utiliser les chiffres**
- Les positions des trains sont estimées entre deux arrêts, pas mesurées.
- La régularité est une approximation de la régularité officielle : le flux publie les retards par pas de 5 minutes. Elle n'est pas comparable telle quelle aux chiffres officiels.
- Les indemnités sont théoriques : prix moyen par marque, taux d'occupation de 0,75 (moyenne tous TGV de l'ART en 2023 : 76-77 %, sans détail par marque), trains observés seulement. Elles ne mesurent pas ce que SNCF verse.
- La collecte a commencé le 20 octobre 2026 ; la couverture est affichée sur le site.
- Périmètre : TGV INOUI et OUIGO (OUIGO Train Classique exclus).

La page « Méthodologie » détaille les règles de calcul, les sources et les limites : https://sncf-tracking.vercel.app/methodologie

Projet indépendant, non affilié à SNCF ni à OUIGO. Code source sous licence MIT : https://github.com/n3ographic/retardometre. Les données dérivées sont sous licence ODbL ; le site contient des informations de SNCF Open Data et de transport.data.gouv.fr, sous licence ODbL.
```

## À décider avant de publier

- **Licence du code** : réglée, le code est sous MIT (`LICENSE` à la racine, commit du 2026-10-26) et les données restent sous ODbL. Le texte de la fiche l'indique. Le fichier doit être poussé sur GitHub avant que la fiche ne le mentionne publiquement.
- **Image** : sans image, la fiche s'affiche avec un visuel par défaut ; une capture de l'écran d'accueil rend la fiche plus lisible.
- **Après l'export du 1er novembre** : on prépare le jeu de données (journal d'événements mensuel et statistiques journalières). La fiche pourra alors lui être liée.
