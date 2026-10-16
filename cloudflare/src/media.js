import { error, json } from './utils.js';
import { requireAdmin } from './auth.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function uploadImage(request, env) {
  await requireAdmin(request, env);
  const form = await request.formData();
  const file = form.get('image');
  if (!file || typeof file === 'string') return error('Please choose an image to upload.', 400);
  if (!ALLOWED.has(file.type)) return error('Only PNG, JPG, WEBP, and GIF files are allowed.', 400);
  if (file.size > 5 * 1024 * 1024) return error('Image is too large. Maximum size is 5 MB.', 400);

  const extension = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = (file.name.replace(/\.[^.]+$/, '') || 'image').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'image';
  const key = `${Date.now()}-${crypto.randomUUID()}-${base}.${extension}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), { metadata: { contentType: file.type } });
  return json({ success: true, message: 'Image uploaded successfully.', data: { filename: key, url: `/uploads/${key}` } }, 201);
}

export async function serveImage(env, key) {
  if (!key || key.includes('..')) return error('Image not found.', 404);
  const object = await env.MEDIA.getWithMetadata(key, { type: 'stream' });
  if (!object.value) return error('Image not found.', 404);
  const headers = new Headers({ 'content-type': object.metadata?.contentType || 'application/octet-stream' });
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.value, { headers });
}
