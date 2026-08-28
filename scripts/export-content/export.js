import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, '../../site/src/content');

const STRAPI_URL = process.env.STRAPI_URL || 'http://strapi:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

if (!STRAPI_API_TOKEN) {
  console.error('STRAPI_API_TOKEN is required.');
  process.exit(1);
}

async function strapiFetch(endpoint) {
  const res = await fetch(`${STRAPI_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Strapi request failed: ${endpoint} -> ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.data;
}

// Strapi returns relative media URLs unless a public-access CDN URL
// (cloudflarePublicAccessUrl) is configured on the upload provider.
function resolveMediaUrl(url) {
  if (!url) return url;
  return url.startsWith('http') ? url : `${STRAPI_URL}${url}`;
}

function mapProduction(entry) {
  return {
    title: entry.title,
    slug: entry.slug,
    tagline: entry.tagline ?? null,
    synopsis: entry.synopsis ?? null,
    credits: (entry.credits ?? []).map((c) => ({ role: c.role, name: c.name })),
    ourRole: entry.ourRole ?? null,
    images: (entry.images ?? []).map((img) => resolveMediaUrl(img.url)),
    year: entry.year ?? null,
    featured: Boolean(entry.featured),
    sortOrder: entry.sortOrder ?? 0,
  };
}

function mapPage(entry) {
  return {
    title: entry.title,
    slug: entry.slug,
    body: entry.body ?? null,
  };
}

function mapSiteSettings(entry) {
  return {
    tagline: entry.tagline ?? null,
    missionBlurb: entry.missionBlurb ?? null,
    teamMembers: (entry.teamMembers ?? []).map((m) => ({ name: m.name, role: m.role })),
    phone: entry.phone ?? null,
    email: entry.email ?? null,
    socialLinks: (entry.socialLinks ?? []).map((s) => ({ platform: s.platform, url: s.url })),
    footerText: entry.footerText ?? null,
  };
}

async function syncCollection(name, endpoint, mapEntry) {
  const dir = path.join(CONTENT_DIR, name);
  await mkdir(dir, { recursive: true });

  const entries = await strapiFetch(`/api/${endpoint}?populate=*`);
  const seenSlugs = new Set();
  const summary = { added: 0, changed: 0, removed: 0, unchanged: 0 };

  for (const entry of entries) {
    const slug = entry.slug;
    seenSlugs.add(slug);
    const filePath = path.join(dir, `${slug}.json`);
    const nextContent = `${JSON.stringify(mapEntry(entry), null, 2)}\n`;

    let prevContent = null;
    try {
      prevContent = await readFile(filePath, 'utf8');
    } catch {
      // file doesn't exist yet - treated as "added" below
    }

    if (prevContent === null) summary.added++;
    else if (prevContent !== nextContent) summary.changed++;
    else summary.unchanged++;

    await writeFile(filePath, nextContent, 'utf8');
  }

  const existingFiles = await readdir(dir).catch(() => []);
  for (const file of existingFiles) {
    const slug = file.replace(/\.json$/, '');
    if (!seenSlugs.has(slug)) {
      await rm(path.join(dir, file));
      summary.removed++;
    }
  }

  console.log(
    `  ${name}: +${summary.added} ~${summary.changed} -${summary.removed} (${summary.unchanged} unchanged)`
  );
}

async function syncSingleType(name, endpoint, mapEntry) {
  const dir = path.join(CONTENT_DIR, name);
  await mkdir(dir, { recursive: true });
  const entry = await strapiFetch(`/api/${endpoint}?populate=*`);
  await writeFile(
    path.join(dir, 'site.json'),
    `${JSON.stringify(mapEntry(entry), null, 2)}\n`,
    'utf8'
  );
  console.log(`  ${name}: updated`);
}

console.log(`Exporting published content from ${STRAPI_URL} ...`);
await syncCollection('productions', 'productions', mapProduction);
await syncCollection('pages', 'pages', mapPage);
await syncSingleType('settings', 'site-setting', mapSiteSettings);
console.log('Export complete.');
