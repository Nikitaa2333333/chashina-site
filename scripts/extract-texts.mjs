/**
 * Выгрузка всего видимого текста сайта в один Markdown-документ — на сверку
 * с Оксаной. Плюс HTML-двойник того же документа для заливки в Google Docs.
 *
 * Источник — СОБРАННЫЙ сайт (dist/index.html): текст берётся из готового HTML,
 * поэтому дословно совпадает с тем, что видит посетитель. Руками файл выгрузки
 * НЕ редактировать: источник правды по тексту — код страницы.
 *
 * Запуск:  npm run texts        (= astro build + этот скрипт)
 * Результат:
 *   docs/тексты-сайта.md    — версия для репозитория (в git)
 *   docs/тексты-сайта.html  — то же самое для импорта в Google Docs (не в git)
 *
 * Правила разбора:
 * - каждая <section> становится разделом «NN. Тег — Заголовок» и помечается
 *   *(секция: #id)* — по этой пометке правка клиента возвращается в вёрстку;
 * - <mark>…</mark> сохраняется как есть (фирменный маркер, лаймовая заливка);
 * - неразрывные пробелы заменяются обычными (типограф расставит их заново);
 * - кнопки и поля форм помечаются служебным курсивом *(кнопка)* / *(поле: …)*;
 * - декоративное (svg, canvas, img, aria-hidden, hidden) выбрасывается.
 *
 * parse5 — транзитивная зависимость Astro, отдельно не ставится.
 */
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import fs from 'node:fs';
import path from 'node:path';
import { markdownToHtml } from './lib/gdoc-html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'docs');

const SKIP_TAGS = new Set(['script', 'style', 'svg', 'noscript', 'template', 'link', 'meta', 'img', 'source', 'picture', 'iframe', 'canvas', 'video', 'audio']);
const HEADINGS = { h1: '#', h2: '##', h3: '###', h4: '####', h5: '#####', h6: '#####' };
const INLINE = new Set(['span', 'em', 'i', 'strong', 'b', 'small', 'sup', 'sub', 'abbr', 'time', 'cite', 'u', 's', 'code']);

/**
 * Человеческие названия разделов — подстраховка для секций без своего заголовка
 * (ступени, слайдер, галерея). Ключ — id, иначе первый класс секции.
 * Незнакомая секция не ломает выгрузку: скрипт возьмёт её заголовок, а если и
 * его нет — напечатает предупреждение и подставит селектор.
 */
const SECTION_NAMES = {
  header: 'Шапка сайта',
  hero: 'Первый экран',
  halves: 'Подход',
  work: 'Как строится работа',
  steps: 'Ступени работы',
  principles: 'Что для меня важно',
  statement: 'Манифест',
  methods: 'Аппаратные методы',
  mscroll: 'Аппаратные методы — карточки',
  smas: 'Гравитационный птоз и SMAS',
  inject: 'Инъекционные методы',
  zones: 'Зоны, которые выдают возраст',
  inside: 'Красота начинается не с крема',
  care: 'Домашний уход',
  social: 'Соцсети',
  press: 'Публикации в СМИ',
  reviews: 'Отзывы',
  about: 'Обо мне',
  gallery: 'Галерея',
  contact: 'Где я принимаю',
  footer: 'Футер',
};

/**
 * Секции, которые в документе приклеиваются к предыдущей: своего тега и
 * заголовка у них нет, они физически продолжают соседний блок (ступени под
 * «Как строится работа», карточки слайдера под «Аппаратными методами»).
 * Список явный: манифест тоже без тега и заголовка, но это самостоятельный
 * блок, и приклеивать его к ступеням нельзя.
 */
const CONTINUATION = new Set(['steps', 'mscroll']);

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value ?? '';
const classes = (node) => attr(node, 'class').split(/\s+/).filter(Boolean);
const hasClass = (node, cls) => classes(node).includes(cls);

