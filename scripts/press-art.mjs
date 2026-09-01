/**
 * Раскладка своих иллюстраций для карточек «Публикации».
 *
 * Берёт PNG-выход конвейера генерации (image-styler, папка output/chashina),
 * жмёт в webp и кладёт в public/press/art/<slug>.webp. Имя файла = slug из
 * data/press-art.tsv, по нему scripts/press-build.mjs подменяет обложку
 * издания на нашу картинку.
 *
 * Запуск:  node scripts/press-art.mjs [--src <папка с png>]
 * По умолчанию источник — ../../test/image-styler/output/chashina рядом с репозиторием.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAP = path.join(ROOT, 'data/press-art.tsv');
const OUT = path.join(ROOT, 'public/press/art');
const WIDTH = 1000; // карточка ≤640 CSS-px, запас на ретину

const argSrc = process.argv.indexOf('--src');
const SRC =
  argSrc > -1
    ? path.resolve(process.argv[argSrc + 1])
    : 'C:/Users/User/Downloads/test/image-styler/output/chashina';

const sharp = (await import('sharp')).default;

const slugs = (await fs.readFile(MAP, 'utf8'))
  .split('\n')
  .map((l) => l.split('\t')[0]?.trim())
  .filter(Boolean);

await fs.mkdir(OUT, { recursive: true });

let done = 0;
const missing = [];
for (const slug of slugs) {
  const src = path.join(SRC, `${slug}.png`);
  try {
    await fs.access(src);
  } catch {
    missing.push(slug);
    continue;
  }
  const info = await sharp(src)
    .resize({ width: WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(OUT, `${slug}.webp`));
  done += 1;
  console.log(`${slug}.webp  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)} КБ`);
}

console.log(`\nРазложено: ${done} из ${slugs.length}`);
if (missing.length) console.log(`Нет генерации: ${missing.join(', ')}`);
console.log('Дальше: node scripts/press-build.mjs');
