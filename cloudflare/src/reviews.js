import { HttpError, error, json, readJson, enforceRateLimit, clientIp } from './utils.js';
import { requireAdmin } from './auth.js';

function publicReview(row) {
  return {
    id: row.id,
    productId: row.product_id,
    authorName: row.author_name,
    rating: Number(row.rating),
    comment: row.comment,
    isApproved: Boolean(row.is_approved),
    createdAt: row.created_at,
  };
}

function validateReview(data) {
  const errors = [];
  const name = String(data.authorName || '').trim();
  const comment = String(data.comment || '').trim();
  const rating = Number(data.rating);
  if (name.length < 2 || name.length > 60) errors.push({ field: 'authorName', message: 'Name must be 2-60 characters.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.push({ field: 'rating', message: 'Rating must be between 1 and 5.' });
  if (comment.length < 3 || comment.length > 1000) errors.push({ field: 'comment', message: 'Comment must be 3-1000 characters.' });
  if (errors.length) throw new HttpError(400, 'Validation failed', errors);
  return { name, rating, comment };
}

// GET /api/products/:id/reviews — public, approved reviews only
export async function listProductReviews(request, env, productId) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM product_reviews WHERE product_id = ? AND is_approved = 1 ORDER BY created_at DESC LIMIT 100',
  ).bind(productId).all();
  const rows = (results || []).map(publicReview);
  const avg = rows.length ? rows.reduce((sum, r) => sum + r.rating, 0) / rows.length : 0;
  return json({ success: true, data: rows, count: rows.length, averageRating: Math.round(avg * 10) / 10 });
}

// POST /api/products/:id/reviews — public submit, stored unapproved
export async function createProductReview(request, env, productId) {
  await enforceRateLimit(env, `review:${clientIp(request)}`, 5, 600);
  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
  if (!product) throw new HttpError(404, 'Product not found.');
  const data = await readJson(request);
  const { name, rating, comment } = validateReview(data);
  await env.DB.prepare(
    'INSERT INTO product_reviews (product_id, author_name, rating, comment, is_approved) VALUES (?, ?, ?, ?, 0)',
  ).bind(productId, name, rating, comment).run();
  return json({ success: true, message: 'Thank you! Your review will appear after it is approved.' }, 201);
}

// GET /api/reviews/admin — all reviews (optionally ?status=pending|approved)
export async function listAllReviews(request, env) {
  await requireAdmin(request, env);
  const status = new URL(request.url).searchParams.get('status');
  let sql = 'SELECT r.*, p.name AS product_name FROM product_reviews r LEFT JOIN products p ON p.id = r.product_id';
  if (status === 'pending') sql += ' WHERE r.is_approved = 0';
  else if (status === 'approved') sql += ' WHERE r.is_approved = 1';
  sql += ' ORDER BY r.is_approved ASC, r.created_at DESC LIMIT 300';
  const { results } = await env.DB.prepare(sql).all();
  const rows = (results || []).map((r) => ({ ...publicReview(r), productName: r.product_name || null }));
  const pending = rows.filter((r) => !r.isApproved).length;
  return json({ success: true, data: rows, count: rows.length, pending });
}

// PATCH /api/reviews/admin/:id — { isApproved: true|false }
export async function updateReview(request, env, id) {
  await requireAdmin(request, env);
  const data = await readJson(request);
  const approved = data.isApproved ? 1 : 0;
  const res = await env.DB.prepare('UPDATE product_reviews SET is_approved = ? WHERE id = ?').bind(approved, id).run();
  if (!res.meta.changes) return error('Review not found.', 404);
  return json({ success: true, message: approved ? 'Review approved.' : 'Review hidden.' });
}

// DELETE /api/reviews/admin/:id
export async function deleteReview(request, env, id) {
  await requireAdmin(request, env);
  const res = await env.DB.prepare('DELETE FROM product_reviews WHERE id = ?').bind(id).run();
  if (!res.meta.changes) return error('Review not found.', 404);
  return json({ success: true, message: 'Review deleted.' });
}
