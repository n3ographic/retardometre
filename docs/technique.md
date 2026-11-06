# Retardomètre : documentation technique

Ce document décrit l'architecture, l'API publique, les définitions de calcul et le développement. Pour une présentation du projet, voir le [README](../README.md) ; pour les règles détaillées et leurs sources, la page [Méthodologie](https://retardometre.vercel.app/methodologie).

## Architecture

1. **Collecte.** Toutes les 2 minutes, `pg_cron` appelle l'Edge Function Supabase `collect`, authentifiée par un secret stocké dans Supabase Vault. Elle lit les deux flux GTFS-RT (Trip Updates et Service Alerts), ne garde que les TGV INOUI et OUIGO TGV (règle de marque dans `supabase/functions/_shared/classify.ts`) et calcule les changements depuis le passage précédent.
2. **Écriture.** La fonction SQL `collector_apply` écrit ces changements en une transaction : la table `events` (journal, conservé 30 jours) et la table `circulations` (état courant de chaque trajet).
3. **Horaires théoriques.** Chaque nuit (02:15 UTC), GitHub Actions importe le GTFS statique pour J, J+1 et J+2 (`.github/workflows/import-static.yml`). Aucun trajet n'est supprimé : un trajet retiré du GTFS (souvent une suppression tardive) reste dans `trips_planned` avec `removed_at` renseigné.
4. **Agrégats.** Des tâches `pg_cron` enregistrent chaque nuit les statistiques de la veille et de l'avant-veille (`daily-stats`, 04:30 UTC) et, chaque lundi, le bilan de la semaine écoulée (`weekly-report`, 05:00 UTC).
5. **Export et purge.** Le 1er de chaque mois (04:00 UTC), GitHub Actions publie le journal du mois précédent en Release (`.github/workflows/export-month.yml`). La purge quotidienne (`purge`, 03:30 UTC) ne supprime que des mois déjà exportés.
6. **Site.** Next.js (dossier `web/`), déployé sur Vercel en région Paris. Il ne lit la base qu'avec la clé publique (rôle `anon`, sans aucun droit d'écriture).

Le schéma est dans `supabase/migrations/`, le code partagé de la collecte dans `supabase/functions/_shared/`.

## Export mensuel

