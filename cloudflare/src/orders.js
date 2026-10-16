import { HttpError, clampInt, clientIp, enforceRateLimit, error, json, parseStoredJson, positiveId, readJson } from './utils.js';
import { requireAdmin } from './auth.js';
import { computeLine, withProductSale } from './promo-core.js';
import { loadActivePromotions } from './promotions.js';
import { resolvePromoCode } from './promo-codes.js';

const STATUSES = new Set(['new', 'confirmed', 'shipping', 'delivered', 'cancelled']);

function validateOrder(data) {
  const errors = [];
  const fullName = String(data.fullName || '').trim();
  const phone = String(data.phone || '').trim();
  const city = String(data.city || '').trim();
  const address = String(data.address || '').trim();
  if (fullName.length < 2 || fullName.length > 150) errors.push({ field: 'fullName', message: 'Name must be 2-150 characters' });
  if (!/^01[0125][0-9]{8}$/.test(phone)) errors.push({ field: 'phone', message: 'Enter a valid Egyptian mobile number' });
  if (!city || city.length > 100) errors.push({ field: 'city', message: 'City is required (max 100 characters)' });
  if (!address) errors.push({ field: 'address', message: 'Address is required' });
  if (String(data.notes || '').length > 500) errors.push({ field: 'notes', message: 'Notes max 500 characters' });
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 50) {
    errors.push({ field: 'items', message: 'Order must include 1-50 items' });
  } else {
    data.items.forEach((item, index) => {
      if (!String(item.itemType || '').trim()) errors.push({ field: `items.${index}.itemType`, message: 'Item type is required' });
      if (!String(item.itemName || '').trim() || String(item.itemName).length > 150) errors.push({ field: `items.${index}.itemName`, message: 'Item name is required (max 150)' });
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 50) errors.push({ field: `items.${index}.quantity`, message: 'Quantity must be 1-50' });
      if (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) errors.push({ field: `items.${index}.unitPrice`, message: 'Unit price must be positive' });
      if (item.cableType && !['Type-C', 'iPhone', 'Micro USB'].includes(item.cableType)) errors.push({ field: `items.${index}.cableType`, message: 'Invalid cable type' });
    });
  }
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
}

function formatOrder(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    city: row.city,
    address: row.address,
    notes: row.notes || '',
    adminNotes: row.admin_notes || '',
    subtotal: Number(row.subtotal || 0),
    shippingFee: Number(row.shipping_fee || 0),
    discount: Number(row.discount || 0),
    promoCode: row.promo_code || null,
    promoCodeDiscount: Number(row.promo_code_discount || 0),
    total: Number(row.total || 0),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: [],
  };
}

function formatItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id || null,
    itemType: row.item_type,
    itemName: row.item_name,
    cableType: row.cable_type || null,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price || 0),
    totalPrice: Number(row.total_price || 0),
    selectedOptions: parseStoredJson(row.selected_options),
  };
}

async function attachItems(env, orders) {
  if (!orders.length) return orders;
  const ids = orders.map((order) => order.id);
  const result = await env.DB.prepare(`
    SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id
  `).bind(...ids).all();
  const grouped = new Map();
  result.results.forEach((row) => {
    if (!grouped.has(row.order_id)) grouped.set(row.order_id, []);
    grouped.get(row.order_id).push(formatItem(row));
  });
  return orders.map((order) => ({ ...order, items: grouped.get(order.id) || [] }));
}

async function findOrder(env, id) {
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!row) return null;
  const [order] = await attachItems(env, [formatOrder(row)]);
  return order;
}

function makeOrderId() {
  const random = crypto.getRandomValues(new Uint16Array(1))[0] % 1000;
  return Date.now() * 1000 + random;
}

