import { HttpError, error, json, parseStoredJson, readJson } from './utils.js';
import { requireAdmin } from './auth.js';
import { isPromotionLive } from './promo-core.js';

const OFFER_TYPES = new Set(['bogo', 'percent', 'fixed', 'special_price']);
const APPLIES_TO = new Set(['all', 'products']);

// DB row -> API object (camelCase). Kept in sync with the fields promo-core.js reads.
export function publicPromotion(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    badgeText: row.badge_text || '',
    offerType: row.offer_type,
    buyQty: row.buy_qty == null ? null : Number(row.buy_qty),
    getQty: row.get_qty == null ? null : Number(row.get_qty),
    discountPercent: row.discount_percent == null ? null : Number(row.discount_percent),
    discountAmount: row.discount_amount == null ? null : Number(row.discount_amount),
    specialPrice: row.special_price == null ? null : Number(row.special_price),
    appliesTo: row.applies_to,
    productIds: parseStoredJson(row.product_ids, []) || [],
    priority: Number(row.priority || 0),
    allowStacking: Boolean(row.allow_stacking),
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    isActive: Boolean(row.is_active),
    maxUsesPerOrder: row.max_uses_per_order == null ? null : Number(row.max_uses_per_order),
    maxFreeQty: row.max_free_qty == null ? null : Number(row.max_free_qty),
    availableToAll: Boolean(row.available_to_all),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function num(value) {
  return value === '' || value == null ? null : Number(value);
}

function isoOrNull(value) {
  if (value == null || value === '') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new HttpError(400, 'Validation failed', [{ field: 'date', message: 'Invalid date/time' }]);
  return new Date(time).toISOString();
}

function validatePromotion(data) {
  const errors = [];
  const title = String(data.title || '').trim();
  if (!title || title.length > 120) errors.push({ field: 'title', message: 'Title is required (max 120)' });
  if (String(data.description || '').length > 400) errors.push({ field: 'description', message: 'Description max 400 characters' });
  if (String(data.badgeText || '').length > 40) errors.push({ field: 'badgeText', message: 'Badge max 40 characters' });

  if (!OFFER_TYPES.has(data.offerType)) errors.push({ field: 'offerType', message: 'Invalid offer type' });

  if (data.offerType === 'bogo') {
    const buy = num(data.buyQty);
    const get = num(data.getQty);
    if (!Number.isInteger(buy) || buy < 1) errors.push({ field: 'buyQty', message: 'Paid quantity must be at least 1' });
    if (!Number.isInteger(get) || get < 1) errors.push({ field: 'getQty', message: 'Free quantity must be at least 1' });
  } else if (data.offerType === 'percent') {
    const pct = num(data.discountPercent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) errors.push({ field: 'discountPercent', message: 'Percentage must be between 1 and 100' });
  } else if (data.offerType === 'fixed') {
    const amt = num(data.discountAmount);
    if (!Number.isFinite(amt) || amt <= 0) errors.push({ field: 'discountAmount', message: 'Discount amount must be greater than 0' });
  } else if (data.offerType === 'special_price') {
    const sp = num(data.specialPrice);
    if (!Number.isFinite(sp) || sp < 0) errors.push({ field: 'specialPrice', message: 'Special price must be 0 or more' });
  }

  if (!APPLIES_TO.has(data.appliesTo)) errors.push({ field: 'appliesTo', message: 'Invalid target' });
  if (data.appliesTo === 'products') {
    const ids = Array.isArray(data.productIds) ? data.productIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
    if (!ids.length) errors.push({ field: 'productIds', message: 'Select at least one product' });
  }

  const priority = num(data.priority);
  if (priority != null && (!Number.isInteger(priority) || priority < 0 || priority > 1000)) errors.push({ field: 'priority', message: 'Priority must be 0-1000' });

  const maxUses = num(data.maxUsesPerOrder);
  if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1)) errors.push({ field: 'maxUsesPerOrder', message: 'Max uses must be at least 1' });
  const maxFree = num(data.maxFreeQty);
  if (maxFree != null && (!Number.isInteger(maxFree) || maxFree < 1)) errors.push({ field: 'maxFreeQty', message: 'Max free quantity must be at least 1' });

  const startsAt = isoOrNull(data.startsAt);
  const endsAt = isoOrNull(data.endsAt);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.push({ field: 'endsAt', message: 'End time must be after the start time' });
  }

  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  return { title, startsAt, endsAt };
}

