/**
 * Импорт постов телеграм-канала в блог сайта.
 *
 * Источник — выгрузка Telegram Desktop (Экспорт истории чата → формат JSON):
 * папка с result.json и подпапками photos/, video_files/ и т. д.
 * Папку целиком кладём в telegram-src/ (в git не попадает, см. .gitignore).
 *
 * Запуск:  node scripts/import-telegram.mjs [путь-к-папке-выгрузки] [--min-chars=180]
 *          по умолчанию папка telegram-src/
 * Результат:
 *   src/data/telegram-posts.json  — данные постов для страниц /blog/ (в git)
 *   public/photos/tg/             — фото постов, пережатые в webp ≤1200px (в git)
 *
 * ЧТО БЕРЁМ, А ЧТО НЕТ (правила согласованы с заказчиком):
 * - только информационные посты: текст короче --min-chars знаков не берём
 *   (анонсы-однострочники, «с праздником», подводки к опросам);
 * - опросы и сервисные сообщения не берём;
 * - посты, где главное медиа — видео/кружок/гифка, НЕ берём целиком
 *   (видео на сайт не тянем);
 * - фото-альбом (карусель) собирается обратно: в выгрузке это несколько
 *   сообщений подряд без текста — они приклеиваются к первому, у которого
 *   текст есть. Видео-участник альбома просто выбрасывается, пост остаётся;
 * - жирный/курсив из телеграма намеренно теряются: на сайте одно начертание,
 *   акцентов «как в телеге» в наборном тексте не бывает. Ссылки сохраняются.
 *
 * Скрипт идемпотентен: папку public/photos/tg/ чистит и наполняет заново.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('='))
);
const SRC = path.resolve(ROOT, args.find((a) => !a.startsWith('--')) ?? 'telegram-src');
const MIN_CHARS = Number(flags['min-chars'] ?? 180);
/** Участники альбома идут в выгрузке подряд; страховочный зазор по времени. */
const ALBUM_GAP_S = 120;

const OUT_JSON = path.join(ROOT, 'src/data/telegram-posts.json');
const OUT_PHOTOS = path.join(ROOT, 'public/photos/tg');
const PHOTO_MAX_W = 1200;

// ---------- чтение выгрузки ----------

const resultJson = path.join(SRC, 'result.json');
if (!fs.existsSync(resultJson)) {
  console.error(
    `Не найден ${path.relative(ROOT, resultJson)}.\n` +
      'Положите выгрузку Telegram Desktop (папку с result.json и photos/) в telegram-src/\n' +
      'или передайте путь к ней первым аргументом.'
  );
  process.exit(1);
}
const dump = JSON.parse(fs.readFileSync(resultJson, 'utf-8'));
const channelName = dump.name ?? 'Телеграм-канал';
// Публичной ссылки в выгрузке нет — держим известный адрес канала здесь.
const CHANNEL_URL = 'https://t.me/krasotanasspaset';

// ---------- разбор текста ----------

const esc = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** text из выгрузки: строка или массив из строк и {type, text, href}. */
const textParts = (t) => (Array.isArray(t) ? t : t ? [t] : []);

const plainText = (t) =>
  textParts(t)
    .map((p) => (typeof p === 'string' ? p : p.text ?? ''))
    .join('');

/** Части → HTML. Стили телеграма (bold/italic/underline) сознательно в плоский
 *  текст; ссылки — в <a>; хэштеги выбрасываем (на сайте рубрик пока нет). */
const partsToHtml = (t) =>
  textParts(t)
    .map((p) => {
      if (typeof p === 'string') return esc(p);
      const txt = esc(p.text ?? '');
      switch (p.type) {
        case 'text_link':
          return `<a href="${esc(p.href ?? '#')}" target="_blank" rel="noopener">${txt}</a>`;
        case 'link':
          return `<a href="${esc(p.text)}" target="_blank" rel="noopener">${txt}</a>`;
        case 'hashtag':
          return '';
        default:
          return txt;
      }
    })
    .join('');

/** HTML одним куском → абзацы. Двойной перенос — граница <p>, одинарный — <br>. */
const toParagraphs = (html) =>
  html
    .split(/\n{2,}/)
    .map((p) => p.trim().replace(/\n/g, '<br />'))
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
    .join('\n');

/** Эмодзи и декор по краям строки (для заголовков и слагов). */
const stripEmoji = (s) =>
  s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s\-–—•:.,!]+|[\s\-–—•:]+$/g, '');

