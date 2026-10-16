import { HttpError, clientIp, enforceRateLimit, error, json, readJson } from './utils.js';
import { requireAdmin } from './auth.js';

const TYPES = new Set(['percent', 'fixed']);

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// DB row -> API object (camelCase).
export function publicPromoCode(row) {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    isActive: Boolean(row.is_active),
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    minOrderSubtotal: Number(row.min_order_subtotal || 0),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    usedCount: Number(row.used_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isoOrNull(value) {
  if (value == null || value === '') return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new HttpError(400, 'Validation failed', [{ field: 'date', message: 'Invalid date/time' }]);
  return new Date(time).toISOString();
}

function validatePromoCode(data) {
  const errors = [];
  const code = normalizeCode(data.code);
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) errors.push({ field: 'code', message: 'Code must be 2-32 letters/numbers (A-Z, 0-9, -, _)' });
  if (!TYPES.has(data.discountType)) errors.push({ field: 'discountType', message: 'Invalid discount type' });
  const value = Number(data.discountValue);
  if (!Number.isFinite(value) || value <= 0) errors.push({ field: 'discountValue', message: 'Discount value must be greater than 0' });
  else if (data.discountType === 'percent' && value > 100) errors.push({ field: 'discountValue', message: 'Percentage cannot exceed 100' });
  const minOrder = data.minOrderSubtotal == null || data.minOrderSubtotal === '' ? 0 : Number(data.minOrderSubtotal);
  if (!Number.isFinite(minOrder) || minOrder < 0) errors.push({ field: 'minOrderSubtotal', message: 'Minimum order must be 0 or more' });
  const maxUses = data.maxUses == null || data.maxUses === '' ? null : Number(data.maxUses);
  if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1)) errors.push({ field: 'maxUses', message: 'Max uses must be at least 1' });
  const startsAt = isoOrNull(data.startsAt);
  const endsAt = isoOrNull(data.endsAt);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) errors.push({ field: 'endsAt', message: 'End time must be after the start time' });
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  return { code, startsAt, endsAt, minOrder, maxUses, value };
}

// Decide whether a code row applies to a subtotal right now. Returns { ok, reason, discount }.
export function evaluateCode(row, subtotal, nowMs) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.is_active) return { ok: false, reason: 'inactive' };
  const start = row.starts_at ? Date.parse(row.starts_at) : null;
  const end = row.ends_at ? Date.parse(row.ends_at) : null;
  if (start != null && nowMs < start) return { ok: false, reason: 'not_started' };
  if (end != null && nowMs >= end) return { ok: false, reason: 'expired' };
  if (row.max_uses != null && Number(row.used_count) >= Number(row.max_uses)) return { ok: false, reason: 'usage_limit' };
  const sub = Math.max(0, Number(subtotal) || 0);
  if (sub < Number(row.min_order_subtotal || 0)) return { ok: false, reason: 'min_order', minOrder: Number(row.min_order_subtotal || 0) };
  let discount = row.discount_type === 'percent'
    ? sub * (Number(row.discount_value) || 0) / 100
    : Number(row.discount_value) || 0;
  discount = round2(Math.min(discount, sub));
  return { ok: true, discount, code: row.code };
}

async function findByCode(env, code) {
  return env.DB.prepare('SELECT * FROM promo_codes WHERE code = ?').bind(normalizeCode(code)).first();
}

// Trusted resolver used by the order engine (server clock, current DB state).
export async function resolvePromoCode(env, code, subtotal) {
  const normalized = normalizeCode(code);
  if (!normalized) return { ok: false, reason: 'not_found' };
  const row = await findByCode(env, normalized);
  return evaluateCode(row, subtotal, Date.now());
}

export async function incrementCodeUsage(env, code) {
  await env.DB.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').bind(normalizeCode(code)).run();
}

// Public: customer checks a code against their current subtotal.
export async function validatePromoCodePublic(request, env) {
  await enforceRateLimit(env, `promocode:${clientIp(request)}`, 30, 10 * 60);
  const data = await readJson(request);
  const row = await findByCode(env, data.code);
  const result = evaluateCode(row, data.subtotal, Date.now());
  if (!result.ok) return json({ success: false, valid: false, reason: result.reason, minOrder: result.minOrder });
  return json({
    success: true,
    valid: true,
    data: {
      code: result.code,
      discount: result.discount,
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      minOrderSubtotal: Number(row.min_order_subtotal || 0),
    },
  });
}

// ----- Admin CRUD -----
export async function listPromoCodes(request, env) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare('SELECT * FROM promo_codes ORDER BY id DESC').all();
  const data = result.results.map(publicPromoCode);
  return json({ success: true, data, count: data.length, serverTime: new Date().toISOString() });
}

function bindValues(data, cleaned) {
  return [
    cleaned.code,
    data.discountType,
    cleaned.value,
    data.isActive === false ? 0 : 1,
    cleaned.startsAt,
    cleaned.endsAt,
    cleaned.minOrder,
    cleaned.maxUses,
  ];
}

const COLUMNS = 'code, discount_type, discount_value, is_active, starts_at, ends_at, min_order_subtotal, max_uses';

export async function createPromoCode(request, env) {
  await requireAdmin(request, env);
  const data = await readJson(request);
  const cleaned = validatePromoCode(data);
  try {
    const result = await env.DB.prepare(`INSERT INTO promo_codes (${COLUMNS}) VALUES (${Array(8).fill('?').join(', ')})`)
      .bind(...bindValues(data, cleaned)).run();
    const row = await env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(result.meta.last_row_id).first();
    return json({ success: true, message: 'Promo code created.', data: publicPromoCode(row) }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return error('A promo code with this code already exists.', 400);
    throw err;
  }
}

export async function updatePromoCode(request, env, id) {
  await requireAdmin(request, env);
  const existing = await env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first();
  if (!existing) return error('Promo code not found.', 404);
  const data = await readJson(request);
  const cleaned = validatePromoCode(data);
  const assignments = COLUMNS.split(',').map((c) => `${c.trim()} = ?`).join(', ');
  try {
    await env.DB.prepare(`UPDATE promo_codes SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(...bindValues(data, cleaned), id).run();
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return error('A promo code with this code already exists.', 400);
    throw err;
  }
  const row = await env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first();
  return json({ success: true, message: 'Promo code updated.', data: publicPromoCode(row) });
}

export async function togglePromoCode(request, env, id) {
  await requireAdmin(request, env);
  const existing = await env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first();
  if (!existing) return error('Promo code not found.', 404);
  const body = await readJson(request);
  const isActive = body.isActive ? 1 : 0;
  await env.DB.prepare('UPDATE promo_codes SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(isActive, id).run();
  const row = await env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first();
  return json({ success: true, message: isActive ? 'Code activated.' : 'Code paused.', data: publicPromoCode(row) });
}

export async function deletePromoCode(request, env, id) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare('DELETE FROM promo_codes WHERE id = ?').bind(id).run();
  return result.meta.changes ? json({ success: true, message: 'Promo code deleted.' }) : error('Promo code not found.', 404);
}
