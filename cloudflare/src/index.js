import { error, HttpError, json, positiveId } from './utils.js';
import { login, me } from './auth.js';
import {
  createProduct, deleteProduct, getProduct, listProducts, updateProduct,
} from './products.js';
import {
  createProductReview, deleteReview, listAllReviews, listProductReviews, updateReview,
} from './reviews.js';
import {
  createPromotion, deletePromotion, listActivePromotions, listPromotions, togglePromotion, updatePromotion,
} from './promotions.js';
import {
  createPromoCode, deletePromoCode, listPromoCodes, togglePromoCode, updatePromoCode, validatePromoCodePublic,
} from './promo-codes.js';
import {
  createOrder, deleteOrder, getOrder, listOrders, orderStats, updateOrderNotes, updateOrderStatus,
} from './orders.js';
import {
  adminConfig, publicConfig, updateContentBlocks, updateStorefront, updateTranslations,
} from './site-config.js';
import { serveImage, uploadImage } from './media.js';

function match(pathname, pattern) {
  const names = [];
  const source = pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  const result = pathname.match(new RegExp(`^${source}$`));
  if (!result) return null;
  return Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(result[index + 1])]));
}

async function routeApi(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  let params;

  if (method === 'GET' && pathname === '/api/health') {
    return json({ success: true, message: 'STAR Cloudflare API running', version: '4.0.0' });
  }

  if (method === 'POST' && pathname === '/api/admin/login') return login(request, env);
  if (method === 'GET' && pathname === '/api/admin/me') return me(request, env);

  if (method === 'GET' && pathname === '/api/products') return listProducts(request, env);
  if (method === 'GET' && pathname === '/api/products/admin/all') return listProducts(request, env, true);
  if (method === 'POST' && pathname === '/api/products/admin') return createProduct(request, env);
  if ((params = match(pathname, '/api/products/admin/:id'))) {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    if (method === 'PATCH') return updateProduct(request, env, params.id);
    if (method === 'DELETE') return deleteProduct(request, env, params.id);
  }
  if ((params = match(pathname, '/api/products/:id')) && method === 'GET') {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    return getProduct(request, env, params.id);
  }

  if ((params = match(pathname, '/api/products/:id/reviews'))) {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    if (method === 'GET') return listProductReviews(request, env, params.id);
    if (method === 'POST') return createProductReview(request, env, params.id);
  }
  if (method === 'GET' && pathname === '/api/reviews/admin') return listAllReviews(request, env);
  if ((params = match(pathname, '/api/reviews/admin/:id'))) {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    if (method === 'PATCH') return updateReview(request, env, params.id);
    if (method === 'DELETE') return deleteReview(request, env, params.id);
  }

  if (method === 'GET' && pathname === '/api/promotions') return listActivePromotions(request, env);
  if (method === 'GET' && pathname === '/api/promotions/admin') return listPromotions(request, env);
  if (method === 'POST' && pathname === '/api/promotions/admin') return createPromotion(request, env);
  if ((params = match(pathname, '/api/promotions/admin/:id/toggle')) && method === 'PATCH') {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    return togglePromotion(request, env, params.id);
  }
  if (method === 'POST' && pathname === '/api/promo-codes/validate') return validatePromoCodePublic(request, env);
  if (method === 'GET' && pathname === '/api/promo-codes/admin') return listPromoCodes(request, env);
  if (method === 'POST' && pathname === '/api/promo-codes/admin') return createPromoCode(request, env);
  if ((params = match(pathname, '/api/promo-codes/admin/:id/toggle')) && method === 'PATCH') {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    return togglePromoCode(request, env, params.id);
  }
  if ((params = match(pathname, '/api/promo-codes/admin/:id'))) {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    if (method === 'PATCH') return updatePromoCode(request, env, params.id);
    if (method === 'DELETE') return deletePromoCode(request, env, params.id);
  }

  if ((params = match(pathname, '/api/promotions/admin/:id'))) {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    if (method === 'PATCH') return updatePromotion(request, env, params.id);
    if (method === 'DELETE') return deletePromotion(request, env, params.id);
  }

  if (method === 'POST' && pathname === '/api/orders') return createOrder(request, env, ctx);
  if (method === 'GET' && pathname === '/api/orders/admin/stats') return orderStats(request, env);
  if (method === 'GET' && pathname === '/api/orders/admin') return listOrders(request, env);
  if ((params = match(pathname, '/api/orders/admin/:id/status')) && method === 'PATCH') {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    return updateOrderStatus(request, env, params.id);
  }
  if ((params = match(pathname, '/api/orders/admin/:id/notes')) && method === 'PATCH') {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    return updateOrderNotes(request, env, params.id);
  }
  if ((params = match(pathname, '/api/orders/admin/:id'))) {
    if (!positiveId(params.id)) throw new HttpError(400, 'Invalid ID.');
    if (method === 'GET') return getOrder(request, env, params.id);
    if (method === 'DELETE') return deleteOrder(request, env, params.id);
  }

  if (method === 'GET' && pathname === '/api/site-config') return publicConfig(env);
  if (method === 'GET' && pathname === '/api/admin/site-config') return adminConfig(request, env);
  if (method === 'PUT' && pathname === '/api/admin/site-config/storefront') return updateStorefront(request, env);
  if (method === 'PUT' && pathname === '/api/admin/site-config/translations') return updateTranslations(request, env);
  if (method === 'PUT' && pathname === '/api/admin/site-config/content-blocks') return updateContentBlocks(request, env);
  if (method === 'POST' && pathname === '/api/admin/upload-image') return uploadImage(request, env);

  return error(`Route ${pathname} not found`, 404);
}

function withSecurityHeaders(response) {
  const res = new Response(response.body, response);
  res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      let response;
      if (url.pathname.startsWith('/api/')) {
        response = await routeApi(request, env, ctx);
      } else if (url.pathname.startsWith('/uploads/')) {
        response = await serveImage(env, decodeURIComponent(url.pathname.slice('/uploads/'.length)));
      } else {
        response = await env.ASSETS.fetch(request);
      }
      return withSecurityHeaders(response);
    } catch (err) {
      console.error(err);
      const res = err instanceof HttpError
        ? error(err.message, err.status, err.details)
        : error('Internal server error.', 500);
      return withSecurityHeaders(res);
    }
  },
};