/** Заголовок поста: первая непустая строка без эмодзи, обрезанная по слову. */
function makeTitle(plain) {
  const line = plain
    .split('\n')
    .map((l) => stripEmoji(l))
    .find((l) => l.length > 2);
  if (!line) return null;
  if (line.length <= 90) return line.replace(/[.]+$/, '');
  const cut = line.slice(0, 90);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[.,:;!?]+$/, '') + '…';
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
};
const slugify = (title, id) => {
  const base = title
    .toLowerCase()
    .split('')
    .map((c) => TRANSLIT[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .reduce((acc, w) => (acc.length + w.length + 1 <= 48 ? (acc ? `${acc}-${w}` : w) : acc), '');
  return `${base || 'post'}-${id}`;
};

// ---------- фильтры ----------

const VIDEO_TYPES = new Set(['video_file', 'video_message', 'animation']);
const isVideo = (m) =>
  VIDEO_TYPES.has(m.media_type) || (m.file && /\.(mp4|mov|webm|gif)$/i.test(m.file_name ?? m.file ?? ''));
const isPoll = (m) => Boolean(m.poll) || m.media_type === 'poll';
/** Участник альбома: своё медиа есть, своего текста нет. */
const isAlbumTail = (m) => (m.photo || m.file) && plainText(m.text).trim() === '';

// ---------- проход по сообщениям ----------

const kept = [];
const skipped = { service: 0, poll: 0, video: 0, short: 0, empty: 0, albumTail: 0 };
/** Последний корневой пост (для приклейки альбомных хвостов); null = корень пропущен. */
let lastRoot = null;
let lastRootDate = 0;

for (const m of dump.messages ?? []) {
  if (m.type !== 'message') {
    skipped.service++;
    continue;
  }
  const date = Number(m.date_unixtime ?? Date.parse(m.date) / 1000);

  // Хвост альбома клеим к предыдущему посту (если тот взят и рядом по времени)
  if (isAlbumTail(m) && date - lastRootDate <= ALBUM_GAP_S) {
    if (lastRoot) {
      if (m.photo) lastRoot.srcPhotos.push(m.photo);
      else skipped.video++; // видео-участник карусели выбрасываем, пост живёт
    } else {
      skipped.albumTail++;
    }
    lastRootDate = date;
    continue;
  }

  lastRoot = null;
  lastRootDate = date;

  if (isPoll(m)) {
    skipped.poll++;
    continue;
  }
  if (isVideo(m)) {
    skipped.video++; // главное медиа — видео: пост не берём целиком
    continue;
  }

  const plain = plainText(m.text).trim();
  if (!plain) {
    skipped.empty++;
    continue;
  }
  if (plain.length < MIN_CHARS) {
    skipped.short++;
    continue;
  }
  const title = makeTitle(plain);
  if (!title) {
    skipped.empty++;
    continue;
  }

  // Тело — без строки заголовка (она уходит в <h1>), чтобы не дублировалась.
  const paras = toParagraphs(partsToHtml(m.text));
  const firstPara = paras.match(/^<p>(.*?)<\/p>/s)?.[1] ?? '';
  const firstIsTitle = stripEmoji(firstPara.replace(/<[^>]+>/g, '')).startsWith(title.replace(/…$/, ''));
  const html = firstIsTitle ? paras.replace(/^<p>.*?<\/p>\n?/s, '') : paras;

  const excerptSrc = stripEmoji((html || paras).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const excerpt = excerptSrc.length > 150 ? excerptSrc.slice(0, 150).replace(/\s\S*$/, '') + '…' : excerptSrc;

  lastRoot = {
    id: m.id,
    slug: slugify(title, m.id),
    date: (m.date ?? '').slice(0, 10),
    title,
    excerpt,
    html,
    srcPhotos: m.photo ? [m.photo] : [],
    tgUrl: `${CHANNEL_URL}/${m.id}`,
  };
  kept.push(lastRoot);
}

// ---------- фото: пережать в webp и разложить ----------

let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('sharp не найден — фото копируются как есть, без пережатия');
}

fs.rmSync(OUT_PHOTOS, { recursive: true, force: true });
fs.mkdirSync(OUT_PHOTOS, { recursive: true });

for (const post of kept) {
  post.photos = [];
  for (const [i, rel] of post.srcPhotos.entries()) {
    const src = path.join(SRC, rel);
    if (!fs.existsSync(src)) {
      console.warn(`  ! нет файла ${rel} (пост ${post.id})`);
      continue;
    }
    const n = String(i + 1).padStart(2, '0');
    if (sharp) {
      const out = `${post.id}-${n}.webp`;
      const img = sharp(src).rotate().resize({ width: PHOTO_MAX_W, withoutEnlargement: true });
      const info = await img.webp({ quality: 82 }).toFile(path.join(OUT_PHOTOS, out));
      post.photos.push({ src: `/photos/tg/${out}`, w: info.width, h: info.height });
    } else {
      const out = `${post.id}-${n}${path.extname(src)}`;
      fs.copyFileSync(src, path.join(OUT_PHOTOS, out));
      post.photos.push({ src: `/photos/tg/${out}`, w: null, h: null });
    }
  }
  delete post.srcPhotos;
}

// Свежие сверху
kept.sort((a, b) => (a.date < b.date ? 1 : -1));

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(
  OUT_JSON,
  JSON.stringify(
    { channel: { name: channelName, url: CHANNEL_URL }, placeholder: false, posts: kept },
    null,
    2
  )
);

const photosTotal = kept.reduce((s, p) => s + p.photos.length, 0);
console.log(`Канал: ${channelName}`);
console.log(`Взято постов: ${kept.length} (фото: ${photosTotal})`);
console.log(
  `Пропущено: сервисных ${skipped.service}, опросов ${skipped.poll}, с видео ${skipped.video}, ` +
    `коротких (<${MIN_CHARS}) ${skipped.short}, без текста ${skipped.empty}, хвостов альбомов ${skipped.albumTail}`
);
console.log(`→ ${path.relative(ROOT, OUT_JSON)}, ${path.relative(ROOT, OUT_PHOTOS)}/`);
