import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Боевой адрес. Нужен не только карте сайта: из него собираются
  // canonical и og:url в Base.astro. Меняется вместе с доменом.
  site: 'https://chashchina.com',

  server: {
    host: '127.0.0.1',
    port: 4331,
  },

  integrations: [
    sitemap({
      // Постранички списка блога (/blog/2/, /blog/3/ …) в карту не идут:
      // это навигация, поисковику нужны сами посты, а не витрины по 24 штуки.
      filter: (page) => !/\/blog\/\d+\/$/.test(page),
      changefreq: 'weekly',
      lastmod: new Date(),
    }),
  ],
});
