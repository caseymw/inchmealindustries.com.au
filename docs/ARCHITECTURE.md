# Inchmeal Industries: Strapi → Astro → Cloudflare Migration Plan

**Status:** Phases 1-4 implemented on `rebuild` (2026-08-28) — see docs/CHANGELOG.md for what actually happened and any deviations found during implementation. `main` untouched.
**Owner:** Casey
**Prepared for:** handoff to Claude Code
**Date:** 2026-08-27

## 1. Summary

Move Inchmeal Industries off GitHub Pages onto a headless-CMS-driven static site, without paying for a hosted CMS. Strapi runs as a **Docker container on one of Casey's own Docker hosts** — self-hosted infrastructure Casey already owns, not a paid cloud service — purely as a content-editing tool. An export script (run on that same host) pulls published content out of Strapi and writes it as flat files into an Astro project. Those flat files are committed to git and pushed — nothing at build or serve time ever talks to Strapi. Cloudflare Pages builds and hosts the Astro output; Cloudflare R2 hosts uploaded media. Total new recurring cost: **$0/month**.

The key architectural move is decoupling *authoring* (Strapi, self-hosted, private) from *building and serving* (Astro + Cloudflare, always-on, free). This is what makes "CI builds on git push" compatible with "Strapi isn't a public/paid always-on service": CI never needs to reach Strapi, because by the time anything is pushed, Strapi's content has already been flattened into the repo. Whether that Docker host runs Strapi occasionally or leaves it up continuously makes no difference to this design — it's still never reachable by, or a dependency of, the build.

## 2. Architecture Decisions

| Decision | Choice | Why |
|---|---|---|
| CMS | Strapi, containerized with Docker, SQLite, self-hosted on Casey's own Docker host(s) | Zero hosting cost (runs on hardware Casey already owns); Docker makes it portable — "spin it up wherever" — instead of tied to one machine's local Node install; SQLite still needs no separate DB server |
| Static site generator | Astro, static output | Content-first, minimal shipped JS, first-class "content collections" feature that maps cleanly onto exported CMS data |
| Media storage | Cloudflare R2, via an S3-compatible Strapi upload provider | Uploads go straight to R2 at save time in Strapi, so image URLs are permanent and don't depend on Strapi running; R2 has zero egress fees, unlike S3 |
| Content bridge | Custom Node export script, containerized (Docker), Strapi REST API → JSON files in the Astro repo | Keeps Strapi out of the build/deploy path entirely; the export step is the only thing that talks to Strapi; containerizing it (like Strapi itself) means the whole authoring toolchain is reproducible on any Docker host, not dependent on that host's local Node version |
| Publish trigger | `git push` → Cloudflare Pages' native Git integration | No GitHub Actions workflow needed for deploys; Pages watches the repo and builds automatically on push, at no cost |
| Hosting | Cloudflare Pages | Free, unlimited bandwidth/requests, custom domain support, automatic preview deploys on branches/PRs |
| Repo structure | Single monorepo: `/cms`, `/site`, `/scripts`, reusing the existing `caseymw/inchmealindustries.com.au` repo | One workspace for Claude Code to operate across; keeps the existing history/repo instead of starting fresh — restructured on a branch, not `main`, so the live GitHub Pages site is undisturbed until cutover (see Section 5.2) |
| Content model | Theatre-production portfolio: `Production`, `SiteSettings`, optional `Page` | Matches what the real site actually contains (Section 6.0) — a portfolio of past productions plus About/Contact info, not a generic product catalog |

### 2.1 Why this satisfies "CI build on git push" without an always-on CMS

A common mistake with this pattern is having the CI build step call Strapi's API directly (`astro build` fetching from `http://strapi-host/api/...`). That requires Strapi to be reachable at build time, which conflicts with "don't run it all the time." Instead:

- Strapi's job ends the moment the export script has written JSON files into `site/src/content/`.
- Those JSON files are committed to git like any other source file.
- Cloudflare Pages' build step (`astro build`) reads only from the committed files — it has no knowledge that Strapi exists.

This also means the git history of `site/src/content/` is a readable changelog of every content change ever published, and the site can always be rebuilt from a clean checkout with no external dependency.

### 2.2 Pipeline diagram

Two genuinely different flows, on two different clocks — content management is continuous (Strapi just sits there running), publishing is a deliberate action Casey triggers. Drawn as one flow before, which made it look like the export step wrote back into Strapi/SQLite; it never does — it only ever reads.