function bindValues(data, cleaned) {
  const ids = data.appliesTo === 'products'
    ? JSON.stringify(Array.from(new Set((data.productIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))))
    : null;
  return [
    cleaned.title,
    String(data.description || '').trim() || null,
    String(data.badgeText || '').trim() || null,
    data.offerType,
    data.offerType === 'bogo' ? Math.floor(Number(data.buyQty)) : null,
    data.offerType === 'bogo' ? Math.floor(Number(data.getQty)) : null,
    data.offerType === 'percent' ? Number(data.discountPercent) : null,
    data.offerType === 'fixed' ? Number(data.discountAmount) : null,
    data.offerType === 'special_price' ? Number(data.specialPrice) : null,
    data.appliesTo,
    ids,
    num(data.priority) == null ? 0 : Math.floor(Number(data.priority)),
    data.allowStacking ? 1 : 0,
    cleaned.startsAt,
    cleaned.endsAt,
    data.isActive === false ? 0 : 1,
    num(data.maxUsesPerOrder) == null ? null : Math.floor(Number(data.maxUsesPerOrder)),
    num(data.maxFreeQty) == null ? null : Math.floor(Number(data.maxFreeQty)),
    data.availableToAll === false ? 0 : 1,
  ];
}

const COLUMNS = `title, description, badge_text, offer_type, buy_qty, get_qty,
  discount_percent, discount_amount, special_price, applies_to, product_ids,
  priority, allow_stacking, starts_at, ends_at, is_active, max_uses_per_order,
  max_free_qty, available_to_all`;

async function findPromotion(env, id) {
  const row = await env.DB.prepare('SELECT * FROM promotions WHERE id = ?').bind(id).first();
  return row ? publicPromotion(row) : null;
}

// Trusted, current promotion list used by the order pricing engine (server clock).
export async function loadActivePromotions(env) {
  const result = await env.DB.prepare('SELECT * FROM promotions WHERE is_active = 1').all();
  return result.results.map(publicPromotion);
}

// Public endpoint for the storefront: only offers that are live right now.
export async function listActivePromotions(request, env) {
  const now = Date.now();
  const all = await loadActivePromotions(env);
  const live = all.filter((p) => isPromotionLive(p, now));
  return json({ success: true, data: live, count: live.length, serverTime: new Date(now).toISOString() });
}

export async function listPromotions(request, env) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare('SELECT * FROM promotions ORDER BY priority DESC, id DESC').all();
  const data = result.results.map(publicPromotion);
  return json({ success: true, data, count: data.length, serverTime: new Date().toISOString() });
}

export async function createPromotion(request, env) {
  await requireAdmin(request, env);
  const data = await readJson(request);
  const cleaned = validatePromotion(data);
  const result = await env.DB.prepare(`INSERT INTO promotions (${COLUMNS})
    VALUES (${Array(19).fill('?').join(', ')})`).bind(...bindValues(data, cleaned)).run();
  return json({ success: true, message: 'Promotion created.', data: await findPromotion(env, result.meta.last_row_id) }, 201);
}

export async function updatePromotion(request, env, id) {
  await requireAdmin(request, env);
  if (!await findPromotion(env, id)) return error('Promotion not found.', 404);
  const data = await readJson(request);
  const cleaned = validatePromotion(data);
  const assignments = COLUMNS.split(',').map((c) => `${c.trim()} = ?`).join(', ');
  await env.DB.prepare(`UPDATE promotions SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(...bindValues(data, cleaned), id).run();
  return json({ success: true, message: 'Promotion updated.', data: await findPromotion(env, id) });
}

// Lightweight toggle used by the on/off switch in the list.
export async function togglePromotion(request, env, id) {
  await requireAdmin(request, env);
  if (!await findPromotion(env, id)) return error('Promotion not found.', 404);
  const body = await readJson(request);
  const isActive = body.isActive ? 1 : 0;
  await env.DB.prepare('UPDATE promotions SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(isActive, id).run();
  return json({ success: true, message: isActive ? 'Promotion activated.' : 'Promotion paused.', data: await findPromotion(env, id) });
}

export async function deletePromotion(request, env, id) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare('DELETE FROM promotions WHERE id = ?').bind(id).run();
  return result.meta.changes ? json({ success: true, message: 'Promotion deleted.' }) : error('Promotion not found.', 404);
}
