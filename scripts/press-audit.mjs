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
const BRIEF = path.join(ROOT, 'data/press-brief.tsv');
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

// Мнемоники, которые реально встречаются в текстах изданий. Кавычки-лапки
// &bdquo;…&ldquo; приезжали неразобранными и торчали в цитате прямо в вёрстке.
const ENTITIES = {
  quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ', shy: '',
  laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  mdash: '—', ndash: '–', minus: '−', hellip: '…', middot: '·', bull: '•',
  deg: '°', times: '×', ensp: ' ', emsp: ' ', thinsp: ' ', numero: '№',
};

function decode(s) {
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => {
      const key = name.toLowerCase();
      return key in ENTITIES ? ENTITIES[key] : m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?»])/g, '$1')
    .trim();
}

const meta = (prop) =>
  new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, 'i');
const metaRev = (prop) =>
  new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');

// Заголовок со страницы годится не всегда. U Magazine, Газета.ру и
// Радио России отдают в og:title название сайта или вовсе «Document»:
// страница собирается скриптом, а в исходном HTML заголовка ещё нет.
// Такие отбраковываем и берём описание из документа — оно человечнее.
const TITLE_JUNK = /^(document|untitled|главная|home|\s*)$/i;

function titleLooksBroken(title, outlet) {
  if (!title) return true;
  if (TITLE_JUNK.test(title.trim())) return true;
  if (title.includes('\uFFFD')) return true;
  // «U MAGAZINE — мода, красота, культура» — это название издания, не статьи.
  const bare = title.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  const out = outlet.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  if (out && bare.startsWith(out) && title.length < 60) return true;
  return false;
}