```mermaid
flowchart LR
    Casey((Casey))

    subgraph Authoring["Content management — continuous, whenever Casey edits"]
        Casey -->|edits via admin UI| Strapi[Strapi\nDocker container]
        Strapi -->|persists content| SQLite[(SQLite\nbind-mounted)]
        Strapi -->|uploads media| R2[(Cloudflare R2)]
    end

    subgraph Publishing["Publishing — only when Casey runs it"]
        Casey -->|runs docker compose run publisher| Export[Export script\nDocker container]
        Strapi -.->|serves published content\nread-only, REST API| Export
        Export -->|writes JSON, never writes back to Strapi| Content[site/src/content/*]
        Content -->|git commit + push| Repo[GitHub repo]
    end

    Repo -->|native Git integration| Build[Cloudflare Pages build\nastro build]
    Build --> Hosting[Cloudflare Pages\nstatic hosting]
    R2 -.->|image URLs resolved\nat request time, not build time| Hosting
    Hosting -->|inchmealindustries.com.au| Visitors((Visitors))
```

The dashed arrows are read-only/reference relationships (Strapi *serving* data to the export script; a visitor's browser *resolving* an R2 URL) — deliberately drawn differently from the solid arrows, which are all "this step actually writes/persists something."

## 3. Zero-cost hosting stack (verified free-tier limits, Aug 2026)

| Service | Free tier | Source |
|---|---|---|
| Cloudflare Pages | 500 builds/month, 1 concurrent build, unlimited requests/bandwidth, up to 100 custom domains/project | [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/) |
| Cloudflare R2 | One bucket, not two products — free capacity is 10 GB-month storage, 1M Class A + 10M Class B ops/month, **$0 egress always**; it's made public via the confirmed custom subdomain `media.inchmealindustries.com.au` once the domain's DNS zone is on Cloudflare (a standard, no-extra-cost R2 feature), with `*.r2.dev` as a free no-setup fallback if that hits a snag during Phase 5 | [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) |
| GitHub Actions | Not required for this design (Cloudflare Pages builds natively on push). If added later for extra checks: 2,000 free minutes/month on a private repo, unlimited on a public repo | [GitHub Actions billing](https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions) |
| Domain registration | Unchanged — Casey's existing registrar keeps the registration; only the DNS zone needs to point at Cloudflare | — |
| Strapi | Self-hosted in Docker on Casey's own hardware, $0 | — |

A low-traffic portfolio/catalog site sits comfortably inside every one of these limits.

### 3.1 Why a subdomain for media, not a subfolder of the main domain

Considered and rejected: serving media at `inchmealindustries.com.au/media/...` instead of a separate subdomain. R2's built-in custom domain feature only attaches at the hostname level — confirmed against Cloudflare's own docs, which describe connecting a full domain or subdomain to a bucket, not a path on an existing one. Getting a subpath to work would mean adding a Cloudflare Pages Function with an R2 binding to proxy `/media/*` requests to the bucket — technically well-supported, but it's custom code Casey would own and maintain (cache headers, range requests, 404s) versus zero code with R2 serving directly at Cloudflare's edge. Given the zero-maintenance goal driving the rest of this design, the subdomain stays the plan; `media.inchmealindustries.com.au` it is.

## 4. Content model

Confirmed against the real site (`caseymw/inchmealindustries.com.au`, see Section 6.0): Inchmeal Industries is a small production-services company for community/independent theatre — the "catalog" is a portfolio of 6 past productions they contributed lighting/sound/set/props work to (33 Variations, The Appleton Ladies' Potato Race, Gaslight, Speed, The Last 5 Years, Titanic), each with a synopsis, credits, and a description of Inchmeal's own role. There's no evidence of a category/genre taxonomy on the live site, so a full relational `Category` type would be over-building for 6 items — dropped in favor of a simple optional tag field.

- **Production** (collection type) — replaces the earlier generic `Item`:
  - `title` (e.g. "Titanic"), `slug`, `tagline` (e.g. "Titanic: The Movie, The Play.")
  - `synopsis` (rich text) — the show description
  - `credits` (repeatable component: `role` + `name`, e.g. "Written by" / "Produced by" / "Directed by") — captures the multi-writer, producer, director lines cleanly instead of one free-text blob
  - `ourRole` (rich text or short text) — what Inchmeal specifically did (e.g. "Lighting. Sound. Equipment. Crew. Props. Boats.")
  - `images` (media, multiple, ordered)
  - `year` (number) — the current site doesn't show one, but Casey confirmed adding it for sortable/labeled chronology
  - `featured` (boolean), `sortOrder` (number), `publishedAt` (built-in)
- **SiteSettings** (single type) — covers About + Contact, both of which are short/structured rather than freeform, so they don't need a separate `Page` type:
  - `tagline` ("we make stuff bringing productions to life"), `missionBlurb`
  - `teamMembers` (repeatable component: `name`, `role`) — one confirmed entry: **Casey Moon-Watton** / "Chief Everything Officer"; the live site's placeholder names ("John Doe" etc.) are dropped
  - `phone`, `email`, `socialLinks` (repeatable component), `footerText`
- **Page** (collection type, optional) — not needed for the initial migration since About/Contact fit SiteSettings; keep this type available in the schema for a future freeform page without building it out now.
- **Post** — not built for this migration. The current `blog.html`/`blog-details.html` contain only unedited Lorem-ipsum template content (dated "20 July 2016", copyright "2015 avana LLC" — the underlying HTML template's own placeholder branding, never replaced), so there's no real blog content to migrate, and Casey confirmed dropping it from scope. Can be added later with zero disruption to the rest of the site.

## 5. Repository layout

This restructures the **existing** `caseymw/inchmealindustries.com.au` repo rather than starting a new one — see 5.2 for how that's done safely.

```
inchmeal-industries/
├── cms/                  # Strapi project — built into a Docker image, not deployed to any host
│   ├── src/api/          # content-type schemas, version-controlled
│   ├── config/plugins.ts # R2 upload provider config
│   ├── config/database.ts # points SQLite at the bind-mounted data dir
│   ├── Dockerfile
│   └── .env.example
├── docker-compose.yml    # `strapi` (always-on) + `publisher` (on-demand) services
├── site/                 # Astro project (this is what Cloudflare Pages builds)
│   ├── src/content/      # exported JSON — committed, treated as source
│   │   ├── productions/
│   │   ├── pages/        # empty for now — schema kept for future use
│   │   └── settings/
│   ├── src/pages/
│   ├── src/components/
│   └── astro.config.mjs
├── scripts/
│   └── export-content/   # Strapi → site/src/content bridge
│       ├── Dockerfile    # the `publisher` service's image
│       └── .env.example  # GITHUB_TOKEN, GIT_COMMIT_NAME, GIT_COMMIT_EMAIL
├── docs/
│   └── ARCHITECTURE.md   # this document, committed for future reference
└── package.json          # npm workspaces root
```

`cms/` is git-ignored for its SQLite DB and `.env` (secrets, local state) but the schema/config, `Dockerfile`, and `docker-compose.yml` are all committed — so the whole CMS is reproducible by pulling the repo and running `docker compose up -d` on any Docker host, not just the one it happens to be running on today.

### 5.1 Docker setup (Strapi + export/publish)

`docker-compose.yml` defines two services with very different lifecycles — `strapi` stays up, `publisher` runs on demand and exits:

**`strapi`** — the CMS itself:
- `restart: unless-stopped`, port `1337` published, `env_file: cms/.env`, and a **bind mount** (not a named volume) for the SQLite data directory — `${PVE_STACK_ROOT}/inchmeal/cms-data:/opt/app/database` mapped to wherever `config/database.ts` points SQLite. Deliberately mounted outside the git checkout (under Komodo's `PVE_STACK_ROOT` appdata path, not a repo-relative folder like `./cms-data`) so persistent CMS state can't be wiped or orphaned by git operations on the clone (`git clean`, re-cloning, moving the checkout). A bind mount rather than a named volume is the deliberate choice here: it's what makes "spin it up wherever I need it" actually easy — the whole CMS state is one plain folder that can be rsynced/backed up/moved to a different Docker host without touching Docker's internal volume storage.
- `cms/Dockerfile`: standard Node-based Strapi image (`node:20-alpine`, install deps, `npm run build`, `npm run start`) — Claude Code should follow Strapi's own official Docker deployment guide for the exact base image and multi-stage build steps rather than improvising one.
- Strapi's security keys (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `JWT_SECRET`, `TRANSFER_TOKEN_SALT`) are generated once and stored in `cms/.env` — **not regenerated on every container rebuild**, or admin sessions/tokens break every time the image is rebuilt.
- Media still uploads straight to R2, so there's nothing else that needs persisting besides the SQLite file — no local uploads volume needed.
- Single-writer caveat: SQLite means exactly one running Strapi instance at a time. "Spin it up wherever" is a *portability* property (stop it here, copy `cms-data/`, start it there), not a "run it in two places at once" one.

**`publisher`** — the export/build-check/push pipeline, containerized per Casey's request:
- `build: ./scripts/export-content`, `profiles: ["tools"]` so it's excluded from a plain `docker compose up -d` and only runs on demand via `docker compose run --rm publisher npm run publish`.
- On the same Docker Compose network as `strapi`, so it reaches the CMS at `http://strapi:1337` (Compose's built-in service-name DNS) rather than `localhost` — no port juggling needed.
- Bind-mounts the **whole repo** to `/workspace` (so it can write into `site/src/content/` and run git against the real checkout) and runs `npm ci` at container start before `npm run publish` — simplest correct option for an occasional, human-triggered job; a `node_modules` cache volume is a fine later optimization if install time becomes annoying, not needed for v1.
- **Git push access via a fine-grained GitHub PAT, not SSH agent forwarding.** Decision, and why: agent forwarding hands the container (and anything that runs inside it, including whatever `npm ci` pulls in) the ability to use *whatever key is loaded in the host's agent* — fine today, but the concern Casey raised is real: as more containers adopt the same pattern over time, they'd all be reaching into the same shared, broad-scoped credential, so the blast radius of any one compromised container grows with every addition. A fine-grained PAT sidesteps that at the root: it's scoped to exactly one repository with **Contents: Read and write** permission and nothing else, so it authorizes precisely "push to this repo" and nothing more, however many other containers exist. It also makes `publisher` fully self-contained — no dependency on the host's SSH agent, `~/.ssh`, or `~/.gitconfig` at all, which is a better fit for "spin it up wherever": the only things this container needs are the bind-mounted repo and one small env file.
- **Storage:** `scripts/export-content/.env` (git-ignored, `.env.example` committed) holds `GITHUB_TOKEN` (the PAT) plus `GIT_COMMIT_NAME` / `GIT_COMMIT_EMAIL` for commit authorship — kept separate from `cms/.env` since it's a different credential for a different purpose.
- **Push mechanism:** the publish script pushes over HTTPS with the token supplied only on the command line for that one invocation — `git push https://x-access-token:$GITHUB_TOKEN@github.com/caseymw/inchmealindustries.com.au.git rebuild` — rather than writing the token into the checkout's `.git/config`, so it never persists on disk anywhere after the container exits. Commit identity is set explicitly per-commit (`git -c user.name="$GIT_COMMIT_NAME" -c user.email="$GIT_COMMIT_EMAIL" commit ...`) rather than relying on a mounted `.gitconfig`.
- The Dockerfile is correspondingly simpler than an SSH-based image: just Node and `git` — no `openssh-client`, no `known_hosts` handling, since there's no SSH transport involved at all.
- If the PAT is ever suspected compromised, it's a one-click revoke/regenerate in GitHub's fine-grained token settings — it doesn't touch Casey's personal SSH key or anything else that key is used for, because that key was never involved in the first place.

### 5.2 Branch strategy (reusing a live repo safely)

The repo's `main` branch is what GitHub Pages currently serves via `.github/workflows/static.yml` — pushing the new monorepo structure straight to `main` would make GitHub Pages try to publish raw Strapi/Astro source as if it were the live site. To avoid that:

- All of Phases 1–7 happen on a working branch (e.g. `rebuild`) — `main` and the current live site are untouched until cutover.
- Cloudflare Pages (Phase 5) is initially connected with **`rebuild` as its production branch**, so it builds and serves the new site at a `*.pages.dev` preview URL while work is still in progress — no interference with the live `.com.au` domain, which keeps pointing at GitHub Pages.
- At cutover (Phase 8): remove/disable `.github/workflows/static.yml` as part of the branch, merge `rebuild` → `main`, then repoint Cloudflare Pages' production branch to `main`. Only then does the DNS switch happen.
- The repo stays **public** through this whole build-out (matches how it is today, and nothing secret ever enters git). Casey will flip it to **private** once Cloudflare Pages is confirmed live and stable after cutover — a one-click GitHub setting, not something that needs to happen mid-build.

## 6. Decisions confirmed with Casey

### 6.0 Existing site inventory

Inspected `github.com/caseymw/inchmealindustries.com.au` directly:

- **Tech stack:** plain static HTML/CSS/JS (not Jekyll/Hugo — no build step at all today). 13 HTML pages, 7 CSS files, 11 JS files, 45 images, using a purchased HTML template ("avana" — visible in leftover unedited titles/footers).
- **Deploy:** already GitHub Actions → GitHub Pages (`actions/deploy-pages`), triggered on push to `main` — so the "git push → CI build" habit already exists, we're just retargeting where it deploys to.
- **Domain:** `inchmealindustries.com.au` via `CNAME` file — confirms a real custom domain is in play for the DNS cutover step (Phase 8).
- **Real content:** 6 productions (portfolio items), an About page (mission blurb + 3 team members), a Contact page (phone + email). See Section 4 for the field-level model.
- **Not real content — exclude from migration:** `works-details.html` (template's generic "Project Name" / Lorem ipsum leftover, copyright 2015) and the entire Blog section (`blog.html` / `blog-details.html` — unedited Lorem-ipsum placeholder post, "avana LLC" branding, dated 2016). Also 3 unused `works-image-*.jpg` files tied to the unused template page.

This resolves the discovery step — **Phase 0 is effectively done**; Phase 3 (Astro build) can reference this repo directly for visual/branding porting (fonts, CSS, images in `css/`, `fonts/`, `images/home-images`, `images/about-images`).

| Topic | Decision |
|---|---|
| Blog | Dropped from this migration — no real content exists to carry over; a `Post` type can be added later with zero disruption |
| Repo | Reuse the existing `caseymw/inchmealindustries.com.au` repo, restructured on a `rebuild` branch (Section 5.2); stays public through the build, flipped to private once Cloudflare Pages is confirmed live post-cutover |
| Team bios | "John Doe" etc. were confirmed template placeholders, not real. Solo operator: the About page lists one person, **Casey Moon-Watton, Chief Everything Officer** |
| Production `year` | Added to the content model (Section 4) — new field, doesn't exist on the current site |
| R2 media subdomain | `media.inchmealindustries.com.au` — confirmed, not `r2.dev` |

All open items from the initial draft are now resolved — nothing left blocking Phase 1.

## 7. Implementation plan (phased, for Claude Code)

Each phase lists what Claude Code can do autonomously vs. what needs Casey directly (mostly: clicking through account/dashboard UIs that require Casey's own login).

### Phase 0 — Discovery ✅ done — see Section 6.0
- Existing repo inspected: plain static HTML, 6 real productions + About + Contact, Blog/works-details are unused template cruft. Content model in Section 4 is already based on these findings.
- Remaining discovery-adjacent step for Claude Code: when starting Phase 3, pull the actual CSS/fonts/images (`css/`, `fonts/`, `images/home-images/`, `images/about-images/`) from `caseymw/inchmealindustries.com.au` to match the current look and feel rather than re-designing from scratch.

### Phase 1 — Repo scaffold (Claude Code) ✅ done, 2026-08-28
- In the existing repo, create and switch to a `rebuild` branch — **do not commit any of this to `main`** (see Section 5.2).
- Add the monorepo layout from Section 5 (`cms/`, `site/`, `scripts/`, `docs/`) alongside the existing static files, npm workspaces at the root. The current `index.html`, `about.html`, etc. can stay in place on this branch untouched (or be moved aside) — they only matter for reference until the branch is merged.
- `.gitignore`: `cms/.tmp`, `cms/database`, `**/node_modules`, `.env`, `site/dist`.
- Commit this document as `docs/ARCHITECTURE.md`.

### Phase 2 — Strapi setup (Claude Code, some manual steps for Casey) — ✅ done, 2026-08-28
- Scaffold Strapi in `cms/` with SQLite.
- Write `cms/Dockerfile` and the root `docker-compose.yml` per Section 5.1 — bind-mounted SQLite data dir, `env_file`, port `1337` published, `restart: unless-stopped`.
- Define the content types from Section 4 as versioned schema files under `cms/src/api/`.
- Install and configure an S3-compatible upload provider pointed at R2 (e.g. `strapi-provider-cloudflare-r2`), reading account ID / bucket / keys from env vars — never hardcoded.
- **Manual (Casey):** create the R2 bucket and API token in the Cloudflare dashboard; generate Strapi's security keys once and put them in `cms/.env` on the Docker host; run `docker compose up -d` on that host; generate a Strapi API token from the running admin UI (needs an interactive login) for the export script to use.

### Phase 3 — Astro site scaffold (Claude Code) ✅ done, 2026-08-28
- Scaffold `site/` (static output).
- Define content collections (`productions`, `pages`, `settings`) in `site/src/content/config.ts` with schemas matching the exported JSON shape.
- Build routes: production portfolio index (list, sortable by `year`/`featured`), production detail pages, About and Contact pages sourced from `SiteSettings`.
- Port over the existing site's look and feel using what Phase 0 found.
- Configure `astro.config.mjs`: final site URL, remote image patterns allowing the R2 domain.

### Phase 4 — Export script + `publisher` container (Claude Code) — ✅ done, 2026-08-28
- `scripts/export-content/`: reads `STRAPI_URL` (`http://strapi:1337` — the Compose service name, not `localhost`, since this now runs as its own container on the same Docker network) + `STRAPI_API_TOKEN` from env, fetches all published entries per content type (populated relations/media), writes each as JSON into the matching `site/src/content/<type>/<slug>.json`.
- Deletes stale files: any file whose slug is no longer present/published in Strapi gets removed, so unpublishing in Strapi actually removes it from the site.
- Prints a summary (added/changed/removed) after each run.
- Write `scripts/export-content/Dockerfile` and the `publisher` service in `docker-compose.yml` per Section 5.1: whole-repo bind mount, fine-grained-PAT-based git push, `profiles: ["tools"]` so it doesn't start with `strapi`.
- Wire root-level scripts as separate composable steps, so Casey keeps a manual review checkpoint before anything gets pushed:
  - `npm run export` — Strapi → JSON only, no git.
  - `npm run build-check` — local `astro build` as a dry-run validation.
  - `npm run push` — commits and pushes using `GITHUB_TOKEN` (Section 5.1's HTTPS token push, not written to `.git/config`).
  - `npm run publish` — convenience wrapper chaining all three for when Casey doesn't need to stop and inspect the diff first.
  - All run inside the `publisher` container via `docker compose run --rm publisher npm run <script>`; `export` and `build-check` don't need `GITHUB_TOKEN` at all, only `push` (and therefore `publish`) does.
- **Manual (Casey):** create a fine-grained GitHub PAT scoped to just the `inchmealindustries.com.au` repo, **Contents: Read and write** permission only, and put it in `scripts/export-content/.env` as `GITHUB_TOKEN`.

### Phase 5 — CI/CD wiring (manual for Casey; Claude Code writes the setup doc) — not started
- **Manual (Casey):** in the Cloudflare dashboard, create a Pages project connected directly to the GitHub repo (requires Casey's GitHub OAuth). Build command `npm run build --workspace=site`, output directory `site/dist`, **production branch set to `rebuild`** for now (see Section 5.2) — this gives a live `*.pages.dev` preview without touching the real domain.
- **Manual (Casey):** set up the R2 custom domain `media.inchmealindustries.com.au` (Section 6).
- Custom domain (`inchmealindustries.com.au`) is *not* attached to the Pages project yet — that's a Phase 8 cutover step, done only once everything's verified.
- No GitHub Actions workflow is required for deployment. (Optional, later: a lightweight Actions workflow purely for pre-merge checks like `astro check` or a link checker — not needed for MVP.)

### Phase 6 — Content migration (Casey, Claude Code assists)
- Only 6 productions + About + Contact — small enough to re-enter directly through the Strapi admin UI rather than writing a one-off import script. This also doubles as end-to-end validation that the content model actually works. The exact text/credits for each production can be lifted straight from the corresponding `*-details.html` file in the existing repo.

### Phase 7 — Verification (Claude Code + Casey)
- Add a few real items in Strapi, run `npm run export`, run `astro build` locally, check output.
- Push to `rebuild` and confirm Cloudflare Pages' automatic build on that branch deploys cleanly to its `*.pages.dev` URL.
- Check images actually load from R2, check responsive image behavior, run a basic Lighthouse/broken-link pass.

### Phase 8 — Cutover (Casey)
- Remove/disable `.github/workflows/static.yml` (the old GitHub Pages Actions deploy) on the `rebuild` branch, so it can never publish raw CMS/Astro source once merged.
- Merge `rebuild` → `main`; repoint Cloudflare Pages' production branch to `main`.
- Verify the site fully on the `*.pages.dev` URL.
- Add the custom domain to the Cloudflare Pages project and update DNS as the final step — this is what actually moves `inchmealindustries.com.au` off GitHub Pages.
- Once the new domain is confirmed working end-to-end, disable GitHub Pages in the repo's Settings (it has nothing left to serve at that point), and switch the repo to **private** per the decision in Section 6.

## 8. Ongoing publish workflow (after launch)

1. Strapi normally just stays running (`docker compose up -d`, `restart: unless-stopped`) on its Docker host — visit `http://<docker-host>:1337/admin` and edit content; images upload straight to R2. If it's ever been stopped or moved to a different host, `docker compose up -d` there brings it back using the bind-mounted data directory.
2. On that same Docker host, from the repo root: `docker compose run --rm publisher npm run export` — the `publisher` container reaches `strapi` over the Compose network and writes the latest published content into `site/src/content/` on the bind-mounted repo. This step needs no credentials at all.
3. Review the diff on the host: `git status` / `git diff` (the `publisher` container already wrote these files directly into the checked-out repo, so this is just a normal host-side git review — no container needed for this step).
4. When satisfied: `docker compose run --rm publisher npm run push` — commits and pushes using the repo-scoped `GITHUB_TOKEN` from `scripts/export-content/.env` (Section 5.1). This is the only step that touches the git credential, and it's scoped to exactly this repo. (Or skip straight from step 2 to `npm run publish`, which chains export → build-check → push in one command, once the workflow feels routine and the manual diff review stops feeling necessary.)
5. Cloudflare Pages auto-builds and deploys within a couple of minutes.
6. Nothing further to do — since Strapi is self-hosted rather than a metered cloud service, there's no cost reason to stop it. `docker compose down strapi` is only needed to relocate it to a different Docker host or reclaim resources; the `publisher` container never stays running between steps anyway (`docker compose run --rm` exits when done, taking `GITHUB_TOKEN`'s exposure window with it).

## 9. Safety notes

- All build-out work stays on the `rebuild` branch (Section 5.2); `main` — and therefore the live GitHub Pages site — is never touched until Phase 8, giving a zero-risk rollback path right up to cutover.
- Don't merge `rebuild` into `main` before disabling `.github/workflows/static.yml` on that branch — otherwise GitHub Pages will attempt to publish the raw Strapi/Astro source as if it were the site.
- Never commit `cms/.env`, `scripts/export-content/.env`, or any Strapi/R2/Cloudflare/GitHub secrets; they're supplied at runtime via env vars, documented in `.env.example` files only.
- The Strapi SQLite database is the source of truth for *authoring* (lets you edit/reorder/unpublish), but the exported JSON in git is the source of truth for *what's live*. Periodically run Strapi's own `strapi export` command (e.g. `docker compose exec strapi npm run strapi export -- -f backup`, writing into the bind-mounted data dir so the archive survives on the host) to produce a backup in case the Docker host running Strapi is lost — this is separate from the git-committed content export.
- Because the SQLite data directory is a plain bind-mounted folder (Section 5.1), it's also trivial to back up or sync independently of Strapi itself — worth including in whatever backup routine already covers that Docker host.
- `GITHUB_TOKEN` is a fine-grained PAT scoped to only the `inchmealindustries.com.au` repo with **Contents: Read and write** — nothing else (Section 5.1). No SSH keys, host `ssh-agent`, or `~/.gitconfig` are ever involved in `publisher`, by design: the container needs nothing from the host beyond the bind-mounted repo and its own `.env` file, and a compromise of it (most plausibly via a malicious transitive npm dependency during `npm ci`) is contained to "bad push to this one repo" — not to Casey's identity anywhere else. If ever suspected compromised, revoking/regenerating it in GitHub's fine-grained token settings takes effect immediately and touches nothing else.
- As a general principle for any future container that needs external credentials on this or another Docker host: prefer a narrowly-scoped credential minted for that one workload (a fine-grained PAT, a deploy key, a scoped API token) over reusing a broad, shared one like a forwarded personal `ssh-agent` — the latter's blast radius grows with every container that gets added to the pattern, the former's doesn't.