// Load the trusted DB price for every product referenced by the incoming items.
async function loadPricedProducts(env, items) {
  const ids = Array.from(new Set(items
    .map((item) => (positiveId(item.productId) ? Number(item.productId) : null))
    .filter((id) => id != null)));
  if (!ids.length) return new Map();
  const rows = await env.DB.prepare(
    `SELECT id, price, is_active, sale_active, sale_price, sale_ends_at FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).bind(...ids).all();
  return new Map(rows.results.map((row) => [Number(row.id), row]));
}

export async function createOrder(request, env, ctx) {
  await enforceRateLimit(env, `order:${clientIp(request)}`, 10, 10 * 60);
  const data = await readJson(request);
  validateOrder(data);

  // Pricing is decided here, never from the browser: every line must be an active
  // product, priced from the DB and the live promotions; the client unitPrice is
  // ignored. (Lines without a known active product used to keep the price the
  // browser sent, so a crafted request could order anything at 0 EGP.)
  const now = Date.now();
  const [products, promotions] = await Promise.all([
    loadPricedProducts(env, data.items),
    loadActivePromotions(env),
  ]);
  const unavailable = [];
  data.items.forEach((item, index) => {
    const product = positiveId(item.productId) ? products.get(Number(item.productId)) : null;
    if (!product || !Number(product.is_active)) {
      unavailable.push({ field: `items.${index}.productId`, message: 'This product is no longer available' });
    }
  });
  if (unavailable.length) throw new HttpError(400, 'Validation failed', unavailable);

  let subtotal = 0;
  let discount = 0;
  const itemRows = data.items.map((item) => {
    const quantity = Math.max(1, Math.floor(Number(item.quantity)));
    const product = positiveId(item.productId) ? products.get(Number(item.productId)) : null;

    if (product && Number(product.is_active)) {
      const priced = {
        id: Number(item.productId),
        price: Number(product.price),
        saleActive: product.sale_active,
        salePrice: product.sale_price,
        saleEndsAt: product.sale_ends_at,
      };
      const line = computeLine(priced, quantity, withProductSale(promotions, priced), now);
      subtotal += line.originalTotal;
      discount += line.discount;
      const options = {};
      if (item.cableType) options.cableType = item.cableType;
      if (line.appliedPromotion && (line.discount > 0 || line.freeQty > 0)) {
        options.promotion = {
          ...line.appliedPromotion,
          originalUnitPrice: line.originalUnitPrice,
          saleUnitPrice: line.saleUnitPrice,
          freeQty: line.freeQty,
          paidQty: line.paidQty,
          lineDiscount: line.discount,
        };
      }
      return {
        productId: Number(item.productId),
        itemType: item.itemType || 'product',
        itemName: String(item.itemName).trim(),
        cableType: item.cableType || null,
        quantity,
        unitPrice: line.originalUnitPrice,
        totalPrice: line.lineTotal,
        selectedOptions: Object.keys(options).length ? JSON.stringify(options) : null,
      };
    }

    // Unreachable after the availability check above; never price from the browser.
    throw new HttpError(400, 'Validation failed', [{ field: 'items', message: 'This product is no longer available' }]);
  });

  subtotal = Math.round((subtotal + Number.EPSILON) * 100) / 100;
  discount = Math.round((discount + Number.EPSILON) * 100) / 100;
  const shippingFee = Math.max(0, Number(data.shippingFee || 0));

  // Apply a promo code (if any) ON TOP of item-level offers. The code + discount are
  // re-validated here against the server clock and DB — the browser's claim is ignored.
  let promoCode = null;
  let promoCodeDiscount = 0;
  if (data.promoCode) {
    const discountedSubtotal = Math.max(0, Math.round((subtotal - discount + Number.EPSILON) * 100) / 100);
    const resolved = await resolvePromoCode(env, data.promoCode, discountedSubtotal);
    if (resolved.ok && resolved.discount > 0) {
      promoCode = resolved.code;
      promoCodeDiscount = resolved.discount;
    }
  }

  const totalDiscount = Math.round((discount + promoCodeDiscount + Number.EPSILON) * 100) / 100;
  const total = Math.max(0, Math.round((subtotal - totalDiscount + shippingFee + Number.EPSILON) * 100) / 100);
  const orderId = makeOrderId();
  const statements = [env.DB.prepare(`
    INSERT INTO orders
      (id, full_name, phone, city, address, notes, subtotal, shipping_fee, discount, total, promo_code, promo_code_discount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    orderId, String(data.fullName).trim(), String(data.phone).trim(), String(data.city).trim(),
    String(data.address).trim(), String(data.notes || '').trim(), subtotal, shippingFee, totalDiscount, total,
    promoCode, promoCodeDiscount,
  )];
  if (promoCode) {
    statements.push(env.DB.prepare('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?').bind(promoCode));
  }

  itemRows.forEach((item) => {
    statements.push(env.DB.prepare(`
      INSERT INTO order_items
        (order_id, product_id, item_type, item_name, cable_type, quantity, unit_price, total_price, selected_options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      orderId, item.productId, item.itemType, item.itemName,
      item.cableType, item.quantity, item.unitPrice, item.totalPrice, item.selectedOptions,
    ));
  });

  await env.DB.batch(statements);
  if (env.WHATSAPP_API_TOKEN && env.WHATSAPP_PHONE_ID) {
    ctx.waitUntil(sendWhatsAppConfirmation(env, { ...data, orderId, total }).catch(console.error));
  }
  return json({ success: true, message: 'Order placed successfully!', data: await findOrder(env, orderId) }, 201);
}

async function sendWhatsAppConfirmation(env, order) {
  const phone = String(order.phone).replace(/\D/g, '').replace(/^0/, '20');
  const message = `STAR order #${order.orderId}\nThank you ${order.fullName}. Total: ${order.total} EGP.`;
  await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } }),
  });
}

