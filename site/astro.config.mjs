// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://inchmealindustries.com.au',
  image: {
    remotePatterns: [{ protocol: 'https', hostname: 'media.inchmealindustries.com.au' }],
  },
});
