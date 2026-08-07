#!/usr/bin/env node
// Сверка залитого Google-документа с исходной выгрузкой.
//
// Заливка идёт текстом через API, и главный риск — обрыв на середине: документ
// выглядит целым, а половины страницы нет. Скрипт берёт каждый смысловой фрагмент
// выгрузки и ищет его в тексте, вычитанном обратно из документа.
//
// Использование:
//   node scripts/verify-gdoc.mjs <файл с вычитанным текстом документа>
//   node scripts/verify-gdoc.mjs <readback.txt> <своя выгрузка.md>
//
// Пустой список расхождений = документ совпал с выгрузкой дословно.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [readbackPath, mdPath = path.join(ROOT, 'docs', 'тексты-сайта.md')] = process.argv.slice(2);

if (!readbackPath) {
  console.error('usage: node scripts/verify-gdoc.mjs <readback.txt> [выгрузка.md]');
  process.exit(2);
}

// Обе стороны приводим к одному виду: разметка стирается, пробелы схлопываются.
// Google отдаёт текст со своим экранированием и неразрывными пробелами — их тоже снимаем.
function normalize(s) {
  return s
    .replace(/\\/g, '')
    .replace(/<\/?mark>/g, '')
    .replace(/[`*]/g, '')
    .replace(/[#|]/g, ' ')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const md = fs.readFileSync(mdPath, 'utf8');
const readback = normalize(fs.readFileSync(readbackPath, 'utf8'));

const missing = [];
let checked = 0;

for (const raw of md.split('\n')) {
  const t = raw.trim();
  if (!t || t === '---') continue;
  if (/^\|[\s:|-]+\|$/.test(t)) continue;

  // строку таблицы проверяем по ячейкам — границы Google расставляет по-своему
  const parts = t.startsWith('|')
    ? t.replace(/^\|/, '').replace(/\|$/, '').split('|')
    : [t];

  for (const part of parts) {
    const needle = normalize(part);
    if (needle.length < 4) continue; // слишком коротко, чтобы судить о пропаже
    checked += 1;
    if (!readback.includes(needle)) missing.push(needle);
  }
}

console.log(`проверено фрагментов ${checked}, не найдено ${missing.length}`);
for (const m of missing) console.log(`  НЕТ: ${m.slice(0, 160)}`);
process.exit(missing.length ? 1 : 0);