const skip = (node) =>
  SKIP_TAGS.has(node.nodeName) ||
  attr(node, 'aria-hidden') === 'true' ||
  node.attrs?.some((a) => a.name === 'hidden');

const clean = (s) =>
  s
    .replace(/ /g, ' ') // nbsp → обычный пробел
    .replace(/­/g, '') // мягкий перенос
    .replace(/[ \t]+/g, ' ');

const BR = String.fromCharCode(1); // метка настоящего <br>
const LINK = String.fromCharCode(2); // метка самостоятельной ссылки — по ней склеивается меню

/** Текст фразового содержимого узла (mark сохраняется тегом). */
function inline(node) {
  if (node.nodeName === '#text') return clean(node.value);
  if (skip(node) || !node.childNodes) return '';
  const inner = node.childNodes.map(inline).join('');
  if (node.nodeName === 'mark') {
    const t = inner.trim();
    return t ? `<mark>${t}</mark>` : '';
  }
  if (node.nodeName === 'br') return BR;
  return inner;
}

/**
 * Фразовый текст в одну строку. Переносы и отступы вёрстки схлопываются:
 * иначе один абзац сайта уезжает в документ тремя отдельными абзацами,
 * а выброшенная картинка-кругляш оставляет после себя двойной пробел.
 */
const phrase = (node) =>
  inline(node)
    .replace(/\s+/g, ' ')
    .split(BR)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');

/** Есть ли у узла блочные потомки (заголовки, абзацы и т.п.). */
const hasBlockChildren = (node) =>
  node.childNodes?.some(
    (c) => c.nodeName !== '#text'
      && !INLINE.has(c.nodeName)
      && !['mark', 'br', 'a', 'button'].includes(c.nodeName)
      // выброшенное при разборе (декоративные svg-стрелки) блоком не считается —
      // иначе кнопка с иконкой выглядит контейнером и теряет пометку *(кнопка)*
      && !skip(c),
  );

/** Таймлайн «Образование и практика»: сетка спанов → две читаемые таблицы. */
function cvTables(grid) {
  const rows = { edu: [], work: [] };
  for (const item of grid.childNodes ?? []) {
    if (!hasClass(item, 'cv__item')) continue;
    const cells = (item.childNodes ?? [])
      .filter((c) => c.nodeName === 'span')
      .map((c) => inline(c).replace(/\s+/g, ' ').trim());
    if (!cells.some(Boolean)) continue;
    rows[hasClass(item, 'cv__item--edu') ? 'edu' : 'work'].push(cells);
  }
  const table = (head, list) => {
    if (!list.length) return [];
    const width = Math.max(3, ...list.map((r) => r.length));
    const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    return [
      `*(${head})*`,
      [line(['Годы', 'Место', 'Пояснение']), `|${' --- |'.repeat(width)}`, ...list.map(line)].join('\n'),
    ];
  };
  return [...table('образование', rows.edu), ...table('практика', rows.work)];
}

