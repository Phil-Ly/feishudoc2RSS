import { escapeHtml, cleanText } from './render.js';

export function buildRss(articles, { title, description }) {
  const items = articles.map(article => `<item>
<title>${escapeHtml(article.title)}</title>
<link>${escapeHtml(article.url)}</link>
<guid isPermaLink="false">${escapeHtml(`feishu:${article.id}`)}</guid>
<pubDate>${new Date(article.published).toUTCString()}</pubDate>
<content:encoded><![CDATA[${cleanText(article.html).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
</item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
<title>${escapeHtml(title)}</title>
<link>https://www.feishu.cn/</link>
<description>${escapeHtml(description)}</description>
<language>zh-cn</language>
${items}
</channel>
</rss>`;
}
