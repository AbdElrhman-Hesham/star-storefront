import { HttpError, error, json, readJson, enforceRateLimit, clientIp } from './utils.js';

const encoder = new TextEncoder();

function base64Url(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function signToken(payload, secret) {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return `${data}.${base64Url(signature)}`;
}

async function verifyToken(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  const key = await hmacKey(secret, ['verify']);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64Url(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (payload.exp <= Math.floor(Date.now() / 1000) || payload.role !== 'admin') return null;
    return payload;
  } catch (_) {
    return null;
  }
}

async function sameSecret(left, right) {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left || ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right || ''))),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function bearer(request) {
  const [scheme, token] = (request.headers.get('authorization') || '').split(' ');
  return scheme === 'Bearer' ? token : null;
}

export async function requireAdmin(request, env, optional = false) {
  if (!env.JWT_SECRET) throw new HttpError(500, 'JWT_SECRET is not configured.');
  const payload = await verifyToken(bearer(request), env.JWT_SECRET);
  if (!payload && !optional) throw new HttpError(401, 'Session expired. Please log in again.');
  return payload;
}

export async function login(request, env) {
  await enforceRateLimit(env, `login:${clientIp(request)}`, 5, 15 * 60);
  const body = await readJson(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) return error('Username and password are required.', 400);
  if (!env.ADMIN_PASSWORD || !env.JWT_SECRET) return error('Admin secrets are not configured.', 500);

  const validUser = await sameSecret(username, env.ADMIN_USERNAME || 'admin');
  const validPassword = await sameSecret(password, env.ADMIN_PASSWORD);
  if (!validUser || !validPassword) return error('Invalid credentials.', 401);

  const now = Math.floor(Date.now() / 1000);
  const token = await signToken({ username, role: 'admin', iat: now, exp: now + 8 * 60 * 60 }, env.JWT_SECRET);
  return json({ success: true, message: 'Login successful.', username, token, expiresIn: '8h' });
}

export async function me(request, env) {
  const admin = await requireAdmin(request, env);
  return json({ success: true, data: { username: admin.username, role: admin.role } });
}
