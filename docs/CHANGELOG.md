# Changelog

Dated, append-only log of what's actually been done on the Strapi → Astro →
Cloudflare migration (docs/ARCHITECTURE.md). Newest entries first. This
records *what happened and why*, not design decisions — those live in
ARCHITECTURE.md.

## 2026-08-28

**Phases 1-4 implemented on the `rebuild` branch** (`main` untouched).
Pushed to `origin/rebuild`.

- **Phase 1 — repo scaffold.** Created `rebuild` from `main`. Added the
  monorepo layout (`cms/`, `site/`, `scripts/`, `docs/`), root `.gitignore`,
  and an npm workspaces root `package.json`. Committed
  `docs/ARCHITECTURE.md`.

- **Phase 2 — Strapi.** Scaffolded Strapi 5.52.2 (JavaScript, SQLite) into
  `cms/` via `create-strapi-app`. Hand-wrote the `Production`, `SiteSettings`
  (single type), and `Page` content types plus `shared.credit`,
  `shared.team-member`, `shared.social-link` components per
  ARCHITECTURE.md Section 4. Wired the `strapi-provider-cloudflare-r2`
  upload provider (config confirmed against the package's actual README,
  not guessed) reading R2 credentials from env. `cms/Dockerfile` follows
  Strapi's official multi-stage Docker guide
  (docs.strapi.io/cms/installation/docker) verbatim, with `python3` added
  to the build stage's apk packages so `better-sqlite3`'s native build
  (via node-gyp) succeeds on Alpine — the official example only covers
  Postgres/MySQL, not SQLite.

  **Verified:** `npm run develop --workspace=cms` boots cleanly with all
  three content types and the R2 provider loading without error.

  **Bug caught and fixed during verification:** an empty
  `DATABASE_FILENAME=` in `cms/.env` (git-ignored, local-only) was read by
  Strapi as an explicit override rather than falling through to the
  `.tmp/data.db` default, pointing better-sqlite3 at the `cms/` directory
  itself instead of a file and crashing on startup with `SqliteError:
  unable to open database file`. Fixed locally by setting it explicitly;
  worth knowing if the same thing happens on Casey's Docker host — the env
  var needs a real value, not an empty string.

- **Phase 3 — Astro site.** Scaffolded Astro 7.2.9 into `site/` (minimal
  template). Content collections config lives at `site/src/content.config.ts`
  (this Astro version's convention, not `src/content/config.ts`), using the
  `glob` loader against `site/src/content/{productions,pages,settings}/*.json`
  with Zod schemas matching the export script's output shape. Built
  `Base.astro` (shared header/nav/footer), `index.astro` (portfolio grid),
  `productions/[slug].astro` (detail page), `about.astro`, and
  `contact.astro`, all sourced from the content collections. Ported the
  *actual* old-site CSS/JS/fonts/images into `site/public/` (copied
  verbatim from the repo root's `css/`, `fonts/`, `js/`, `images/`) rather
  than redesigning — this preserves the real look and feel. Deliberately
  did **not** copy the 3 unused `works-image-*.jpg` files (tied to the
  excluded `works-details.html` template page per ARCHITECTURE.md Section
  6.0). `astro.config.mjs` sets `site` and an `image.remotePatterns` entry
  for `media.inchmealindustries.com.au`.

  **Verified:** added temporary sample content (one `SiteSettings` entry,
  two `Production` entries), ran the dev server, and screenshotted all four
  page types (home, production detail, about, contact) via headless
  Chromium (`npx playwright screenshot` — `chromium-cli` isn't available in
  this Windows environment, so the `run` skill's Playwright fallback path
  was used instead). All four rendered correctly with the ported styling.
  Removed the sample content before committing — real content only enters
  via Strapi (Phase 6).

  Fixed one build error along the way: `<script src="/js/...">` tags
  referencing `public/` assets need `is:inline`, or Astro tries to bundle
  them and the build fails.

- **Phase 4 — export/publisher.** Wrote `scripts/export-content/export.js`
  (Strapi REST → `site/src/content/*.json`, with stale-file deletion for
  anything unpublished/removed in Strapi) and `push.js` (git add/commit/push
  using a GitHub token supplied only on the `git push` command line, per
  ARCHITECTURE.md Section 5.1's credential-handling decision — never
  written to `.git/config`). Both are dependency-free (Node's built-in
  `fetch`, `fs`, `child_process`). Added `scripts/export-content/Dockerfile`
  (Node + git, no SSH) and an `entrypoint.sh` that runs `npm ci` against the
  bind-mounted repo before executing whatever `npm run <script>` was passed.
  Root `docker-compose.yml` adds the `strapi` service (bind-mounted SQLite
  data dir at `./cms-data`) and the `publisher` service (`profiles: [tools]`,
  whole-repo bind mount).

**Housekeeping:** ignored `cms/types/` (Strapi's auto-regenerated type
declarations — showed up as untracked after the first `npm run develop`
run and don't belong in git).

**Still open** (see docs/ARCHITECTURE.md Section 7 for the full phase
breakdown) — all require Casey directly:
- Phase 2 manual: create the R2 bucket + API token in the Cloudflare
  dashboard; generate Strapi's *production* security keys on the real
  Docker host (keep them stable, don't reuse the local dev ones generated
  during this session).
- Phase 4 manual: mint the fine-grained GitHub PAT for
  `scripts/export-content/.env`.
- Phase 5: create the Cloudflare Pages project (production branch
  `rebuild` for now) and the `media.inchmealindustries.com.au` R2 custom
  domain.
- Phase 6: re-enter the 6 productions + About + Contact through the
  running Strapi admin UI.
