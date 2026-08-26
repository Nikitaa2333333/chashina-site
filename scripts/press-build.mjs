/**
 * Сборка данных раздела «Публикации».
 *
 * Читает data/press-audit.json и кладёт рядом с сайтом два файла:
 *
 *   src/data/press.json   ← то, что рендерит страница. Коммитится.
 *   data/press-dead.tsv   ← ссылки, которые не открылись. На сверку с Оксаной.
 *
 * Карточки выходят трёх видов, и это не про красоту, а про наличие данных:
 *   full — есть обложка и прямая речь
 *   card — есть обложка, речи нет
 *   line — ни того ни другого, строка с заголовком и годом
 *
 * Запуск:  node scripts/press-build.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUDIT = path.join(ROOT, 'data/press-audit.json');
const OUT = path.join(ROOT, 'src/data/press.json');
const DEAD = path.join(ROOT, 'data/press-dead.tsv');

const items = JSON.parse(await fs.readFile(AUDIT, 'utf8'));

// Ссылка ведёт не на публикацию, а на карточку врача — на сайте ей не место.
const NOT_PRESS = [/nbcdevelopment\.ru/i];

// Заголовок со страницы бывает мусорным: у радио это название плеера,
// у телепрограмм — навигация «Передача / Выпуски / …», у карточки врача —
// перечень должностей. В таких случаях берём описание из press-raw.tsv.
const JUNK_TITLE = [
  / \/ /,
  /слушать эфир|смотреть онлайн|онлайн\s*[-—]\s*слушать/i,
  /Чащина\s+Оксана\s+Валери/i,
];

// Регалии — не прямая речь. «Оксана Чащина: …» и «Оксана Чащина — врач…»
// на сайте лишние: рядом стоит имя издания, и так понятно, кто говорит.
const CREDENTIALS =
  /врач-косметолог|врач-дерматокосметолог|заместител|главного врача|дерматовенеролог|физиотерапевт|лазеротерапевт|член ассоциации/i;

const titleOf = (r) => {
  const t = (r.title ?? '').trim();
  const note = (r.note ?? '').trim();
  if (!t) return note;
  return note && JUNK_TITLE.some((re) => re.test(t)) ? note : t;
};

const quoteOf = (r) => {
  const raw = r.quotes?.find((q) => q.direct)?.text?.trim();
  if (!raw) return null;
  // Срезаем подводку с именем: «Оксана Чащина:», «Доктор Чащина объясняет:»
  let q = raw.replace(/^[^«»]{0,120}?Чащина[^«»:]{0,120}:\s*/i, '');
  q = q.replace(/^Оксана\s+Чащина\s*[—–-]\s*/i, '');
  // Речь внутри кавычек — берём её саму, без слов автора вокруг
  const inQuotes = q.match(/«([^»]{60,})»/);
  if (inQuotes) q = inQuotes[1];
  q = q.replace(/^[«"]+|[»"]+$/g, '').trim();
  if (q.length < 60) return null; // огрызок фразы
  // Осталось представление вместо речи («Известный врач-косметолог, …»)
  if (CREDENTIALS.test(q.slice(0, 40))) return null;
  // Имя внутри — значит это пересказ журналиста со словами автора
  // («— добавляет Чащина. —»), а не чистая прямая речь. Такое не берём:
  // на сайте Оксаны цитата с её же фамилией в третьем лице читается странно.
  if (/Чащин/i.test(q)) return null;
  return q;
};

const dead = items.filter((r) => !r.alive);
const live = items.filter((r) => r.alive && !NOT_PRESS.some((re) => re.test(r.url)));

// Год: сначала дата со страницы, потом год из адреса. У части публикаций
// нет ни того ни другого — в карточке год тогда просто не показываем.
const yearOf = (r) => {
  const y = r.year ?? r.url.match(/\/(20\d{2})\//)?.[1] ?? null;
  const n = y ? Number(y) : null;
  return n && n >= 2010 && n <= 2030 ? n : null;
};

const built = live.map((r) => {
  const quote = quoteOf(r);
  const cover = r.cover ?? null;
  return {
    title: titleOf(r),
    outlet: r.outlet,
    kind: r.kind,
    year: yearOf(r),
    url: r.url,
    cover,
    quote,
    tier: cover && quote ? 'full' : cover ? 'card' : 'line',
  };
});

// Порядок — по свежести: сначала материалы с годом, свежие сверху, затем
// те, где даты на странице не нашлось (их около половины). Чередование
// видов карточек тут пробовали — читателю оно ничего не даёт, а список
// перестаёт быть хронологическим.
built.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(built, null, 2));

await fs.writeFile(
  DEAD,
  dead.map((r) => [r.outlet, r.status ?? 'сеть', r.note, r.url].join('\t')).join('\n')
);

const by = (k) => built.reduce((a, r) => ((a[r[k]] = (a[r[k]] ?? 0) + 1), a), {});
const tiers = by('tier');
const kinds = by('kind');

console.log(`
Публикаций на сайт:   ${built.length}
Не открылись:         ${dead.length}   → data/press-dead.tsv

Виды карточек:
  с обложкой и цитатой  ${tiers.full ?? 0}
  с обложкой            ${tiers.card ?? 0}
  строкой               ${tiers.line ?? 0}

По типу материала:
${Object.entries(kinds).map(([k, n]) => `  ${String(n).padStart(3)}  ${k}`).join('\n')}

С годом:              ${built.filter((r) => r.year).length} из ${built.length}
Изданий:              ${new Set(built.map((r) => r.outlet)).size}

Готово: src/data/press.json
`);
