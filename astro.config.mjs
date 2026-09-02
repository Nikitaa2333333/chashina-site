import { readFileSync } from 'node:fs';

import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

// Даты постов блога для lastmod карты сайта. Читаем файлом, а не import:
// конфиг грузится до сборки, и лишняя зависимость от JSON-модулей тут ни к чему.
const posts = JSON.parse(readFileSync('./src/data/telegram-posts.json', 'utf8')).posts;
const postDate = new Map(posts.map((p) => [`/blog/${p.slug}/`, p.date]));

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
      serialize: (item) => {
        const path = new URL(item.url).pathname;
        const date = postDate.get(path);

        // Пост телеграм-канала: дата публикации и есть дата изменения —
        // текст поста потом не правится. Общий lastmod по времени сборки
        // говорил бы, что все 400 страниц обновляются на каждый деплой,
        // и поисковик перестаёт доверять этому полю целиком.
        if (date) {
          return { ...item, lastmod: new Date(date).toISOString(), changefreq: 'yearly', priority: 0.6 };
        }
        // Главная и разделы живут и правятся — им время сборки как раз честно.
        const home = path === '/';
        return {
          ...item,
          lastmod: new Date().toISOString(),
          changefreq: 'weekly',
          priority: home ? 1.0 : 0.8,
        };
      },
    }),
  ],
});
