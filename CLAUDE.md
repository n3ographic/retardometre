# sncf-tracking
Observatoire TGV : ingestion GTFS-RT (`scripts/`), base Supabase (`supabase/`),
site Next.js (`web/`) déployé sur Vercel.

## Commandes
- Tests : `npm test` (racine) et `npm test --prefix web`
- Types : `npx tsc --noEmit` (racine) et `npx tsc --noEmit -p web`
- Build : `npm run build --prefix web`
- Dev : configuration `web` de `.claude/launch.json` (port 3000)

## Conventions
- Commits en français, `type(portée): ...`, une PR par sujet.
- Ne jamais afficher le contenu de `.env.local` ni de `web/.env.local`.
- Notes du projet (contexte, état, règles de prod, décisions) : `~/vault/projects/sncf-tracking.md`.
- Question d'architecture : interroger `graphify-out/` avant de lire des fichiers.