// Хвосты вида «… | Salt», «… - ZDR», «… / Передачи НТВ», «…. BEAUTYHACK».
function stripOutletTail(title, outlet, domain = '') {
  if (!title) return title;
  const key = outlet.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  // Издание в заголовке нередко зовётся доменом, а не своим названием.
  const dom = domain.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  let out = title;
  for (let i = 0; i < 3; i++) {
    const m = /^(.*?)[\s]*[|\u2013\u2014\-\/]\s*([^|\u2013\u2014\-\/]{2,40})$/.exec(out);
    if (!m) break;
    const tail = m[2].toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
    const isOutlet =
      (key && (tail.includes(key) || key.includes(tail))) ||
      (dom && dom.length > 2 && (tail === dom || tail.includes(dom)));
    if (!isOutlet && !/передач|выпуск/i.test(m[2])) break;
    out = m[1].trim();
  }
  // «Wellness-манифест 2026: точность… . BEAUTYHACK»
  const dot = new RegExp(`[.\\s]+${outlet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  out = out.replace(dot, '').trim();
  return out || title;
}

// Абзацы с фамилией Оксаны бывают двух сортов, и путать их нельзя.
// Одни — её прямая речь: «…», или «Оксана Чащина: …». Такие и нужны.
// Другие — текст редакции о ней: «Мы обратились к врачу-косметологу…».
// Это слова журналиста, в раздел они не годятся — там мы цитируем её.
const EDITORIAL = /^(мы |наша редакция|в новом выпуске|разбираемся|вместе с|редакция )/i;

function scoreQuote(text) {
  let score = 0;
  if (/[«"„][^»"“]{40,}[»"“]/.test(text)) score += 3;      // есть закавыченная речь
  if (/Чащина\s*[:\u2014\u2013-]/.test(text)) score += 3;      // «Чащина: …» — прямая реплика
  if (/(рассказал|поясня|объясня|уверен|отмеча|добавля|соглас)\w*[^.]{0,60}Чащин/i.test(text)) score += 2;
  if (/Чащин\w*[^.]{0,60}(рассказал|поясня|объясня|уверен|отмеча|добавля)/i.test(text)) score += 2;
  if (EDITORIAL.test(text.trim())) score -= 5;              // это говорит редакция, не она
  if (/[:\u2014\u2013-]$/.test(text.trim())) score -= 4;         // «Отвечает Оксана Чащина:» — подводка
  if (/^[^.!?]{0,120}$/.test(text) && !/[«"]/.test(text)) score -= 1; // огрызок без речи
  if (text.length > 160) score += 1;
  return score;
}

// Режем по границе предложения, а не по счётчику символов: обрубок
// на полуслове в карточке выглядит как недосмотр.
function trimQuote(text, limit = 260) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (stop > 90) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(' ');
  return (space > 90 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '') + '…';
}

function quotes(html) {
  const seen = new Set();
  const found = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decode(m[1].replace(/<[^>]+>/g, ' '));
    if (text.length < 80 || text.length > 900) continue;
    if (!/Чащин/i.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    found.push({ text, score: scoreQuote(text) });
  }
  return found
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((q) => ({ text: trimQuote(q.text), score: q.score, direct: q.score >= 3 }));
}

// Кодировка: часть площадок (ВКонтакте) отдаёт windows-1251, и если
// читать их как UTF-8, заголовок превращается в ромбики с вопросами.
function decodeBody(buf, contentType) {
  const head = buf.subarray(0, 4096).toString('latin1');
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    'utf-8';
  const label = charset.toLowerCase().replace('cp1251', 'windows-1251');
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

async function grab(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const file = path.join(CACHE, `${key}.html`);
  if (!FORCE) {
    try {
      const buf = await fs.readFile(file);
      const html = buf.toString('utf8');
      // Ромбик-заменитель в кэше означает, что страницу сохранили
      // с испорченной кодировкой ещё в старой версии скрипта. Качаем заново.
      if (!html.includes('\uFFFD')) return { html, status: 200, finalUrl: url, fromCache: true };
    } catch {}
  }
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA, 'accept-language': 'ru-RU,ru;q=0.9' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const html = decodeBody(buf, res.headers.get('content-type'));
  if (res.ok) await fs.writeFile(file, html, 'utf8');
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
    const rawTitle =
      pick(html, meta('og:title'), metaRev('og:title'), /<title[^>]*>([\s\S]*?)<\/title>/i);
    const broken = titleLooksBroken(rawTitle, base.outlet);
    const title = broken ? note : stripOutletTail(rawTitle, base.outlet, h);
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
      titleFrom: broken ? 'документ' : 'страница',
      rawTitle,
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

// Обложки проставляет press-covers.mjs, дописывая их в этот же файл.
// Перезапись результата затирала их — переносим из прошлого прогона.
try {
  const prev = JSON.parse(await fs.readFile(OUT, 'utf8'));
  const byUrl = new Map(prev.map((r) => [r.url, r]));
  for (const r of results) {
    const old = byUrl.get(r.url);
    if (!old) continue;
    for (const k of ['cover', 'slug', 'coverError', 'coverSize']) {
      if (old[k] !== undefined && r[k] === undefined) r[k] = old[k];
    }
  }
} catch {}

await fs.writeFile(OUT, JSON.stringify(results, null, 2));

// Короткая выжимка — её и отдают Клоду на вёрстку. Полный JSON весит
// в разы больше: там сырые описания и по четыре абзаца-кандидата на
// каждую публикацию, и всё это в разбор раздела не нужно.
const brief = results.map((r) => [
  r.outlet,
  r.kind,
  r.year ?? '',
  r.alive ? (r.title ?? r.note) : 'НЕ ОТКРЫЛАСЬ',
  r.image ? 'обложка' : '',
  r.titleFrom ?? '',
  r.quotes?.[0]?.direct ? r.quotes[0].text : '',
  r.url,
].join('\t'));
await fs.writeFile(BRIEF, brief.join('\n'));

// Один и тот же заголовок у нескольких публикаций одного издания — это
// не совпадение, а название сайта: страница собирается скриптом, и в
// исходном HTML заголовка статьи нет. Для таких берём описание из документа.
const titleCount = {};
for (const r of results) {
  if (r.alive && r.titleFrom === 'страница' && r.rawTitle) {
    const k = `${r.outlet}\u0000${r.rawTitle}`;
    titleCount[k] = (titleCount[k] ?? 0) + 1;
  }
}
for (const r of results) {
  if (!r.alive || r.titleFrom !== 'страница') continue;
  if (titleCount[`${r.outlet}\u0000${r.rawTitle}`] >= 2) {
    r.title = r.note;
    r.titleFrom = 'документ';
  }
}

const alive = results.filter((r) => r.alive);
const dead = results.filter((r) => !r.alive);
const withQuote = alive.filter((r) => r.quotes?.some((q) => q.direct));
const mentionOnly = alive.filter((r) => r.quotes?.length && !r.quotes.some((q) => q.direct));
const titleFromDoc = alive.filter((r) => r.titleFrom === 'документ');
const withImage = alive.filter((r) => r.image);
const withYear = alive.filter((r) => r.year);

console.log(`\n
Открылось:            ${alive.length} из ${results.length}
Не открылось:         ${dead.length}
С прямой речью:       ${withQuote.length}
Только упоминание:    ${mentionOnly.length}
Заголовок из документа: ${titleFromDoc.length}  (страница не отдала свой)
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
console.log(`Выжимка для вёрстки (её и присылайте): ${path.relative(ROOT, BRIEF)}`);
