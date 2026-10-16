const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });
}

export function error(message, status = 400, errors) {
  return json({ success: false, message, ...(errors ? { errors } : {}) }, status);
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json.');
  try {
    return await request.json();
  } catch (_) {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function positiveId(value) {
  return /^\d+$/.test(String(value || '')) && Number(value) > 0;
}

export function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function publicProduct(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    shortDescription: row.short_description || '',
    price: Number(row.price || 0),
    oldPrice: row.old_price == null ? null : Number(row.old_price),
    imageUrl: row.image_url || '',
    category: row.category,
    stock: Number(row.stock || 0),
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    saleActive: Boolean(row.sale_active),
    salePrice: row.sale_price == null ? null : Number(row.sale_price),
    saleEndsAt: row.sale_ends_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseStoredJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

export async function enforceRateLimit(env, key, max, windowSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE rate_key = ?')
    .bind(key).first();

  if (!row || now - Number(row.window_start) >= windowSeconds) {
    await env.DB.prepare(`
      INSERT INTO rate_limits (rate_key, count, window_start) VALUES (?, 1, ?)
      ON CONFLICT(rate_key) DO UPDATE SET count = 1, window_start = excluded.window_start
    `).bind(key, now).run();
    return;
  }

  if (Number(row.count) >= max) throw new HttpError(429, 'Too many requests. Please try again later.');
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE rate_key = ?').bind(key).run();
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || 'local';
}
