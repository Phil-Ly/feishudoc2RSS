import { mkdir, writeFile } from 'node:fs/promises';
import { renderDocument } from '../src/render.js';
import { buildRss } from '../src/rss.js';
import { sampleBlocks } from '../test/fixtures.js';

const html = renderDocument(sampleBlocks);
const article = { id: 'demo', title: 'Markdown 排版示例', url: 'https://example.com/article', published: '2026-09-07T02:30:00.000Z', html };
await mkdir('dist', { recursive: true });
await writeFile('dist/demo.xml', buildRss([article], { title: '飞书 RSS 示例', description: '本地合成数据，不连接飞书' }));
await writeFile('dist/demo.html', `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RSS 排版示例</title><style>body{max-width:720px;margin:48px auto;padding:0 24px;font:18px/1.7 system-ui;color:#222}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:20px;color:#555}pre{overflow:auto;padding:16px;background:#f5f5f5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px 16px;text-align:left}td p,th p{margin:0}a{color:#2455ad}</style><body>${html}</body></html>`);
console.log('已生成 dist/demo.xml 和 dist/demo.html（仅合成数据）。');
