import { syncConfig } from './config.js';
import { AppError, safeError } from './errors.js';
import { FeishuClient } from './feishu.js';
import { renderDocument, safeUrl } from './render.js';
import { buildRss } from './rss.js';

function metadata(file) {
  const time = Number(file.created_time) * 1000;
  const url = safeUrl(file.url, false);
  if (typeof file.token !== 'string' || !file.token || typeof file.name !== 'string' || !url || !Number.isFinite(time) || time <= 0 || Number.isNaN(new Date(time).getTime())) {
    throw new AppError('FILE_METADATA', '文档缺少有效 ID、标题、原文链接或创建时间。');
  }
  return { id: file.token, title: file.name, url, published: new Date(time).toISOString() };
}

export async function syncFeed(env, options = {}) {
  const config = syncConfig(env);
  const client = new FeishuClient(env, options);
  const previous = await env.FEED_KV.get('snapshot', 'json');
  if (previous && (previous.version !== 1 || !Array.isArray(previous.seen) || !Array.isArray(previous.articles))) {
    throw new AppError('STATE_ERROR', '已有订阅快照格式异常，未覆盖原数据。');
  }
  // Finish discovery before writing any state: partial listings must never become baselines.
  const listing = await client.listFiles();
  const docs = [...new Map(listing.filter(f => f.type === 'docx').map(f => [f.token, f])).values()].map(metadata)
    .sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
  const seen = new Set(previous?.seen ?? docs.slice(config.initialItems).map(f => f.id));
  const pending = docs.filter(doc => !seen.has(doc.id));
  if (previous) pending.reverse(); // Catch up oldest first after initial newest-first import.
  const articles = [...(previous?.articles ?? [])];
  const errors = [];
  let added = 0;
  for (const doc of pending.slice(0, config.maxNewItems)) {
    try {
      const html = renderDocument(await client.getBlocks(doc.id));
      if (!html.replace(/<[^>]*>/g, '').trim()) throw new AppError('EMPTY_DOCUMENT', '文档正文为空，可能尚未写完，留待后续重试。');
      articles.push({ ...doc, html });
      seen.add(doc.id);
      added++;
    } catch (error) {
      errors.push(safeError(error));
      if (error instanceof AppError && error.code === 'REQUEST_BUDGET') break;
    }
  }
  articles.sort((a, b) => b.published.localeCompare(a.published) || a.id.localeCompare(b.id));
  const retained = articles.slice(0, config.feedItems);
  const rss = buildRss(retained, config);
  if (!previous || added > 0 || rss !== previous.rss) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rss));
    const etag = `"${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}"`;
    const snapshot = JSON.stringify({ version: 1, seen: [...seen], articles: retained, rss, etag });
    if (new TextEncoder().encode(snapshot).length > 20 * 1024 * 1024) throw new AppError('STATE_SIZE', '订阅快照超过 20 MB，请减少 FEED_ITEMS。');
    // One KV write publishes content and successful IDs together; failed writes leave old RSS usable.
    await env.FEED_KV.put('snapshot', snapshot);
  }
  return { added, pending: pending.length - added, skippedTypes: listing.filter(f => f.type !== 'docx').length, errors };
}
