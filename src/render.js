import { AppError } from './errors.js';

export function cleanText(value) {
  return String(value ?? '').toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

export function escapeHtml(value) {
  return cleanText(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function safeUrl(value, allowMail = true) {
  try {
    // Feishu text links may URL-encode the entire URL, including the scheme.
    // Decode only that form, leaving percent escapes in ordinary URLs intact.
    if (/^[a-z][a-z0-9+.-]*%3a/i.test(value)) value = decodeURIComponent(value);
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:' || (allowMail && url.protocol === 'mailto:')) && !url.username && !url.password) return url.href;
  } catch { /* Non-absolute and malformed URLs are not emitted as links. */ }
  return null;
}

function inline(text, preformatted = false) {
  if (!Array.isArray(text?.elements)) throw new AppError('INVALID_BLOCK', '正文文本结构缺失。');
  return text.elements.map(element => {
    if (!element.text_run || typeof element.text_run.content !== 'string') {
      throw new AppError('UNSUPPORTED_ELEMENT', '不支持的行内元素，请检查文档中的提及、公式或附件。');
    }
    const run = element.text_run;
    let value = escapeHtml(run.content);
    if (preformatted) return value;
    value = value.replace(/\r\n|\r|\n/g, '<br>');
    const style = run.text_element_style ?? {};
    for (const [key, tag] of [['inline_code', 'code'], ['bold', 'strong'], ['italic', 'em'], ['strikethrough', 's'], ['underline', 'u']]) {
      if (style[key]) value = `<${tag}>${value}</${tag}>`;
    }
    const url = safeUrl(style.link?.url);
    return url ? `<a href="${escapeHtml(url)}">${value}</a>` : value;
  }).join('');
}

function sequence(block) {
  const value = block.ordered?.style?.sequence;
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

export function renderDocument(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) throw new AppError('INVALID_BLOCK', '文档根块缺失。');
  const byId = new Map(blocks.map(block => [block.block_id, block]));
  if (byId.size !== blocks.length || byId.has(undefined)) throw new AppError('INVALID_BLOCK', '文档块 ID 缺失或重复。');
  const roots = blocks.filter(b => b.block_type === 1);
  if (roots.length !== 1) throw new AppError('INVALID_BLOCK', '文档根块缺失或重复。');
  const visited = new Set([roots[0].block_id]);
  const get = id => {
    const block = byId.get(id);
    if (!block) throw new AppError('INVALID_BLOCK', '文档子块缺失，正文可能未完整读取。');
    return block;
  };
  const take = id => {
    if (visited.has(id)) throw new AppError('INVALID_BLOCK', '文档块存在重复或循环引用。');
    visited.add(id);
    return get(id);
  };
  function children(ids = [], depth = 0) {
    if (!Array.isArray(ids) || depth > 64) throw new AppError('INVALID_BLOCK', '文档层级异常。');
    let html = '';
    for (let index = 0; index < ids.length; index++) {
      const block = get(ids[index]);
      if (block.block_type === 12 || block.block_type === 13) {
        const tag = block.block_type === 12 ? 'ul' : 'ol';
        const start = sequence(block);
        html += `<${tag}${tag === 'ol' && start ? ` start="${start}"` : ''}>`;
        do {
          const item = take(ids[index]);
          const value = sequence(item);
          html += `<li${tag === 'ol' && value ? ` value="${value}"` : ''}>${inline(item.bullet ?? item.ordered)}${children(item.children, depth + 1)}</li>`;
          index++;
        } while (index < ids.length && get(ids[index]).block_type === block.block_type);
        index--;
        html += `</${tag}>`;
      } else {
        html += render(take(ids[index]), depth);
      }
    }
    return html;
  }
  function render(block, depth) {
    const childHtml = () => children(block.children, depth + 1);
    const type = block.block_type;
    if (type === 2) return `<p>${inline(block.text)}</p>${childHtml()}`;
    if (type >= 3 && type <= 8) {
      const level = type - 2;
      return `<h${level}>${inline(block[`heading${level}`])}</h${level}>${childHtml()}`;
    }
    if (type === 14) return `<pre><code>${inline(block.code, true)}</code></pre>${childHtml()}`;
    if (type === 15) return `<blockquote><p>${inline(block.quote)}</p>${childHtml()}</blockquote>`;
    if (type === 17) return `<p>${block.todo?.style?.done ? '☑' : '☐'} ${inline(block.todo)}</p>${childHtml()}`;
    if (type === 22) return `<hr>${childHtml()}`;
    if (type === 34) return `<blockquote>${childHtml()}</blockquote>`;
    if (type === 31) {
      const table = block.table;
      const props = table?.property;
      const rows = props?.row_size;
      const cols = props?.column_size;
      if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 1 || cols < 1 || table.cells?.length !== rows * cols) {
        throw new AppError('INVALID_TABLE', '表格行列或单元格缺失。');
      }
      if (props.merge_info?.some(info => info.row_span > 1 || info.col_span > 1)) {
        throw new AppError('UNSUPPORTED_TABLE', '暂不支持合并单元格。');
      }
      let html = '<table><tbody>';
      for (let row = 0; row < rows; row++) {
        html += '<tr>';
        for (let col = 0; col < cols; col++) {
          const cell = take(table.cells[row * cols + col]);
          if (cell.block_type !== 32) throw new AppError('INVALID_TABLE', '表格单元格类型错误。');
          const tag = (props.header_row && row === 0) || (props.header_column && col === 0) ? 'th' : 'td';
          html += `<${tag}>${children(cell.children, depth + 1)}</${tag}>`;
        }
        html += '</tr>';
      }
      return `${html}</tbody></table>`;
    }
    throw new AppError('UNSUPPORTED_BLOCK', `不支持的文档块类型（${Number.isInteger(type) ? type : '未知'}）。`);
  }
  const html = children(roots[0].children);
  if (visited.size !== blocks.length) throw new AppError('INVALID_BLOCK', '存在未连接到正文的文档块，拒绝省略。');
  return html;
}
