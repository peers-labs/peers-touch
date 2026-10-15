// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static content site. Vercel serves the built `dist/` directly; no server
// runtime is needed in v1. i18n uses Astro's built-in locale routing.
export default defineConfig({
  site: 'https://peers-touch.vercel.app',
  output: 'static',
  integrations: [react()],
  i18n: {
    locales: ['en', 'zh'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
});
