/**
 * Аудит публикаций в СМИ.
 *
 * Читает data/press-raw.tsv (описание \t ссылка), обходит каждую ссылку и
 * складывает в data/press-audit.json: жива ли она, настоящий заголовок,
 * дату, обложку и абзацы, где встречается фамилия Оксаны — это её прямая
 * речь, из неё и берём цитату для карточки.
 *
 * Модель здесь не участвует: только fetch и разбор <head>. Токенов ноль.
 *
 * Запуск:  node scripts/press-audit.mjs
 *          node scripts/press-audit.mjs --force   ← перечитать даже то, что в кэше
 *
 * HTML каждой страницы кладётся в .cache/press/ и повторно не качается,
 * так что второй прогон почти мгновенный.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data/press-raw.tsv');
const OUT = path.join(ROOT, 'data/press-audit.json');
const CACHE = path.join(ROOT, '.cache/press');

const FORCE = process.argv.includes('--force');
const CONCURRENCY = 4;
const TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Домен → как издание называется на сайте. Пополняется руками.
const OUTLETS = {
  'rbc.ru': 'РБК',
  'tass.ru': 'ТАСС',
  'gazeta.ru': 'Газета.ру',
  'aif.ru': 'Аргументы и факты',
  'ntv.ru': 'НТВ',
  'radiorus.ru': 'Радио России',
  'vk.com': 'ВКонтакте',
  'youtu.be': 'YouTube',
  'buro247.ru': 'Buro 24/7',
  'bazaar.ru': 'Harper’s Bazaar',
  'marieclaire.ru': 'Marie Claire',
  'grazia.ru': 'Grazia',
  'cosmo.ru': 'Cosmopolitan',
  'wonderzine.com': 'Wonderzine',
  'theblueprint.ru': 'The Blueprint',
  'the-challenger.ru': 'The Challenger',
  'umagazine.ru': 'U Magazine',
  'beautyinsider.ru': 'Beauty Insider',
  'beautyhack.ru': 'Beautyhack',
  'saltmag.ru': 'Salt',
  'somanyhorses.ru': 'So Many Horses',
  'flacon-magazine.com': 'Flacon',
  'focusmoda.ru': 'Focus Moda',
  'reya.media': 'Reya',
  'wday.ru': 'Woman’s Day',
  'zdr.ru': 'Здоровье',
  'perito-burrito.com': 'Perito Burrito',
  'life-ru.turbopages.org': 'Life',
  'ru.marus.care': 'Marus',
  'nbcdevelopment.ru': 'NBC Development',
};

// Тип материала — влияет на подпись в карточке.
function kindOf(host, url) {
  if (host === 'ntv.ru' || host === 'youtu.be' || url.includes('/video/')) return 'видео';
  if (host === 'radiorus.ru') return 'радио';
  if (host === 'vk.com') return 'соцсети';
  return 'статья';
}

const host = (u) => new URL(u).hostname.replace(/^(www|m)\./, '');

// utm-хвосты и fbclid только мешают сверять дубли.
function cleanUrl(u) {
  const url = new URL(u);
  for (const k of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|yclid|gclid|_openstat)/i.test(k)) url.searchParams.delete(k);
  }
  return url.toString();
}

const pick = (html, ...res) => {
  for (const re of res) {
    const m = html.match(re);
    if (m?.[1]) return decode(m[1].trim());
  }
  return null;
};

function decode(s) {
  return s
    .replace(/&(?:quot|#34);/g, '"').replace(/&(?:apos|#39);/g, "'")
    .replace(/&(?:amp|#38);/g, '&').replace(/&(?:lt|#60);/g, '<')
    .replace(/&(?:gt|#62);/g, '>').replace(/&(?:nbsp|#160);/g, ' ')
    .replace(/&(?:laquo|#171);/g, '«').replace(/&(?:raquo|#187);/g, '»')
    .replace(/&(?:mdash|#8212);/g, '—').replace(/&(?:ndash|#8211);/g, '–')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/\s+/g, ' ').trim();
}

const meta = (prop) =>
  new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i');
const metaRev = (prop) =>
  new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');

// Абзацы, где Оксану называют по фамилии, — это её реплики.
// Из них и берётся цитата для карточки: чужой текст не копируем,
// цитируем именно её слова со ссылкой на источник.
function quotes(html) {
  const out = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decode(m[1].replace(/<[^>]+>/g, ' '));
    if (text.length < 80 || text.length > 900) continue;
    if (/Чащин/i.test(text)) out.push(text);
  }
  return out.slice(0, 4);
}

async function grab(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const file = path.join(CACHE, `${key}.html`);
  if (!FORCE) {
    try {
      const cached = await fs.readFile(file, 'utf8');
      return { html: cached, status: 200, finalUrl: url, fromCache: true };
    } catch {}
  }
  const ctl = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    redirect: 'follow',
    signal: ctl,
    headers: { 'user-agent': UA, 'accept-language': 'ru-RU,ru;q=0.9' },
  });
  const html = await res.text();
  if (res.ok) await fs.writeFile(file, html);
  return { html, status: res.status, finalUrl: res.url, fromCache: false };
}

async function inspect(entry) {
  const { note, url } = entry;
  const h = host(url);
  const base = {
    note,
    url: cleanUrl(url),
    outlet: OUTLETS[h] ?? h,
    kind: kindOf(h, url),
  };
  try {
    const { html, status, finalUrl, fromCache } = await grab(url);
    if (status >= 400) return { ...base, alive: false, status };
    const title =
      pick(html, meta('og:title'), metaRev('og:title'), /<title[^>]*>([\s\S]*?)<\/title>/i);
    const published =
      pick(html, meta('article:published_time'), metaRev('article:published_time'),
           meta('publish-date'), /<time[^>]+datetime=["']([^"']+)["']/i);
    return {
      ...base,
      alive: true,
      status,
      fromCache,
      redirected: finalUrl !== url ? finalUrl : null,
      title,
      description: pick(html, meta('og:description'), metaRev('og:description'), meta('description')),
      image: pick(html, meta('og:image'), metaRev('og:image')),
      published,
      year: published?.slice(0, 4) ?? (url.match(/\/(20\d{2})\//)?.[1] ?? null),
      quotes: quotes(html),
    };
  } catch (err) {
    return { ...base, alive: false, error: String(err.message ?? err) };
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
        process.stdout.write(`\r  ${out.filter(Boolean).length}/${items.length}   `);
      }
    })
  );
  return out;
}

const raw = await fs.readFile(RAW, 'utf8');
const entries = raw
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [note, url] = l.split('\t');
    return { note: note.trim(), url: url.trim() };
  });

// Дубли по адресу: в исходном документе часть тем повторяется.
const seen = new Set();
const unique = entries.filter((e) => {
  const k = cleanUrl(e.url);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

await fs.mkdir(CACHE, { recursive: true });
console.log(`Записей: ${entries.length}, после вычистки дублей: ${unique.length}`);

const results = await pool(unique, CONCURRENCY, inspect);
await fs.writeFile(OUT, JSON.stringify(results, null, 2));

const alive = results.filter((r) => r.alive);
const dead = results.filter((r) => !r.alive);
const withQuote = alive.filter((r) => r.quotes?.length);
const withImage = alive.filter((r) => r.image);
const withYear = alive.filter((r) => r.year);

console.log(`\n
Открылось:            ${alive.length} из ${results.length}
Не открылось:         ${dead.length}
С прямой речью:       ${withQuote.length}
С обложкой:           ${withImage.length}
С датой:              ${withYear.length}
`);

if (dead.length) {
  console.log('Не открылись:');
  for (const d of dead) console.log(`  [${d.status ?? 'сеть'}] ${d.outlet} — ${d.url}\n      ${d.error ?? ''}`);
}

const byOutlet = {};
for (const r of alive) byOutlet[r.outlet] = (byOutlet[r.outlet] ?? 0) + 1;
console.log('\nПо изданиям:');
for (const [o, n] of Object.entries(byOutlet).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${o}`);
}
console.log(`\nПодробности: ${path.relative(ROOT, OUT)}`);