/** Markdown-блоки узла (массив готовых блоков-строк). */
function blocks(node) {
  if (node.nodeName === '#text') {
    const t = clean(node.value).trim();
    return t ? [t] : [];
  }
  if (skip(node) || !node.childNodes) return [];

  const tag = node.nodeName;

  if (hasClass(node, 'cv__grid')) return cvTables(node);

  // подзаголовки внутри «Обо мне» (сам таймлайн и блок сертификатов) — на сайте
  // это mono-подписи, в документе им честнее быть заголовками
  if (hasClass(node, 'cv__head') || hasClass(node, 'cv__certs-head')) {
    const t = phrase(node);
    return t ? [`### ${t}`] : [];
  }

  if (HEADINGS[tag]) {
    const t = phrase(node);
    return t ? [`${HEADINGS[tag]} ${t}`] : [];
  }

  // пилюля-тег секции («Подход», «Обо мне») — служебный кикер, уезжает в название раздела
  if (hasClass(node, 'tag')) {
    const t = phrase(node);
    return t ? [`*(тег)* ${t}`] : [];
  }

  if (tag === 'p' || tag === 'figcaption' || tag === 'blockquote' || tag === 'legend' || tag === 'caption') {
    const t = phrase(node);
    return t ? [t] : [];
  }

  // Пресса: «издание + тема» карточками ленты — в документе это таблица,
  // так видно и перечень изданий, и темы, и куда дописать новую строку.
  // Карточка (.pcard) — ссылка на материал; внутри мета «издание · год»
  // и заголовок, остальное (обложка, чип-стрелка) в текст не идёт.
  if (hasClass(node, 'press__row')) {
    const pick = (card, cls) => {
      const el = (card.childNodes ?? []).find((x) => hasClass(x, cls));
      return el ? phrase(el) : '';
    };
    const rows = (node.childNodes ?? [])
      .filter((c) => c.nodeName === 'a' && !skip(c))
      .map((c) => [pick(c, 'pcard__meta'), pick(c, 'pcard__title')]);
    if (!rows.length) return [];
    const line = (r) => `| ${r[0] ?? ''} | ${r[1] ?? ''} |`;
    return [[line(['Издание', 'Тема']), '| --- | --- |', ...rows.map(line)].join('\n')];
  }

  // Меню (шапка, колонки футера) — одной строкой через «·»: в документе это
  // навигация, а не текст, и десятком отдельных абзацев она только мешает.
  if (tag === 'nav') {
    const items = node.childNodes.flatMap(blocks).filter(Boolean);
    if (!items.length) return [];
    const out = [];
    for (const b of items) {
      // склеиваем только ссылки: заголовок колонки футера («Навигация») —
      // обычный текст, и внутрь строки меню он уезжать не должен
      const prev = out[out.length - 1];
      if (!b.startsWith(LINK)) { out.push(b); continue; }
      if (prev?.startsWith('*(меню)* ')) out[out.length - 1] = `${prev} · ${b.slice(1)}`;
      else out.push(`*(меню)* ${b.slice(1)}`);
    }
    return out;
  }

  if (tag === 'details') {
    const summary = node.childNodes.find((c) => c.nodeName === 'summary');
    const head = summary ? [`### ${inline(summary).replace(/\s+/g, ' ').trim()}`] : [];
    const rest = node.childNodes.filter((c) => c !== summary).flatMap(blocks);
    return [...head, ...rest];
  }

  // Плашка целиком обёрнута в ссылку (карточка с href) — внутри заголовок и абзац.
  // Схлопывать такую ссылку в строку нельзя: заголовок карточки слипнется с текстом,
  // поэтому она разбирается общей веткой контейнера ниже.
  if ((tag === 'a' || tag === 'button') && !hasBlockChildren(node)) {
    const t = phrase(node);
    if (!t) return [];
    const cls = attr(node, 'class');
    if (/\bbtn\b|btn-pair/.test(cls) || tag === 'button') return [`*(кнопка)* ${t}`];
    return [LINK + t]; // самостоятельная ссылка/чип
  }

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (['hidden', 'submit'].includes(attr(node, 'type'))) return [];
    const label = attr(node, 'placeholder') || attr(node, 'aria-label') || attr(node, 'name');
    return label ? [`*(поле: ${label})*`] : [];
  }

  if (tag === 'ul' || tag === 'ol') {
    const out = [];
    for (const li of node.childNodes) {
      if (li.nodeName !== 'li' || skip(li)) continue;
      if (hasBlockChildren(li)) {
        out.push(...blocks({ ...li, nodeName: 'div' }));
      } else {
        const t = inline(li).replace(/\s+/g, ' ').trim();
        if (t) out.push(`- ${t}`);
      }
    }
    // подряд идущие пункты «- …» склеиваются в один блок-список
    const merged = [];
    for (const b of out) {
      if (b.startsWith('- ') && merged.length && merged[merged.length - 1].startsWith('- ')) {
        merged[merged.length - 1] += `\n${b}`;
      } else merged.push(b);
    }
    return merged;
  }

  if (tag === 'table') {
    const rows = [];
    const walkRows = (n) => {
      if (n.nodeName === 'tr') {
        const cells = n.childNodes
          .filter((c) => c.nodeName === 'td' || c.nodeName === 'th')
          .map((c) => inline(c).replace(/\s+/g, ' ').trim());
        if (cells.some(Boolean)) rows.push(cells);
      } else n.childNodes?.forEach(walkRows);
    };
    walkRows(node);
    if (!rows.length) return [];
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    const [head, ...rest] = rows;
    return [[line(head), `|${' --- |'.repeat(width)}`, ...rest.map(line)].join('\n')];
  }

  if (INLINE.has(tag) || tag === 'mark' || tag === 'label') {
    const t = phrase(node);
    return t ? [t] : [];
  }

  const kids = node.childNodes.filter((c) => c.nodeName !== '#text' || c.value.trim());

  // Стопка спанов (адрес клиники, метро, часы) — на сайте это отдельные строки,
  // склеивать их в один абзац нельзя: получится каша из адреса и расписания.
  if (kids.length > 1 && kids.every((c) => c.nodeName === 'span' && !skip(c))) {
    const lines = kids.map((c) => inline(c).replace(/\s+/g, ' ').trim()).filter(Boolean);
    return lines.length ? [lines.join('\n')] : [];
  }

  // контейнер только с фразовым содержимым (цифра + подпись) — один абзац
  const onlyPhrasing = node.childNodes.every(
    (c) => c.nodeName === '#text' || INLINE.has(c.nodeName) || c.nodeName === 'mark' || c.nodeName === 'br',
  );
  if (onlyPhrasing) {
    const t = phrase(node);
    return t ? [t] : [];
  }

  // прочие контейнеры (div, section, article, form, …) — просто собираем детей
  return node.childNodes.flatMap(blocks);
}

