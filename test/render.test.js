import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from '../src/render.js';
import { buildRss } from '../src/rss.js';
import { sampleBlocks, textBlock, documentBlocks } from './fixtures.js';

test('preserves headings, inline styles, line breaks and safely escaped links', () => {
  const html = renderDocument(sampleBlocks);
  assert.match(html, /<h1>每日技术简报<\/h1>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em> \/ 斜体<\/em>/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(html, /<br>第二行 &lt;安全转义&gt;/);
});

test('groups adjacent lists and preserves nesting, numbering, quotes and code whitespace', () => {
  const html = renderDocument(sampleBlocks);
  assert.match(html, /<ul><li>重点一<ul><li>嵌套内容<\/li><\/ul><\/li><li>重点二<\/li><\/ul>/);
  assert.match(html, /<ol start="3"><li value="3">第三步<\/li><li>第四步<\/li><\/ol>/);
  assert.match(html, /<blockquote><p>保留引用结构。<\/p><\/blockquote>/);
  assert.match(html, /<pre><code>if \(a &lt; b\) \{\n  run\(\);\n\}<\/code><\/pre>/);
  assert.match(html, /☑ 已阅读/);
});

test('renders row-major tables exactly once', () => {
  const html = renderDocument(sampleBlocks);
  assert.match(html, /<table><tbody><tr><th><p>主题<\/p><\/th><th><p>结论<\/p><\/th><\/tr><tr><td><p>RSS<\/p><\/td><td><p>保留格式<\/p><\/td><\/tr><\/tbody><\/table>/);
  assert.equal(html.split('保留格式').length - 1, 1);
});

test('does not turn unsafe links or HTML input into active markup', () => {
  const p = textBlock('p', 'text', '<script>bad()</script>\u0000');
  p.text.elements[0].text_run.text_element_style = { link: { url: 'javascript:alert(1)' }, inline_code: true };
  assert.equal(renderDocument(documentBlocks([p])), '<p><code>&lt;script&gt;bad()&lt;/script&gt;</code></p>');
});

test('decodes Feishu encoded link URLs once without corrupting already encoded query values', () => {
  for (const [url, expected] of [
    ['https%3A%2F%2Fexample.com%2F%3Fq%3Da%2526b', 'https://example.com/?q=a%26b'],
    ['https://example.com/?q=a%26b', 'https://example.com/?q=a%26b'],
  ]) {
    const p = textBlock('p', 'text', '链接');
    p.text.elements[0].text_run.text_element_style = { link: { url } };
    assert.equal(renderDocument(documentBlocks([p])), `<p><a href="${expected}">链接</a></p>`);
  }
  const p = textBlock('p', 'text', '坏链接');
  p.text.elements[0].text_run.text_element_style = { link: { url: 'javascript%3Aalert(1)' } };
  assert.equal(renderDocument(documentBlocks([p])), '<p>坏链接</p>');
});

test('fails on unsupported content instead of silently dropping it', () => {
  assert.throws(() => renderDocument(documentBlocks([{ block_id: 'x', block_type: 27, image: {} }])), /不支持/);
  const p = textBlock('p', 'text', '');
  p.text.elements = [{ mention_user: { user_id: 'user' } }];
  assert.throws(() => renderDocument(documentBlocks([p])), /不支持/);
});

test('fails on incomplete or cyclic trees and merged tables', () => {
  assert.throws(() => renderDocument([{ block_id: 'doc', block_type: 1, page: {}, children: ['missing'] }]), /缺失/);
  assert.throws(() => renderDocument(documentBlocks([textBlock('p', 'bullet', 'cycle', ['p'])])), /重复|循环/);
  const blocks = structuredClone(sampleBlocks);
  blocks.find(b => b.table).table.property.merge_info = [{ row_span: 2, col_span: 1 }];
  assert.throws(() => renderDocument(blocks), /合并/);
});

test('RSS carries escaped metadata, stable GUID and safely split HTML CDATA', () => {
  const xml = buildRss([{ id: 'abc', title: '标题 & <一>', url: 'https://example.com/doc?a=1&b=2', published: '2026-09-07T02:30:00.000Z', html: '<p>正文 ]]> 完整</p>' }], { title: '我的订阅', description: '全文' });
  assert.match(xml, /<title>标题 &amp; &lt;一&gt;<\/title>/);
  assert.match(xml, /<guid isPermaLink="false">feishu:abc<\/guid>/);
  assert.match(xml, /<pubDate>Mon, 07 Sep 2026 02:30:00 GMT<\/pubDate>/);
  assert.match(xml, /xmlns:content="http:\/\/purl.org\/rss\/1.0\/modules\/content\/"/);
  assert.match(xml, /\]\]\]\]><!\[CDATA\[>/);
});
