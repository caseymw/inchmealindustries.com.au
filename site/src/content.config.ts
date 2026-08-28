import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const productions = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/productions' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    tagline: z.string().nullable(),
    showUrl: z.string().nullable(),
    synopsis: z.string().nullable(),
    credits: z.array(z.object({ role: z.string(), name: z.string(), url: z.string().nullable() })),
    ourRole: z.string().nullable(),
    images: z.array(z.string()),
    year: z.number().nullable(),
    featured: z.boolean(),
    sortOrder: z.number(),
  }),
});

// Kept available for a future freeform page (docs/ARCHITECTURE.md Section 4);
// not populated during the initial migration.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    body: z.string().nullable(),
  }),
});

// Single-entry collection (one "site" item) sourced from Strapi's
// SiteSettings single type - covers About + Contact + footer.
const settings = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/settings' }),
  schema: z.object({
    tagline: z.string().nullable(),
    missionBlurb: z.string().nullable(),
    teamMembers: z.array(z.object({ name: z.string(), role: z.string() })),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    socialLinks: z.array(z.object({ platform: z.string(), url: z.string() })),
    footerText: z.string().nullable(),
  }),
});

export const collections = { productions, pages, settings };