/** Ищет первый узел по предикату. */
function find(node, pred) {
  if (pred(node)) return node;
  for (const c of node.childNodes ?? []) {
    const r = find(c, pred);
    if (r) return r;
  }
  return null;
}

/**
 * Заголовок раздела в документе — «##», поэтому всё, что осталось внутри секции,
 * начинается с «###» и глубже: оглавление Google Docs собирается ровно.
 */
const nest = (md) =>
  md.replace(/^(#{1,6}) /gm, (_, h) => `${'#'.repeat(Math.min(6, Math.max(3, h.length)))} `);

// — разбор собранной страницы —
const indexFile = path.join(DIST, 'index.html');
if (!fs.existsSync(indexFile)) {
  console.error('dist/index.html не найден — сначала npm run build');
  process.exit(1);
}

const doc = parse(fs.readFileSync(indexFile, 'utf8'));
const body = find(doc, (n) => n.nodeName === 'body');

const sections = [];
for (const child of body.childNodes) {
  if (skip(child) || child.nodeName === '#text') continue;

  let bs = blocks(child).map((b) => b.split(LINK).join('')); // служебные метки дальше не нужны
  if (!bs.length) continue;

  // тег-пилюля и первый заголовок уходят в название раздела: в документе они
  // становятся строкой оглавления, а не двумя сиротливыми строчками над текстом
  const tagIdx = bs.findIndex((b) => b.startsWith('*(тег)* '));
  const kicker = tagIdx === -1 ? '' : bs[tagIdx].replace('*(тег)* ', '');
  if (tagIdx !== -1) bs = bs.filter((_, i) => i !== tagIdx);

  // только h1/h2 — заголовок самой секции; h3 внутри (ступени, плашки слайдера)
  // это уже содержимое, вытаскивать его в название раздела нельзя
  const headIdx = bs.findIndex((b) => /^#{1,2} /.test(b));
  const heading = headIdx === -1 ? '' : bs[headIdx].replace(/^#{1,2} /, '');
  if (headIdx !== -1) bs = bs.filter((_, i) => i !== headIdx);

  // `section` — утилитарный класс сетки, опознать по нему блок нельзя
  const id = attr(child, 'id');
  const own = classes(child).find((c) => c !== 'section' && !c.startsWith('section--'));
  const key = id || own || child.nodeName;
  const fallback = SECTION_NAMES[key] ?? SECTION_NAMES[own] ?? '';
  if (!heading && !fallback) console.warn(`! секция «${key}» без заголовка и без названия в SECTION_NAMES`);

  const name = [kicker || fallback, heading].filter(Boolean).join(' — ');
  const anchor = id ? `#${id}` : `.${own ?? child.nodeName}`;

  // Порядковый номер ступени/задачи отдельной строкой над заголовком — в документе
  // это сирота: приклеиваем к заголовку, «#### 01. Разобраться».
  for (let i = bs.length - 2; i >= 0; i -= 1) {
    if (/^\d{1,2}\.?$/.test(bs[i]) && /^#{1,6} /.test(bs[i + 1])) {
      bs[i + 1] = bs[i + 1].replace(/^(#{1,6}) /, `$1 ${bs[i].replace(/\.?$/, '.')} `);
      bs.splice(i, 1);
    }
  }

  const body = nest(bs.join('\n\n')).trim();
  const prev = sections[sections.length - 1];

  // Продолжение предыдущей секции: отдельным разделом читается обрывком,
  // поэтому приклеиваем — с меткой своей секции, чтобы правка всё равно
  // нашла место в вёрстке.
  if (CONTINUATION.has(own) && prev) {
    if (prev.body) prev.body += `\n\n*(секция: ${anchor})*\n\n${body}`;
    else {
      // предыдущая секция была одним заголовком (у «Как строится работа» весь
      // текст лежит в соседней) — двух меток подряд быть не должно
      prev.anchor += ` + ${anchor}`;
      prev.body = body;
    }
    continue;
  }

  sections.push({ anchor, name: name || key, body });
}

// — сборка документа —
const HEAD = [
  '# Оксана Чащина — тексты сайта',
  '',
  'Весь видимый текст одностраничного сайта, в порядке появления на экране — от шапки до футера. Выгружен из собранного сайта, поэтому дословно совпадает с тем, что видит посетитель.',
  '',
  '## Как читать и править',
  '',
  '- правьте прямо в документе — текстом или комментариями, как удобнее;',
  '- разделы идут в порядке экранов сайта; у каждого есть номер, по нему удобно ссылаться на блок («поправьте в 07»);',
  '- зелёной заливкой отмечены фразы, которые на сайте выделены фирменным маркером: это акцент блока, а не ошибка форматирования;',
  '- серый курсив в скобках — служебные пометки, к тексту сайта они не относятся:',
  '  *(секция: …)* — метка блока, по ней правка возвращается в вёрстку; *(кнопка)* — надпись на кнопке; *(меню)* — пункты навигации.',
  '',
];

const parts = sections.map((s, i) => {
  const n = String(i + 1).padStart(2, '0');
  return ['---', '', `## ${n}. ${s.name}`, '', `*(секция: ${s.anchor})*`, '', s.body, ''].join('\n');
});

fs.mkdirSync(OUT, { recursive: true });
const md = `${[...HEAD, ...parts].join('\n')}\n`;
const mdFile = path.join(OUT, 'тексты-сайта.md');
const htmlFile = path.join(OUT, 'тексты-сайта.html');
fs.writeFileSync(mdFile, md);
fs.writeFileSync(htmlFile, markdownToHtml(md));

const words = md.split(/\s+/).filter((w) => /[\p{L}]/u.test(w)).length;
for (const s of sections) console.log(`✓ ${s.anchor.padEnd(14)} ${s.name}`);
console.log(`\nРазделов: ${sections.length}, слов: ${words}`);
console.log(`Markdown: ${path.relative(ROOT, mdFile)}`);
console.log(`HTML для Google Docs: ${path.relative(ROOT, htmlFile)}`);
