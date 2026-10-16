/**
 * STAR i18n + storefront runtime config.
 * Loads editable translations/settings from the backend and falls back to local defaults.
 */

const TRANSLATIONS = JSON.parse(JSON.stringify(window.STAR_DEFAULT_TRANSLATIONS || { en: {}, ar: {} }));
const DEFAULT_STOREFRONT_SETTINGS = JSON.parse(JSON.stringify(window.STAR_DEFAULT_STOREFRONT_SETTINGS || {}));
const DEFAULT_CONTENT_BLOCKS = JSON.parse(JSON.stringify(window.STAR_DEFAULT_CONTENT_BLOCKS || {}));

let currentLang = localStorage.getItem('star_lang') || 'en';
window.STAR_SITE_SETTINGS = {
  ...DEFAULT_STOREFRONT_SETTINGS,
  whatsappNumber: window.STAR_CONFIG?.WHATSAPP || DEFAULT_STOREFRONT_SETTINGS.whatsappNumber || '201000000000',
};
window.STAR_CONTENT_BLOCKS = JSON.parse(JSON.stringify(DEFAULT_CONTENT_BLOCKS));

function t(key, replacements = {}) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en || {};
  let str = dict[key] || TRANSLATIONS.en?.[key] || key;
  Object.entries(replacements).forEach(([k, v]) => {
    str = str.replace(`{${k}}`, v);
  });
  return str;
}

function getSiteSetting(key, fallback = '') {
  return window.STAR_SITE_SETTINGS?.[key] ?? fallback;
}

function applyMediaImages() {
  const mediaImages = window.STAR_CONTENT_BLOCKS?.mediaImages || {};

  document.querySelectorAll('[data-cms-image]').forEach((img) => {
    const key = img.getAttribute('data-cms-image');
    const imageUrl = mediaImages[key]?.imageUrl || '';
    if (imageUrl) img.src = imageUrl;
  });
}

function applyTranslations() {
  const dict = TRANSLATIONS[currentLang];
  if (!dict) return;

  document.documentElement.dir = dict.dir || (currentLang === 'ar' ? 'rtl' : 'ltr');
  document.documentElement.lang = dict.lang || currentLang;

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    const val = t(key);
    if (attr) el.setAttribute(attr, val);
    else el.innerHTML = val;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });

  document.querySelectorAll('.lang-toggle-btn').forEach((btn) => {
    btn.textContent = t('nav_lang');
  });

  if (typeof setupCategoryFilter === 'function') setupCategoryFilter();
  if (typeof renderProducts === 'function') renderProducts(typeof activeCategory === 'string' ? activeCategory : 'All');
  if (typeof renderCart === 'function') renderCart();
  if (typeof updateBundlePricing === 'function') updateBundlePricing();
  if (typeof renderStructuredContent === 'function') renderStructuredContent();
  applyMediaImages();
}

function applyStorefrontSettings() {
  const settings = window.STAR_SITE_SETTINGS || {};
  const title = settings.metaTitle || settings.siteName || 'STAR';
  const description = settings.metaDescription || '';
  const logoUrl = settings.logoUrl || 'logo.png';
  const waNumber = (settings.whatsappNumber || window.STAR_CONFIG?.WHATSAPP || '').replace(/\D/g, '');
  const waText = encodeURIComponent(settings.whatsappDefaultMessage || 'Hello STAR, I want to place an order.');
  const waUrl = waNumber ? `https://wa.me/${waNumber}?text=${waText}` : '#';

  document.title = title;

  const descMeta = document.querySelector('meta[name="description"]');
  if (descMeta) descMeta.setAttribute('content', description);

  [
    'navLogoImg',
    'footerLogoImg',
    'loginLogoImg',
    'topbarLogoImg',
  ].forEach((id) => {
    const img = document.getElementById(id);
    if (img) img.src = logoUrl;
  });

  const facebookLink = document.getElementById('socialFacebook');
  const instagramLink = document.getElementById('socialInstagram');
  const tiktokLink = document.getElementById('socialTiktok');
  const waFloat = document.getElementById('waFloat');
  const footerWa = document.getElementById('footerWhatsApp');
  const footerWaLink = document.getElementById('footerWaLink');

  if (facebookLink) facebookLink.href = settings.facebookUrl || '#';
  if (instagramLink) instagramLink.href = settings.instagramUrl || '#';
  if (tiktokLink) tiktokLink.href = settings.tiktokUrl || '#';
  if (waFloat) waFloat.href = waUrl;
  if (footerWa) footerWa.href = waUrl;
  if (footerWaLink) footerWaLink.href = waUrl;

  const heroOrders = document.getElementById('heroOrdersDelivered');
  const heroRating = document.getElementById('heroRating');
  const heroCod = document.getElementById('heroCodPercent');
  if (heroOrders && settings.heroOrdersDelivered && settings.heroOrdersDelivered !== DEFAULT_STOREFRONT_SETTINGS.heroOrdersDelivered) {
    heroOrders.textContent = settings.heroOrdersDelivered;
  }
  if (heroRating && settings.heroRating && settings.heroRating !== DEFAULT_STOREFRONT_SETTINGS.heroRating) {
    heroRating.textContent = settings.heroRating;
  }
  if (heroCod && settings.heroCodPercent && settings.heroCodPercent !== DEFAULT_STOREFRONT_SETTINGS.heroCodPercent) {
    heroCod.textContent = settings.heroCodPercent;
  }

  const waTooltip = document.getElementById('waTooltip');
  if (waTooltip) waTooltip.textContent = t('wa_float_tooltip');

  applyMediaImages();
}

function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem('star_lang', lang);
  applyTranslations();
  applyStorefrontSettings();
}

function toggleLanguage() {
  setLanguage(currentLang === 'en' ? 'ar' : 'en');
}

async function loadRemoteSiteConfig() {
  const apiUrl = window.STAR_CONFIG?.API_URL;
  if (!apiUrl) {
    applyTranslations();
    applyStorefrontSettings();
    return;
  }

  try {
    const res = await fetch(`${apiUrl}/site-config`, window.getAdminPreviewFetchOptions?.() || {});
    if (!res.ok) throw new Error(`Site config request failed with ${res.status}`);
    const result = await res.json();
    const config = result.data || {};

    ['en', 'ar'].forEach((lang) => {
      if (config.translations?.[lang] && typeof config.translations[lang] === 'object') {
        Object.assign(TRANSLATIONS[lang], config.translations[lang]);
      }
    });

    if (config.storefront && typeof config.storefront === 'object') {
      window.STAR_SITE_SETTINGS = { ...window.STAR_SITE_SETTINGS, ...config.storefront };
    }

    if (config.contentBlocks && typeof config.contentBlocks === 'object') {
      const incomingBlocks = JSON.parse(JSON.stringify(config.contentBlocks));
      window.STAR_CONTENT_BLOCKS = {
        ...window.STAR_CONTENT_BLOCKS,
        ...incomingBlocks,
        gallery: {
          ...(window.STAR_CONTENT_BLOCKS.gallery || {}),
          ...(incomingBlocks.gallery || {}),
        },
      };
    }
  } catch (err) {
    console.warn('[STAR] Using local site defaults:', err.message);
  } finally {
    applyTranslations();
    applyStorefrontSettings();
    document.dispatchEvent(new CustomEvent('star:site-config-loaded'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);
});

window.t = t;
window.setLanguage = setLanguage;
window.toggleLanguage = toggleLanguage;
window.getSiteSetting = getSiteSetting;
window.applyMediaImages = applyMediaImages;
window.STAR_SITE_READY = loadRemoteSiteConfig();
