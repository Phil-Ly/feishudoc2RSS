import { feedConfig } from './config.js';
import { AppError, safeError } from './errors.js';
import { syncFeed } from './sync.js';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

function sameToken(provided, expected) {
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const respond = (text, status, headers = {}) => new Response(request.method === 'HEAD' ? null : text, { status, headers: { ...PRIVATE_HEADERS, ...headers } });
    if (url.pathname === '/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      return respond(JSON.stringify({ ok: true }), 200, { 'Content-Type': 'application/json' });
    }
    const match = /^\/feed\/([A-Za-z0-9_-]+)\.xml$/.exec(url.pathname);
    if (!match) return respond('Not found', 404);
    try {
      const { token } = feedConfig(env);
      if (!sameToken(match[1], token)) return respond('Not found', 404);
      if (request.method !== 'GET' && request.method !== 'HEAD') return respond('Method not allowed', 405, { Allow: 'GET, HEAD' });
      const snapshot = await env.FEED_KV.get('snapshot', 'json');
      if (!snapshot?.rss || !snapshot?.etag) return respond('订阅尚未就绪，请等待首次成功同步。', 503, { 'Retry-After': '3600' });
      const headers = { ...PRIVATE_HEADERS, 'Content-Type': 'application/rss+xml; charset=utf-8', ETag: snapshot.etag };
      const candidates = (request.headers.get('If-None-Match') ?? '').split(',').map(tag => tag.trim().replace(/^W\//, ''));
      if (candidates.includes(snapshot.etag) || candidates.includes('*')) return new Response(null, { status: 304, headers });
      return new Response(request.method === 'HEAD' ? null : snapshot.rss, { headers });
    } catch (error) {
      return respond(safeError(error).message, 503);
    }
  },

  async scheduled(_controller, env) {
    try {
      const result = await syncFeed(env);
      console.log(JSON.stringify({ event: 'sync', ...result }));
      if (result.errors.length) throw new AppError('SYNC_PARTIAL', '部分文档同步失败，已保留待重试状态，请检查同步日志中的错误码。');
    } catch (error) {
      const safe = safeError(error);
      console.error(JSON.stringify({ event: 'sync_failed', ...safe }));
      // Mark the scheduled invocation failed without leaking upstream messages or credentials.
      throw new AppError(safe.code, safe.message);
    }
  },
};
