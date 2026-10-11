export function textBlock(id, kind, text, children = [], style = {}) {
  const types = { text: 2, heading1: 3, heading2: 4, bullet: 12, ordered: 13, code: 14, quote: 15, todo: 17 };
  return { block_id: id, block_type: types[kind], children, [kind]: {
    elements: [{ text_run: { content: text, text_element_style: {} } }], style,
  } };
}

export function documentBlocks(children) {
  return [{ block_id: 'doc', block_type: 1, page: { elements: [] }, children: children.map(b => b.block_id) }, ...children];
}

// Synthetic Feishu block response. No personal document content.
export const sampleBlocks = [
  { block_id: 'doc', block_type: 1, page: { elements: [] }, children: ['heading', 'para', 'bullet1', 'bullet2', 'order1', 'order2', 'quote', 'code', 'todo', 'divider', 'table'] },
  textBlock('heading', 'heading1', '每日技术简报'),
  { ...textBlock('para', 'text', ''), text: { elements: [
    { text_run: { content: '粗体', text_element_style: { bold: true } } },
    { text_run: { content: ' / 斜体', text_element_style: { italic: true } } },
    { text_run: { content: ' / 链接', text_element_style: { link: { url: 'https://example.com/?a=1&b=2' } } } },
    { text_run: { content: '\n第二行 <安全转义>', text_element_style: {} } },
  ] } },
  textBlock('bullet1', 'bullet', '重点一', ['nested']),
  textBlock('nested', 'bullet', '嵌套内容'),
  textBlock('bullet2', 'bullet', '重点二'),
  textBlock('order1', 'ordered', '第三步', [], { sequence: '3' }),
  textBlock('order2', 'ordered', '第四步', [], { sequence: 'auto' }),
  { block_id: 'quote', block_type: 34, quote_container: {}, children: ['quoted'] },
  textBlock('quoted', 'text', '保留引用结构。'),
  textBlock('code', 'code', 'if (a < b) {\n  run();\n}', [], { language: 30 }),
  textBlock('todo', 'todo', '已阅读', [], { done: true }),
  { block_id: 'divider', block_type: 22, divider: {} },
  { block_id: 'table', block_type: 31, children: ['c1', 'c2', 'c3', 'c4'], table: {
    cells: ['c1', 'c2', 'c3', 'c4'], property: { row_size: 2, column_size: 2, header_row: true },
  } },
  ...['主题', '结论', 'RSS', '保留格式'].flatMap((v, i) => [
    { block_id: `c${i + 1}`, block_type: 32, table_cell: {}, children: [`ct${i}`] },
    textBlock(`ct${i}`, 'text', v),
  ]),
];
