/**
 * Обложки публикаций.
 *
 * Читает data/press-audit.json (его делает press-audit.mjs), качает og:image
 * каждой живой публикации и приводит к одному виду: 3:2, 640px, webp.
 * Результат — public/press/<slug>.webp, имя проставляется обратно в JSON.
 *
 * Картинку кладём к себе, а не тянем с чужого сервера ссылкой: иначе часть
 * изданий отдаст 403 по referer, а остальные будут грузиться в час по чайной
 * ложке и мигать при скролле.
 *
 * sharp приходит вместе с Astro, ставить ничего не нужно.
 *
 * Запуск:  node scripts/press-covers.mjs
 *          node scripts/press-covers.mjs --force   ← перекачать уже готовые
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUDIT = path.join(ROOT, 'data/press-audit.json');
const DST = path.join(ROOT, 'public/press');

const FORCE = process.argv.includes('--force');
const CONCURRENCY = 4;
const WIDTH = 640;
const HEIGHT = 427; // 3:2 — те же пропорции, что у врезок в секциях
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const translit = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };

function slugify(s, i) {
  const base = [...s.toLowerCase()]
    .map((c) => translit[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${String(i + 1).padStart(2, '0')}-${base || 'cover'}`;
}

async function cover(item, i) {
  if (!item.alive || !item.image) return { ...item, cover: null };
  const slug = slugify(`${item.outlet} ${item.title ?? item.note}`, i);
  const rel = `press/${slug}.webp`;
  const file = path.join(DST, `${slug}.webp`);

  if (!FORCE) {
    try {
      await fs.access(file);
      return { ...item, cover: rel, slug };
    } catch {}
  }

  try {
    const res = await fetch(item.image, {
      signal: AbortSignal.timeout(30000),
      // Часть изданий отдаёт картинку только со «своим» реферером.
      headers: { 'user-agent': UA, referer: item.url },
    });
    if (!res.ok) return { ...item, cover: null, coverError: `HTTP ${res.status}`, slug };

    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    // Заглушки-логотипы изданий в карточке смотрятся хуже, чем их отсутствие.
    if ((meta.width ?? 0) < 320 || (meta.height ?? 0) < 200) {
      return { ...item, cover: null, coverError: `мелкая: ${meta.width}×${meta.height}`, slug };
    }

    await sharp(buf)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toFile(file);

    return { ...item, cover: rel, slug, coverSize: `${meta.width}×${meta.height}` };
  } catch (err) {
    return { ...item, cover: null, coverError: String(err.message ?? err), slug };
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
        process.stdout.write(`\r  ${++done}/${items.length}   `);
      }
    })
  );
  return out;
}

await fs.mkdir(DST, { recursive: true });
const items = JSON.parse(await fs.readFile(AUDIT, 'utf8'));
console.log(`Публикаций: ${items.length}, из них с og:image: ${items.filter((x) => x.image).length}`);

const result = await pool(items, CONCURRENCY, cover);
await fs.writeFile(AUDIT, JSON.stringify(result, null, 2));

const ok = result.filter((r) => r.cover);
const failed = result.filter((r) => r.image && !r.cover);
console.log(`\n
Обложек готово:   ${ok.length}
Не получилось:    ${failed.length}
Без og:image:     ${result.filter((r) => r.alive && !r.image).length}
`);
for (const f of failed) console.log(`  ${f.outlet} — ${f.coverError}\n      ${f.url}`);
console.log(`\nКартинки: public/press/  ·  пути проставлены в data/press-audit.json`);
