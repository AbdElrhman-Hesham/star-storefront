import { HttpError, error, json, publicProduct, readJson } from './utils.js';
import { requireAdmin } from './auth.js';

const CATEGORIES = new Set(['Featured', 'New Arrivals', 'Best Sellers', 'Offers', 'Other']);

function validateProduct(data, patch = false) {
  const errors = [];
  const required = (key, message) => {
    if (!patch && (data[key] === undefined || data[key] === null || data[key] === '')) errors.push({ field: key, message });
  };
  required('name', 'Name is required');
  required('slug', 'Slug is required');
  required('price', 'Price is required');
  required('category', 'Category is required');

  if (data.name !== undefined && (!String(data.name).trim() || String(data.name).length > 150)) errors.push({ field: 'name', message: 'Name must be 1-150 characters' });
  if (data.slug !== undefined && !/^[a-z0-9-]+$/.test(String(data.slug))) errors.push({ field: 'slug', message: 'Invalid slug format' });
  if (data.price !== undefined && (!Number.isFinite(Number(data.price)) || Number(data.price) < 0)) errors.push({ field: 'price', message: 'Price must be positive' });
  if (data.oldPrice != null && (!Number.isFinite(Number(data.oldPrice)) || Number(data.oldPrice) < 0)) errors.push({ field: 'oldPrice', message: 'Old price must be positive' });
  if (data.category !== undefined && !CATEGORIES.has(data.category)) errors.push({ field: 'category', message: 'Invalid category' });
  if (data.stock !== undefined && (!Number.isInteger(Number(data.stock)) || Number(data.stock) < 0)) errors.push({ field: 'stock', message: 'Stock must be a non-negative integer' });
  if (data.imageUrl != null && String(data.imageUrl).length > 500) errors.push({ field: 'imageUrl', message: 'Image URL max 500 characters' });
  if (data.shortDescription != null && String(data.shortDescription).length > 300) errors.push({ field: 'shortDescription', message: 'Short description max 300 characters' });
  // Per-product quick sale
  if (data.salePrice != null && data.salePrice !== '' && (!Number.isFinite(Number(data.salePrice)) || Number(data.salePrice) < 0)) errors.push({ field: 'salePrice', message: 'Sale price must be 0 or more' });
  if (data.saleActive && (data.salePrice == null || data.salePrice === '')) errors.push({ field: 'salePrice', message: 'Enter a sale price to put the product on sale' });
  if (data.saleActive && data.price !== undefined && data.salePrice != null && data.salePrice !== '' && Number(data.salePrice) >= Number(data.price)) errors.push({ field: 'salePrice', message: 'Sale price must be lower than the price' });
  if (data.saleEndsAt != null && data.saleEndsAt !== '' && !Number.isFinite(Date.parse(data.saleEndsAt))) errors.push({ field: 'saleEndsAt', message: 'Invalid sale end date' });
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
}

function saleEndsIso(value) {
  if (value == null || value === '') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

async function findById(env, id, includeInactive = true) {
  const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ? ${includeInactive ? '' : 'AND is_active = 1'}`).bind(id).first();
  return row ? publicProduct(row) : null;
}

export async function listProducts(request, env, adminOnly = false) {
  let includeInactive = adminOnly;
  if (adminOnly) await requireAdmin(request, env);
  else includeInactive = Boolean(await requireAdmin(request, env, true));

  const url = new URL(request.url);
  const conditions = [];
  const values = [];
  if (!includeInactive) conditions.push('is_active = 1');
  if (url.searchParams.get('category')) { conditions.push('category = ?'); values.push(url.searchParams.get('category')); }
  if (url.searchParams.get('featured') === 'true') conditions.push('is_featured = 1');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await env.DB.prepare(`SELECT * FROM products ${where} ORDER BY is_featured DESC, created_at DESC`).bind(...values).all();
  const products = result.results.map(publicProduct);
  return json({ success: true, data: products, count: products.length });
}

export async function getProduct(request, env, id) {
  const includeInactive = Boolean(await requireAdmin(request, env, true));
  const product = await findById(env, id, includeInactive);
  return product ? json({ success: true, data: product }) : error('Product not found.', 404);
}

export async function createProduct(request, env) {
  await requireAdmin(request, env);
  const data = await readJson(request);
  validateProduct(data);
  try {
    const result = await env.DB.prepare(`
      INSERT INTO products
        (name, slug, description, short_description, price, old_price, image_url, category, stock, is_active, is_featured, sale_active, sale_price, sale_ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      String(data.name).trim(), String(data.slug).trim(), data.description || '', data.shortDescription || '',
      Number(data.price), data.oldPrice == null ? null : Number(data.oldPrice), data.imageUrl || '', data.category,
      Number(data.stock || 0), data.isActive === false ? 0 : 1, data.isFeatured ? 1 : 0,
      data.saleActive ? 1 : 0,
      data.salePrice == null || data.salePrice === '' ? null : Number(data.salePrice),
      saleEndsIso(data.saleEndsAt),
    ).run();
    const product = await findById(env, result.meta.last_row_id);
    return json({ success: true, message: 'Product created.', data: product }, 201);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return error('A product with this slug already exists.', 400);
    throw err;
  }
}

export async function updateProduct(request, env, id) {
  await requireAdmin(request, env);
  if (!await findById(env, id)) return error('Product not found.', 404);
  const data = await readJson(request);
  validateProduct(data, true);
  const columns = {
    name: 'name', slug: 'slug', description: 'description', shortDescription: 'short_description',
    price: 'price', oldPrice: 'old_price', imageUrl: 'image_url', category: 'category', stock: 'stock',
    isActive: 'is_active', isFeatured: 'is_featured',
    saleActive: 'sale_active', salePrice: 'sale_price', saleEndsAt: 'sale_ends_at',
  };
  const fields = [];
  const values = [];
  Object.entries(columns).forEach(([key, column]) => {
    if (data[key] === undefined) return;
    fields.push(`${column} = ?`);
    let value;
    if (['isActive', 'isFeatured', 'saleActive'].includes(key)) value = data[key] ? 1 : 0;
    else if (key === 'saleEndsAt') value = saleEndsIso(data[key]);
    else if (key === 'salePrice') value = (data[key] === '' || data[key] == null) ? null : Number(data[key]);
    else value = data[key];
    values.push(value);
  });
  if (fields.length) {
    fields.push('updated_at = CURRENT_TIMESTAMP');
    try { await env.DB.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).bind(...values, id).run(); }
    catch (err) {
      if (String(err.message).includes('UNIQUE')) return error('Slug already in use.', 400);
      throw err;
    }
  }
  return json({ success: true, message: 'Product updated.', data: await findById(env, id) });
}

export async function deleteProduct(request, env, id) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return result.meta.changes ? json({ success: true, message: 'Product deleted.' }) : error('Product not found.', 404);
}
