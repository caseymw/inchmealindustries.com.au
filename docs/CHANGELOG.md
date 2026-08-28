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

**Phase 2 and Phase 4 manual steps completed by Casey** (deployed via
Komodo on Casey's Docker host):
- Created the `media-inchmealindustries-web` R2 bucket and an
  **Account**-scoped R2 API token (Object Read & Write, scoped to that
  bucket only), populated into `cms/.env`.
- Generated production Strapi security keys (`APP_KEYS`,
  `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`,
  `JWT_SECRET`, `ENCRYPTION_KEY`) and put them in `cms/.env` on the
  Docker host — replacing the `cms/.env.example` placeholder values.
- Deployed the `strapi` service as a Komodo Stack. Changed the SQLite
  bind mount from the originally-planned repo-relative `./cms-data` to
  `${PVE_STACK_ROOT}/inchmeal/cms-data` (Komodo's appdata convention),
  so persistent CMS data lives outside the git checkout and can't be
  wiped by git operations on the clone. Set via Komodo's Stack
  Environment field (`PVE_STACK_ROOT=[[PVE_STACK_ROOT]]`), which Komodo
  interpolates into the Stack's root `.env` before running
  `docker compose up --env-file .env` — `${PVE_STACK_ROOT}` substitution
  happens at the Compose level and is unrelated to `cms/.env`, which is
  only loaded into the Strapi container at runtime via `env_file:`.
- Hit and fixed an `EACCES: permission denied, mkdir
  '/opt/app/database/migrations'` error on first boot: the bind-mounted
  host directory was auto-created as `root:root`, but the Strapi image
  runs as the non-root `node` user (uid 1000). Fixed with
  `chown -R 1000:1000` on the host directory — the `chown` baked into
  `cms/Dockerfile` only applies to the image's own layer, not to a bind
  mount that overlays it at runtime.
- Completed first-run admin account setup via the Strapi admin UI, then
  generated a Strapi API token there for the export script
  (`STRAPI_API_TOKEN` in `scripts/export-content/.env`).
- Minted the fine-grained GitHub PAT (Contents: Read and write only,
  scoped to this repo) for `GITHUB_TOKEN` in
  `scripts/export-content/.env`.

**Still open** (see docs/ARCHITECTURE.md Section 7 for the full phase
breakdown):
- Phase 6: re-enter the 6 productions + About + Contact through the
  running Strapi admin UI.

**Follow-up filed:** [#1](https://github.com/caseymw/inchmealindustries.com.au/issues/1) —
`cms/Dockerfile` is a hand-rolled multi-stage build rather than
Strapi's official Docker image, for maintainability/upgrade-path
reasons (see issue for detail).

**Phase 5 — Cloudflare hosting, started.** Discovered mid-setup that
Cloudflare has replaced the classic "Pages → Connect to Git" project
creation flow with a unified **Workers with static assets** flow;
Pages projects still run, but new ones are created as Workers now
(see ARCHITECTURE.md Phase 5 for the full note — same architectural
role, different product name, still $0/month).

- Added `wrangler` as a root devDependency and committed
  `wrangler.jsonc` (`assets.directory: "site/dist"`) so the dashboard's
  `npx wrangler deploy` deploy command has something to work with.
  Validated locally first: `npm run build --workspace=site` then
  `npx wrangler deploy --dry-run` read all 76 files from `site/dist`
  cleanly before Casey touched the dashboard.
- Casey created the Worker via **Workers & Pages → Create application
  → Pages → Connect to Git**, repo `caseymw/inchmealindustries.com.au`.
- **First deploy failed** — the creation screen has no production-branch
  selector and silently defaulted to `main`, which doesn't have the
  monorepo structure. Expected failure, not a bug in the config.
  Fixed via **Settings → Build → Branch control**, repointed to
  `rebuild`.
- **Second issue hit:** the Cloudflare GitHub App's repo access was
  scoped wrong (didn't include this repo, or lacked needed
  permissions — Casey fixed via GitHub's app-installation settings).
  Verified fixed with an empty trigger commit
  (`784703c`) — **build succeeded** against `rebuild`.
- **R2 custom domain configured** by Casey. Verified: `media.inchmealindustries.com.au`
  resolves through Cloudflare's edge and the bucket responds (a `404`
  on the bucket root is R2's expected "no object at this path," not
  an error — no file's been uploaded there yet). **Phase 5 complete.**

**Phase 6 — content migration, text content done via Strapi's built-in
MCP server instead of manual admin-UI entry.** Casey asked whether
Claude Code could do Phase 6 directly; Strapi 5.47+ ships a built-in
MCP server (off by default), which turned out to be viable instead of
hand-typing everything into the admin UI.

Getting it connected took several rounds of debugging, worth recording
since it'll bite anyone re-doing this setup:

- Enabled via `mcp: { enabled: true }` in `cms/config/server.js`
  (`c57cbb5`) — off by default, no plugin install needed, just this
  config key.
- **First gotcha:** a Komodo "Deploy" that only restarts the existing
  container doesn't pick up the change — `config/server.js` is baked
  into the image at build time (`COPY . .` in `cms/Dockerfile`), not
  bind-mounted like the SQLite data dir. Needed an actual rebuild
  (`docker compose build --no-cache strapi`, or Komodo's Destroy +
  Deploy) before `/mcp` started responding as a real route instead of
  falling through to Strapi's generic 404/405 handling.
- **Second gotcha:** the MCP server authenticates with a Strapi
  **Admin Token** (Settings → Administration Panel → Admin Tokens),
  which is a completely different token type from the **API Token**
  (Settings → API Tokens, Content API) already in use for
  `STRAPI_API_TOKEN` in the export script. Using the wrong token type
  gets a JSON-RPC `401 Authentication required` even though the
  `/mcp` endpoint itself is reachable and correctly configured.
- **Third gotcha, Windows-specific:** registering the server with
  `claude mcp add --transport http ...` from a terminal wrote the
  config under the project key `D:/GIT_Repos/...` (capital drive
  letter), but the VS Code extension session resolved its own project
  key as `d:/GIT_Repos/...` (lowercase) — two different entries in
  `~/.claude.json` for the same folder, depending on which process's
  `cwd` happened to report which case. Windows drive-letter casing
  isn't guaranteed stable across subprocesses in this environment.
  Fixed by duplicating the `strapi-mcp` registration into both
  casings; a config backup was written alongside it
  (`~/.claude.json.bak-<timestamp>`) before editing.
- Along the way, a token got printed into this session's transcript
  while debugging the config file (a `node -e` dump of the whole
  config, not intentional) — flagged to Casey at the time; nothing
  external saw it, but worth knowing if session transcripts are ever
  shared.

Once connected, used the MCP tools (`create_production`,
`write_site-setting`, `publish_production`, `publish_site-setting`)
to enter and publish all real content, sourced from the corresponding
`*-details.html` / `about.html` / `contact.html` files in the old
static site:

- All 6 productions (33 Variations, The Appleton Ladies' Potato Race,
  Gaslight, Speed, The Last 5 Years, Titanic) — title, tagline (where
  the old site had one — only Speed/Titanic did), synopsis, `ourRole`,
  `credits` (writer/producer/director plus a `Venue` credit per
  venue — Speed and Titanic each toured multiple venues, which the
  schema doesn't have a dedicated field for), `year` (most recent run
  for multi-venue shows), and `sortOrder` matching the homepage grid's
  existing order. Minor obvious typos in the source HTML (e.g. "Club
  RydeX", "Equipent", "increidble", "complient", "thier") were
  corrected during entry rather than carried over verbatim.
- `SiteSettings`: tagline, mission blurb, the one confirmed team
  member (Casey Moon-Watton, Chief Everything Officer), contact email,
  Instagram social link.
- All entries published (not left as drafts).

**Known gap: no images uploaded yet.** The MCP tools' `images` field
takes existing media IDs, not file uploads — Strapi's MCP server
doesn't expose a media-upload tool (uploads are multipart, not
JSON-RPC). The production photos are already sitting in
`site/public/images/work/` from Phase 3 but haven't been pushed into
Strapi's media library / R2. Still needs either manual drag-and-drop
in the admin UI per production, or a small one-off script against
Strapi's REST upload endpoint using `STRAPI_API_TOKEN`.
