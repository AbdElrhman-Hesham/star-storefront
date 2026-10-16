import defaults from '../../js/site-defaults.js';
import { json, readJson } from './utils.js';
import { requireAdmin } from './auth.js';

const DEFAULT_CONFIG = {
  storefront: defaults.DEFAULT_STOREFRONT_SETTINGS,
  translations: defaults.DEFAULT_TRANSLATIONS,
  contentBlocks: defaults.DEFAULT_CONTENT_BLOCKS,
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function mergeConfig(stored = {}) {
  const merged = clone(DEFAULT_CONFIG);
  if (stored.storefront && typeof stored.storefront === 'object') {
    Object.assign(merged.storefront, stored.storefront);
  }
  if (stored.translations && typeof stored.translations === 'object') {
    ['en', 'ar'].forEach((lang) => {
      if (stored.translations[lang] && typeof stored.translations[lang] === 'object') {
        Object.assign(merged.translations[lang], stored.translations[lang]);
      }
    });
  }
  if (stored.contentBlocks && typeof stored.contentBlocks === 'object') {
    merged.contentBlocks = {
      ...merged.contentBlocks,
      ...clone(stored.contentBlocks),
      gallery: { ...(merged.contentBlocks.gallery || {}), ...clone(stored.contentBlocks.gallery || {}) },
      mediaImages: { ...(merged.contentBlocks.mediaImages || {}), ...clone(stored.contentBlocks.mediaImages || {}) },
    };
  }
  return merged;
}

async function getConfig(env) {
  const result = await env.DB.prepare(`
    SELECT setting_key, value_json FROM site_settings
    WHERE setting_key IN ('storefront', 'translations', 'contentBlocks')
  `).all();
  const stored = {};
  result.results.forEach((row) => {
    try { stored[row.setting_key] = JSON.parse(row.value_json); } catch (_) { /* use defaults */ }
  });
  return mergeConfig(stored);
}

async function saveSetting(env, key, value) {
  await env.DB.prepare(`
    INSERT INTO site_settings (setting_key, value_json) VALUES (?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
  `).bind(key, JSON.stringify(value)).run();
}

export async function publicConfig(env) {
  return json({ success: true, data: await getConfig(env) });
}

export async function adminConfig(request, env) {
  await requireAdmin(request, env);
  return publicConfig(env);
}

export async function updateStorefront(request, env) {
  await requireAdmin(request, env);
  const incoming = await readJson(request);
  const current = await getConfig(env);
  const allowed = [
    'siteName', 'metaTitle', 'metaDescription', 'logoUrl', 'whatsappNumber', 'supportPhone',
    'facebookUrl', 'instagramUrl', 'tiktokUrl', 'whatsappDefaultMessage', 'heroOrdersDelivered',
    'heroRating', 'heroCodPercent', 'currencyCode',
  ];
  const next = { ...current.storefront };
  allowed.forEach((key) => {
    if (incoming[key] !== undefined) next[key] = String(incoming[key] ?? '').trim();
  });
  await saveSetting(env, 'storefront', next);
  return json({ success: true, message: 'Storefront settings updated.', data: next });
}

export async function updateTranslations(request, env) {
  await requireAdmin(request, env);
  const incoming = await readJson(request);
  const current = await getConfig(env);
  const next = clone(current.translations);
  ['en', 'ar'].forEach((lang) => {
    if (!incoming[lang] || typeof incoming[lang] !== 'object' || Array.isArray(incoming[lang])) return;
    Object.keys(incoming[lang]).forEach((key) => { next[lang][key] = String(incoming[lang][key] ?? ''); });
  });
  await saveSetting(env, 'translations', next);
  return json({ success: true, message: 'Site content updated.', data: next });
}

export async function updateContentBlocks(request, env) {
  await requireAdmin(request, env);
  const incoming = await readJson(request);
  const current = await getConfig(env);
  const next = clone(current.contentBlocks);
  Object.keys(incoming || {}).forEach((key) => { next[key] = clone(incoming[key]); });
  await saveSetting(env, 'contentBlocks', next);
  return json({ success: true, message: 'Structured content updated.', data: next });
}
