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

const dead = items.filter((r) => !r.alive);
const live = items.filter((r) => r.alive);

// Год: сначала дата со страницы, потом год из адреса. У части публикаций
// нет ни того ни другого — в карточке год тогда просто не показываем.
const yearOf = (r) => {
  const y = r.year ?? r.url.match(/\/(20\d{2})\//)?.[1] ?? null;
  const n = y ? Number(y) : null;
  return n && n >= 2010 && n <= 2030 ? n : null;
};

const built = live.map((r) => {
  const quote = r.quotes?.find((q) => q.direct)?.text ?? null;
  const cover = r.cover ?? null;
  return {
    title: (r.title ?? r.note).trim(),
    outlet: r.outlet,
    kind: r.kind,
    year: yearOf(r),
    url: r.url,
    cover,
    quote,
    tier: cover && quote ? 'full' : cover ? 'card' : 'line',
  };
});

// Свежее сверху; публикации без года — в конец, но внутри своего издания
// порядок сохраняем, чтобы «Личный опыт, часть 1 и 2» не разъезжались.
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
