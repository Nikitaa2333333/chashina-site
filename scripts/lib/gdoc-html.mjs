// Markdown выгрузки → HTML для импорта в Google Docs.
//
// Markdown Google Drive тоже принимает, но выбрасывает <mark> — фирменная заливка
// маркером теряется, а она у нас несёт смысл (главная мысль блока). Через HTML
// доезжает всё: заливка, таблицы, уровни заголовков, служебный курсив пометок.

const HL_FILL = '#cef79e'; // --lime, фирменный маркер сайта
const SERVICE_INK = '#8a8f8f'; // служебные пометки — заметно тише текста

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Сначала экранируем всё, затем возвращаем тегами только свою разметку.
function inlineHtml(text) {
  return escapeHtml(text)
    .replace(/&lt;mark&gt;([\s\S]*?)&lt;\/mark&gt;/g, `<span style="background-color:${HL_FILL}">$1</span>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*\((.*?)\)\*/g, `<em style="color:${SERVICE_INK}">($1)</em>`)
    .replace(/`([^`]+)`/g, '<span style="font-family:\'Roboto Mono\',monospace">$1</span>');
}

const tableCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isTableRule = (line) => /^\|[\s:|-]+\|$/.test(line.trim()) && line.includes('-');

function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (t === '') { i++; continue; }

    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i += 1; }
      const rows = block.filter((l) => !isTableRule(l)).map(tableCells);
      if (rows.length) {
        out.push('<table style="border-collapse:collapse">');
        rows.forEach((cells, idx) => {
          const head = idx === 0;
          const cellHtml = cells.map((c) => {
            const style = `border:1px solid #cccccc;padding:6px 9px;vertical-align:top${head ? ';background-color:#eeeeee' : ''}`;
            return `<td style="${style}">${head ? `<strong>${inlineHtml(c)}</strong>` : inlineHtml(c)}</td>`;
          }).join('');
          out.push(`<tr>${cellHtml}</tr>`);
        });
        out.push('</table>');
      }
      continue;
    }

    if (t === '---') { out.push('<hr>'); i += 1; continue; }

    const heading = t.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${inlineHtml(heading[2])}</h${lvl}>`);
      i += 1;
      continue;
    }

    if (/^-\s+/.test(t)) {
      out.push('<ul>');
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) {
        const item = [lines[i].trim().replace(/^-\s+/, '')];
        i += 1;
        // продолжение пункта — отбитая строка без своего маркера
        while (i < lines.length && lines[i].startsWith('  ') && lines[i].trim() !== ''
               && !/^-\s+/.test(lines[i].trim()) && !lines[i].trim().startsWith('|')) {
          item.push(lines[i].trim());
          i += 1;
        }
        out.push(`<li>${inlineHtml(item.join(' '))}</li>`);
      }
      out.push('</ul>');
      continue;
    }

    out.push(`<p>${inlineHtml(t)}</p>`);
    i += 1;
  }

  return `${out.join('\n')}\n`;
}

export { markdownToHtml };
