# Working in this repo

Inchmeal Industries is mid-migration from a static GitHub Pages site to a
Strapi (CMS) → Astro (build) → Cloudflare (host) stack. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first — it's the actual design
doc (decisions + why) and the phased plan. [docs/CHANGELOG.md](docs/CHANGELOG.md)
is the dated log of what's actually been done, session by session. This file
is the quick-reference for how to work in the repo day to day.

## Branch strategy — read this before committing anything

All migration work happens on the **`rebuild`** branch. **Never commit
migration work to `main`** — `main` is still what GitHub Pages serves live
at inchmealindustries.com.au via `.github/workflows/static.yml`, and stays
untouched until Phase 8 cutover (see docs/ARCHITECTURE.md Section 5.2 and 9).
If you're on `main`, `git checkout rebuild` (or create it from `main` if it
doesn't exist locally) before doing any migration work.

## Layout

```
cms/                    Strapi 5 + SQLite (npm workspace)
site/                   Astro static site (npm workspace) — what Cloudflare Pages builds
scripts/export-content/ Strapi -> site/src/content JSON bridge (npm workspace)
docker-compose.yml      `strapi` (always-on) + `publisher` (on-demand, profile "tools")
docs/                   ARCHITECTURE.md (plan) + CHANGELOG.md (log)
```

Root `package.json` is an npm workspaces root covering all three
sub-projects. Run `npm install` from the repo root, not inside each
workspace, so dependencies stay hoisted and consistent.

## Common commands

```bash
npm run build-check              # astro build (site/) — the fastest correctness check
npm run export                   # Strapi -> site/src/content JSON (needs STRAPI_API_TOKEN)
npm run push                     # commit + push content changes (needs GITHUB_TOKEN)
npm run publish                  # export -> build-check -> push, chained

npm run develop --workspace=cms  # Strapi admin UI at localhost:1337/admin
npm run dev --workspace=site     # Astro dev server at localhost:4321
```

The `publisher` container runs these same scripts against a running `strapi`
service over Docker Compose's network — see docs/ARCHITECTURE.md Section 5.1
and 8 for the real operational flow.

## Secrets

Every `.env` is git-ignored; only `.env.example` files are committed
(`cms/.env.example`, `scripts/export-content/.env.example`). Never commit a
real `.env`, an API token, or the R2/GitHub credentials — they're supplied
at runtime only. If you generate local Strapi secrets for dev/testing,
that's fine for `cms/.env` locally, but production secrets on the real
Docker host are generated once by Casey and must stay stable across
container rebuilds (regenerating them breaks admin sessions/tokens).

## Content model source of truth

Strapi's SQLite DB is the source of truth for *authoring*. The JSON files
committed under `site/src/content/` are the source of truth for *what's
live* — nothing at build time ever talks to Strapi. See
docs/ARCHITECTURE.md Section 2.1 and 9.

## Verifying changes

- `site/`: `npm run build --workspace=site` catches schema/config errors
  fast. For anything visual, actually run the dev server and look at it —
  the `run` skill (headless Chromium via `npx playwright`, since
  `chromium-cli` isn't available in this environment) is the pattern used
  so far. Don't leave temporary/sample content collection JSON committed —
  add it to check rendering, then remove it before committing.
- `cms/`: `npm run develop --workspace=cms` and confirm it boots with no
  schema errors after touching any `content-types/*/schema.json` or
  `components/**/*.json`.
- Don't test against Casey's real Docker host from here — this repo's local
  `cms/.env` / dev server is for schema/template verification only, not a
  stand-in for the actual self-hosted deployment.

## Conventions

- Keep `docs/ARCHITECTURE.md` as the design record (decisions + why) and
  `docs/CHANGELOG.md` as the append-only log of what happened. When you
  finish a chunk of work, add a dated entry to the changelog and, if a
  phase completed or a plan detail changed during implementation, note it
  in ARCHITECTURE.md too rather than letting the two drift apart.
- Follow the phase breakdown in docs/ARCHITECTURE.md Section 7 for what's
  Claude-Code-doable vs. needs Casey directly (dashboard logins, generating
  API tokens interactively, etc).
