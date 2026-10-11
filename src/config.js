import { AppError } from './errors.js';

export function required(env, name) {
  if (typeof env[name] !== 'string' || !env[name].trim()) throw new AppError('CONFIG_ERROR', `缺少配置 ${name}。`);
  return env[name].trim();
}

export function feedConfig(env) {
  const token = required(env, 'FEED_TOKEN');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new AppError('CONFIG_ERROR', 'FEED_TOKEN 必须为 32–256 位 URL 安全随机字符。');
  if (!env.FEED_KV?.get || !env.FEED_KV?.put) throw new AppError('CONFIG_ERROR', '缺少 FEED_KV 绑定。');
  return { token };
}

export function syncConfig(env) {
  feedConfig(env);
  function integer(name, fallback, max) {
    const value = String(env[name] ?? fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new AppError('CONFIG_ERROR', `${name} 必须为 1–${max} 的整数。`);
    return Number(value);
  }
  return {
    title: env.FEED_TITLE?.trim() || '飞书文档订阅',
    description: env.FEED_DESCRIPTION?.trim() || '工作日新增文档',
    feedItems: integer('FEED_ITEMS', 50, 200),
    initialItems: integer('INITIAL_ITEMS', 20, 200),
    maxNewItems: integer('MAX_NEW_ITEMS', 5, 20),
  };
}
