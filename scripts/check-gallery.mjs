// Проверяет раскладку мозаики галереи: ровный ли низ и не сгрудились ли
// горизонтальные кадры в одну колонку.
//
// Зачем: порядок кадров в массиве gallery (src/pages/index.astro) — это и есть
// раскладка. Вертикаль занимает два ряда, горизонталь один, и dense-упаковка
// идёт строго по списку. Стоит переставить пару кадров — и колонка уезжает
// вниз на целую плитку. Глазами это ловится плохо, замером — сразу.
//
// Запуск (нужен поднятый дев-сервер):
//   npx astro dev --host 127.0.0.1 --port 4331
//   node scripts/check-gallery.mjs
//
// Нужен playwright-core и установленный chromium. Если их нет:
//   npm i -D playwright-core && npx playwright install chromium

const URL = process.env.URL ?? 'http://127.0.0.1:4331/';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('Нет playwright-core. Поставьте: npm i -D playwright-core && npx playwright install chromium');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(500);

const cols = await page.evaluate(() => {
  const grid = document.querySelector('.gallery__grid');
  if (!grid) return null;
  const box = grid.getBoundingClientRect();
  const colW = box.width / 3;
  const out = [[], [], []];
  document.querySelectorAll('.gallery__tile').forEach((t, i) => {
    const b = t.getBoundingClientRect();
    const c = Math.min(2, Math.round((b.left - box.left) / colW));
    out[c].push({ i, v: t.classList.contains('gallery__tile--v'), bottom: Math.round(b.bottom) });
  });
  return out.map((c) => ({
    count: c.length,
    horiz: c.filter((x) => !x.v).length,
    order: c.map((x) => `${x.i}${x.v ? 'в' : 'г'}`).join(' '),
    bottom: c.length ? Math.max(...c.map((x) => x.bottom)) : 0,
  }));
});

await browser.close();

if (!cols) {
  console.error('Не нашёл .gallery__grid — страница та? Сервер поднят?');
  process.exit(2);
}

cols.forEach((c, i) => console.log(`колонка ${i + 1}: ${c.count} шт, горизонтальных ${c.horiz}, низ ${c.bottom}\n   ${c.order}`));

const bottoms = cols.map((c) => c.bottom);
const spread = Math.max(...bottoms) - Math.min(...bottoms);
const lonely = cols.some((c) => c.horiz === 0) && cols.some((c) => c.horiz === c.count);

let bad = false;
if (spread > 2) {
  console.error(`\n✗ Низ рваный: разброс ${spread}px. Пересоберите порядок блоками (см. комментарий у gallery в index.astro).`);
  bad = true;
}
if (lonely) {
  console.error('\n✗ Горизонтали сгрудились в одну колонку — выйдут полосы, а не мозаика.');
  bad = true;
}
if (!bad) console.log('\n✓ Низ ровный, ориентации перемешаны.');
process.exit(bad ? 1 : 0);