Le journal du mois précédent (heure de Paris) est publié en CSV gzip dans les [Releases](https://github.com/n3ographic/retardometre/releases), sous le tag `events-AAAA-MM`, sous licence ODbL. Une ligne est un changement observé sur un trajet.

| Colonne | Contenu |
|---|---|
| `id` | identifiant croissant de l'événement |
| `observed_at` | instant d'observation (horodatage du flux) |
| `service_date` | date de circulation |
| `trip_id` | identifiant du trajet dans le GTFS SNCF |
| `kind` | `first_seen`, `delay`, `stop_cancelled`, `cancelled`, `uncancelled`, `alert_added`, `alert_removed` |
| `stop_sequence` | rang de l'arrêt concerné (vide pour un événement de trajet) |
| `value` | détail JSON : `delay_s` et `from_s` (retard en secondes, nouveau et précédent ; `from_s` vide si inconnu), `was_cancelled: true` quand un arrêt supprimé redevient desservi, `alert_id` |

## API publique

Toutes les routes sont en lecture seule, en `GET`, et répondent en JSON. Un paramètre inconnu ou invalide donne une erreur `400`, une base indisponible une erreur `502`. Le corps d'erreur est `{"error": "…"}`, jamais mis en cache (`Cache-Control: no-store`).

Chaque route est protégée par un cache de données côté serveur (indexé par les paramètres validés, jamais par l'URL brute) puis par le cache du CDN, indiqué ci-dessous.

| Route | Paramètres | Contenu | Cache CDN |
|---|---|---|---|
| `/api/stats` | `period` (`7d` par défaut, `14d`, `31d`) **ou** `month` (`AAAA-MM`, depuis `2026-10`) | statistiques d'une période de jours de service | 15 min |
| `/api/live` | aucun | trains en circulation | 1 min |
| `/api/cumul` | aucun | indemnités cumulées depuis le 20/10/2026 et chiffres du jour | 5 min |
| `/api/rules` | aucun | règles de calcul lues en base | 1 h |
| `/api/gares` | aucun | toutes les gares : `[uic, nom, lat, lon]` | 1 h |
| `/api/gare` | `uic` : jusqu'à 8 codes UIC de 8 chiffres, séparés par des virgules, à moins de 30 km les uns des autres | départs et arrivées de ces gares | 1 min |
| `/api/marey` | `axe` (`ATLANTIQUE` par défaut, `EST`, `NORD`, `SUD_EST`, `INTERSECTEURS`), `bloc` (début d'une tranche de 3 h, en secondes Unix, facultatif) | trains d'un axe pour le graphique de Marey | 1 min |
| `/api/marey/index` | aucun | index léger des trains de la fenêtre, tous axes | 1 min |

### `/api/stats`

`period` couvre les n derniers jours, jusqu'à la veille (heure de Paris). `month` couvre le mois, jusqu'à aujourd'hui pour le mois en cours. Les deux paramètres ensemble donnent une erreur.

Réponse : `from`, `to`, `computed_at`, `groups` (un objet par marque et par axe), `totals` (mêmes champs, tous groupes confondus), `cause_breakdown` (répartition par cause) et `assumptions` (occupation, prix, barèmes, fourchette). Champs principaux d'un groupe :

- comptes : `planned`, `observed`, `removed_late`, `never_observed`, `cancelled`, `no_terminus`, `circulated`, `on_time_official`, `comp_eligible`, `aberrant`, `skipped_stop` ;
- `official_regularity_pct` : `on_time_official / circulated × 100`, `null` si aucun train n'a circulé ;
- `terminus_buckets` et `stop_buckets` : répartition des retards par tranche, au terminus et à chaque arrêt ;
- `estimated_cost_eur_ht`, avec `_low` et `_high` : indemnités théoriques en euros HT, à l'occupation de référence, et leur fourchette ;
- `estimated_cost_eur_ht_bon` : la part versée en bons d'achat ;
- `intl_cap_eur_ht` : l'effet du plafond de 50 % sur les trajets internationaux ;
- `cost_eur_ht_at_full_occupancy` : même coût avec des rames pleines. Le coût est proportionnel à l'occupation : pour une autre hypothèse, `coût = cost_eur_ht_at_full_occupancy × occupation`.

### `/api/live`

Réponse : `generated_at` et `trains`. Un train porte notamment `trip_id`, `service_date`, `brand`, `axis`, `train_number`, `intl`, `cancelled`, `dep_planned`, `arr_planned`, `origin`, `dest`, `delay_s` et `last_seq` (dernier arrêt portant un retard publié, le plus souvent le terminus), `cause`, `comp_pct`, `comp_eur_per_passenger_ref` (indemnité par voyageur au prix de référence HT), `last_seen_at` et `stops` (fenêtre de trois arrêts autour de la position estimée). Les valeurs nulles sont omises. Un `dep_planned` dans le futur désigne un train annoncé mais pas encore parti.

### `/api/cumul`

Indemnités théoriques cumulées depuis le jour de service du 2026-10-20, calculées jour par jour (`daily_stats`) puis complétées par les jours pas encore enregistrés et le jour en cours. Réponse : `since`, `through`, `days`, les comptes (`planned`, `observed`, `circulated`, `comp_eligible`, `cancelled`, `no_terminus`, `aberrant`), `coverage_pct` (observés / prévus), `cost_eur_ht` avec `_low`, `_high` et `_bon`, `cost_eur_ht_at_full_occupancy`, `by_brand`, `today` et `assumptions`. **Observé seulement, jamais extrapolé** : le compteur sous-estime la réalité tant que la couverture est incomplète.

### `/api/rules`

Réponse : `generated_at`, `compensation_scale` (barème par marque et par portée, nationale ou internationale : `from_s`, `pct`, `form` = bon ou argent, `source_url`, `source_as_of`), `regularity_rule` (`duration_from_s`, `max_delay_exclusive_s`, `source_url`) et `reference_prices` (`brand`, `price_eur_ht`, `seats`, leurs sources et `as_of`).

## Définitions de calcul

Les règles vivent en base (tables `regularity_rule`, `compensation_scale`, `reference_prices`, `cause_rules`), lisibles publiquement et exposées par `/api/rules`. La page [Méthodologie](https://retardometre.vercel.app/methodologie) en donne les sources.

- **Train terminé** : annulé, ou arrivée prévue + retard au terminus + 30 min dépassée. Seuls les trains terminés entrent dans les statistiques.
- **`circulated`** : train terminé, non annulé, dont le retard au terminus est connu. Les `no_terminus` (terminés sans retard connu au terminus) ne comptent ni au numérateur ni au dénominateur de la régularité.
- **Régularité officielle** (méthode du jeu data.gouv.fr « Régularité mensuelle TGV par liaisons ») : un train est à l'heure si son retard au terminus est strictement inférieur à 5 min (trajet de moins de 1 h 30), 10 min (de 1 h 30 à 3 h) ou 15 min (plus de 3 h). Les suppressions sont exclues du dénominateur.
- **Indemnités** : barème G30 pour TGV INOUI (25 % dès 30 min en bon d'achat, puis en argent au-delà d'une heure : 25 %, 50 % dès 2 h, 75 % au-delà de 3 h ; plafond de 50 % sur les trajets internationaux) ; CGV OUIGO n° 74, art. 3.3.2, pour OUIGO (25 % dès 1 h, 50 % dès 2 h, en bon d'achat convertible). Les valeurs exactes sont celles de `/api/rules`.
- **Coût estimé** = Σ (pourcentage / 100 × prix de référence HT × places × occupation). Prix moyen HT par marque (FNAUT d'après l'ART, 2023), capacité d'une rame (plancher, les rames couplées ne sont pas connues), occupation de référence 0,75 (ART, 2023, pour l'ensemble des TGV).
- **Fourchette** : le flux publie les retards par pas de 5 minutes, donc le retard réel est à moins de 4 min 59 s du retard publié. Central = retard publié ; haut = retard + 299 s ; bas = retard − 299 s.
- **Retards aberrants** : un retard au terminus d'au moins 12 h est écarté des mesures et compté à part (`aberrant`).
- **Un train par numéro et par jour** : les variantes d'horaire créées par les réimports ne comptent qu'une fois (vues `canonical_trips` et `canonical_circulations`).
- **`removed_late`** : trajet prévu, jamais vu dans le flux, puis retiré du GTFS (suppression tardive probable). **`never_observed`** : trajet prévu, jamais vu dans le flux et toujours au GTFS.
- **Causes** : texte des alertes classé en catégories par la table `cause_rules`, sur les trains en retard d'au moins 5 min.

## Développement

Node 24 pour la racine (collecte, scripts, tests SQL), Node 22 ou plus pour `web/`.

```sh
npm install
npm test               # tests unitaires et tests SQL en mémoire (vitest, PGlite)
npx tsc --noEmit       # types
npm run inspect        # sondage des flux GTFS-RT et du GTFS statique
```

Site :

```sh
npm install --prefix web
npm test --prefix web
npx tsc --noEmit -p web
npm run dev --prefix web       # http://localhost:3000
npm run build --prefix web
```

Données de la carte, régénérées à la main quand le plan de transport change :

```sh
npm run build:traces    # web/public/trace-paires.json (tracés entre arrêts consécutifs)
npm run build:vitesses  # web/public/vitesses-lignes.json (calque VMAX), après build:traces
```

**Migrations.** Elles s'appliquent dans l'ordre des fichiers de `supabase/migrations/`. En production, les versions portent l'horodatage de leur application : avant tout `supabase db push`, aligner l'historique avec `supabase migration repair --status applied <version>` pour chaque version du dépôt enregistrée sous un autre horodatage.

**Variables.** Le site n'utilise que `SUPABASE_URL` et `SUPABASE_ANON_KEY` (clé publique). Les workflows GitHub et les scripts d'import ont besoin de `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, en secrets GitHub Actions ou dans un `.env.local` local (ignoré par Git). Le secret partagé entre `pg_cron` et l'Edge Function vit dans Supabase Vault. Aucun secret ne figure dans le code.

## Supervision

- Chaque passage du collecteur met à jour `collector_state.last_run_at`, même quand le flux n'a pas changé ; `last_error` porte la dernière erreur, ou un avertissement quand le flux contient des TGV qui ne correspondent pas au plan, ou quand le plan du jour est vide.
- `import-static.yml` se termine par `scripts/check-collector.ts`, qui fait échouer le job si le dernier passage date de plus de 10 min ou si `last_error` est renseigné : GitHub prévient alors par courriel.
- GitHub désactive les workflows planifiés d'un dépôt public après 60 jours sans commit, et Supabase Free met en pause un projet inactif : les deux sont à surveiller.