export async function listOrders(request, env) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const page = clampInt(url.searchParams.get('page'), 1, 1, 100000);
  const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100);
  const offset = (page - 1) * limit;
  const status = url.searchParams.get('status');
  const search = String(url.searchParams.get('search') || '').trim();
  const conditions = [];
  const values = [];
  if (status) { conditions.push('status = ?'); values.push(status); }
  if (search) {
    conditions.push('(full_name LIKE ? OR phone LIKE ? OR city LIKE ? OR CAST(id AS TEXT) LIKE ?)');
    values.push(...Array(4).fill(`%${search}%`));
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM orders ${where}`).bind(...values).first();
  const result = await env.DB.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...values, limit, offset).all();
  const orders = await attachItems(env, result.results.map(formatOrder));
  const total = Number(countRow.total || 0);
  return json({ success: true, orders, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
}

export async function getOrder(request, env, id) {
  await requireAdmin(request, env);
  const order = await findOrder(env, id);
  return order ? json({ success: true, data: order }) : error('Order not found.', 404);
}

export async function updateOrderStatus(request, env, id) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  if (!STATUSES.has(body.status)) throw new HttpError(400, 'Validation failed', [{ field: 'status', message: 'Invalid status' }]);
  const result = await env.DB.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body.status, id).run();
  if (!result.meta.changes) return error('Order not found.', 404);
  return json({ success: true, message: `Status updated to "${body.status}".`, data: await findOrder(env, id) });
}

export async function updateOrderNotes(request, env, id) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const notes = String(body.adminNotes || '').trim();
  if (notes.length > 1000) throw new HttpError(400, 'Validation failed', [{ field: 'adminNotes', message: 'Admin notes max 1000 characters' }]);
  const result = await env.DB.prepare('UPDATE orders SET admin_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(notes, id).run();
  if (!result.meta.changes) return error('Order not found.', 404);
  return json({ success: true, message: 'Admin notes saved.', data: await findOrder(env, id) });
}

export async function deleteOrder(request, env, id) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare('DELETE FROM orders WHERE id = ?').bind(id).run();
  return result.meta.changes ? json({ success: true, message: 'Order deleted.' }) : error('Order not found.', 404);
}

export async function orderStats(request, env) {
  await requireAdmin(request, env);
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_orders,
      SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'shipping' THEN 1 ELSE 0 END) AS shipping,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      COALESCE(SUM(total), 0) AS revenue
    FROM orders
  `).first();
  return json({ success: true, data: {
    total: Number(row.total || 0), new: Number(row.new_orders || 0), confirmed: Number(row.confirmed || 0),
    shipping: Number(row.shipping || 0), delivered: Number(row.delivered || 0),
    cancelled: Number(row.cancelled || 0), revenue: Number(row.revenue || 0),
  } });
}
