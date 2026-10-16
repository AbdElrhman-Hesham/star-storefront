// ===== CONFIG =====
const API_URL  = window.STAR_CONFIG?.API_URL  || '/api';
const WHATSAPP = window.STAR_CONFIG?.WHATSAPP || '201000000000';

// ===== CONSTANTS =====
const CATEGORIES_EN = ['All', 'Featured', 'New Arrivals', 'Best Sellers', 'Offers', 'Other'];
const PLACEHOLDER_IMAGE = '/assets/images/product-1.jpg';
const CATEGORY_KEYS = {
  'All': 'cat_all',
  'Featured': 'cat_featured',
  'New Arrivals': 'cat_new',
  'Best Sellers': 'cat_bestsellers',
  'Offers': 'cat_offers',
  'Other': 'cat_other',
};

function getStructuredBlocks() {
  return window.STAR_CONTENT_BLOCKS || {};
}

function localizeBlockText(value, fallback = '') {
  if (value && typeof value === 'object') {
    return value[currentLang] || value.en || fallback;
  }
  return value || fallback;
}

function warrantyIcon(iconKey) {
  const icons = {
    Shield: '\ud83d\udee1\ufe0f',
    Truck: '\ud83d\ude9a',
    Phone: '\ud83d\udcde',
  };
  return icons[iconKey] || '\u2728';
}

// ===== CART STATE =====
let cart = [];
let allProducts = [];
let activeCategory = 'All';
let activePromotions = [];
let promoTicker = null;
let appliedPromo = null;

// ===== PROMOTIONS =====
const PROMO = () => window.STAR_PROMO;

async function loadPromotions() {
  if (!PROMO()) return;
  try {
    const res = await fetch(`${API_URL}/promotions`, { cache: 'no-store' });
    if (!res.ok) throw new Error('promotions unavailable');
    const result = await res.json();
    activePromotions = Array.isArray(result.data) ? result.data : [];
  } catch {
    activePromotions = [];
  }
  startPromoTicker();
}

// Candidate offers for a product = admin promotions + the product's own quick sale.
function promosFor(product) {
  return PROMO() ? PROMO().withProductSale(activePromotions, product) : [];
}

// Best live offer for a product (or null).
function productPromo(product) {
  return PROMO() ? PROMO().bestPromotion(promosFor(product), product.id, Date.now()) : null;
}

// Card/PDP pricing: falls back to the plain oldPrice logic when no offer is live.
function cardPricing(product) {
  const promo = productPromo(product);
  if (!promo) {
    const hasDiscount = product.oldPrice && product.oldPrice > product.price;
    return {
      promo: null, isBogo: false, salePrice: product.price,
      oldPrice: hasDiscount ? product.oldPrice : null,
      discountPct: hasDiscount ? Math.round((1 - product.price / product.oldPrice) * 100) : 0,
      badge: null, desc: '',
    };
  }
  const line = PROMO().computeLine({ id: product.id, price: product.price }, 1, promosFor(product), Date.now());
  const isBogo = promo.offerType === 'bogo';
  const salePrice = isBogo ? product.price : line.saleUnitPrice;
  const showStrike = !isBogo && salePrice < product.price;
  const oldPrice = showStrike ? product.price
    : (product.oldPrice && product.oldPrice > product.price ? product.oldPrice : null);
  return {
    promo, isBogo, salePrice, oldPrice, showStrike,
    badge: PROMO().badgeText(promo, currentLang),
    desc: PROMO().offerDescription(promo, currentLang),
  };
}

function renderCountdownInner(ms) {
  const p = PROMO().countdownParts(ms);
  const lbl = currentLang === 'ar'
    ? { d: 'ي', h: 'س', m: 'د', s: 'ث' }
    : { d: 'd', h: 'h', m: 'm', s: 's' };
  const cell = (val, label) => `<span class="promo-timer-cell"><b>${String(val).padStart(2, '0')}</b><i>${label}</i></span>`;
  const parts = [];
  if (p.days > 0) parts.push(cell(p.days, lbl.d));
  parts.push(cell(p.hours, lbl.h), cell(p.minutes, lbl.m), cell(p.seconds, lbl.s));
  return parts.join('');
}

function promoTimerHtml(promo) {
  if (!promo || !promo.endsAt) return '';
  const label = currentLang === 'ar' ? 'ينتهي خلال' : 'Ends in';
  return `<div class="promo-timer" data-promo-timer="${promo.id}" data-ends="${esc(promo.endsAt)}">
    <span class="promo-timer-label">${label}</span>
    <span class="promo-timer-clock">${renderCountdownInner(PROMO().msRemaining(promo, Date.now()))}</span>
  </div>`;
}

function startPromoTicker() {
  if (promoTicker || !PROMO()) return;
  promoTicker = setInterval(tickPromos, 1000);
}

// Update every visible countdown once per second; when one hits zero, re-render so
// the expired offer disappears and its price reverts automatically.
function tickPromos() {
  const now = Date.now();
  let expired = false;
  document.querySelectorAll('[data-promo-timer]').forEach((el) => {
    const ends = Date.parse(el.getAttribute('data-ends'));
    const ms = ends - now;
    if (ms <= 0) expired = true;
    const clock = el.querySelector('.promo-timer-clock');
    if (clock) clock.innerHTML = renderCountdownInner(Math.max(0, ms));
  });
  if (expired) {
    renderProducts(activeCategory);
    renderCart();
  }
}

function getCurrency() {
  const configuredCurrency = window.STAR_SITE_SETTINGS?.currencyCode || 'EGP';
  return currentLang === 'ar' ? '\u062c\u0646\u064a\u0647' : configuredCurrency;
}

function normalizeProduct(raw) {
  return {
    id: Number(raw.id),
    name: raw.name || '',
    slug: raw.slug || '',
    description: raw.description || '',
    shortDescription: raw.shortDescription || raw.short_description || '',
    price: Number(raw.price || 0),
    oldPrice: raw.oldPrice ?? raw.old_price ? Number(raw.oldPrice ?? raw.old_price) : null,
    imageUrl: raw.imageUrl || raw.image_url || PLACEHOLDER_IMAGE,
    category: raw.category || 'Other',
    stock: Number(raw.stock || 0),
    isActive: raw.isActive ?? raw.is_active ?? true,
    isFeatured: Boolean(raw.isFeatured ?? raw.is_featured),
    saleActive: Boolean(raw.saleActive ?? raw.sale_active),
    salePrice: (raw.salePrice ?? raw.sale_price) == null ? null : Number(raw.salePrice ?? raw.sale_price),
    saleEndsAt: raw.saleEndsAt ?? raw.sale_ends_at ?? null,
  };
}

// ===== NAVBAR =====
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 50);
  const stickyCta = document.getElementById('stickyCta');
  if (stickyCta) stickyCta.classList.toggle('visible', window.scrollY > 400);
});

// ===== HAMBURGER =====
document.getElementById('hamburger')?.addEventListener('click', () => {
  document.getElementById('mobileMenu')?.classList.toggle('open');
});
document.querySelectorAll('.mobile-menu a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('mobileMenu')?.classList.remove('open'));
});

// ===== PARTICLES =====
(function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 50; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `left:${Math.random()*100}%;width:${Math.random()*3+1}px;height:${Math.random()*3+1}px;animation-duration:${Math.random()*10+8}s;animation-delay:${Math.random()*10}s;opacity:${Math.random()*0.6+0.2};`;
    container.appendChild(p);
  }
})();

// ===== SMOOTH SCROLL =====
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
});

// ===== REVEAL ON SCROLL =====
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('visible'), i * 80);
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

function observeReveal() {
  document.querySelectorAll('.benefit-card,.product-card,.feature-card,.review-card,.gallery-item,.video-card,.faq-item,.category-chip,.bundle-card').forEach(el => {
    el.classList.add('reveal');
    revealObserver.observe(el);
  });
}

function renderGallerySection() {
  const container = document.getElementById('galleryDynamic');
  if (!container) return;
  const gallery = getStructuredBlocks().gallery || {};
  const keys = ['holder', 'charger', 'cable'].filter((key) => gallery[key] && Array.isArray(gallery[key].items) && gallery[key].items.length);

  const section = container.closest('section');
  if (section) section.style.display = keys.length ? '' : 'none';

  if (!keys.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="gallery-tabs">
      ${keys.map((key, index) => `
        <button class="gallery-tab${index === 0 ? ' active' : ''}" onclick="showGalleryProduct('${key}', event)">${esc(localizeBlockText(gallery[key].label, key))}</button>
      `).join('')}
    </div>
    <div class="gallery-content-wrap">
      ${keys.map((key, index) => {
        const items = gallery[key].items || [];
        const main = items[0];
        return `
          <div class="gallery-product-group${index === 0 ? ' active' : ''}" id="gallery-${key}">
            <div class="gallery-slideshow">
              <div class="gallery-main-img-wrap">
                <img id="${key}-main-img" src="${esc(main?.imageUrl || PLACEHOLDER_IMAGE)}" alt="${esc(localizeBlockText(gallery[key].label, key))}" loading="lazy"/>
              </div>
              <div class="gallery-thumbs">
                ${items.map((item, itemIndex) => `
                  <div class="gallery-thumb-item${itemIndex === 0 ? ' active' : ''}" onclick="changeGalleryMain('${key}', '${esc(item.imageUrl || PLACEHOLDER_IMAGE)}', this)">
                    <img src="${esc(item.imageUrl || PLACEHOLDER_IMAGE)}" alt="${esc(localizeBlockText(item.caption, 'Image'))}" loading="lazy"/>
                    <span>${esc(localizeBlockText(item.caption, 'Image'))}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderReviewsSection() {
  const container = document.getElementById('reviewsGrid');
  if (!container) return;
  const reviews = Array.isArray(getStructuredBlocks().reviews) ? getStructuredBlocks().reviews : [];

  container.innerHTML = reviews.map((review) => `
    <div class="review-card${review.featured ? ' featured-review' : ''}">
      <div class="review-stars">${'\u2605'.repeat(Math.max(1, Math.min(Number(review.stars || 5), 5)))}</div>
      <p class="review-text">${esc(localizeBlockText(review.text, ''))}</p>
      <div class="reviewer">
        <div class="reviewer-avatar">${esc((review.avatar || '?').slice(0, 1))}</div>
        <div>
          <div class="reviewer-name">${esc(localizeBlockText(review.name, ''))}</div>
          <div class="reviewer-role">${esc(localizeBlockText(review.role, ''))}</div>
        </div>
      </div>
    </div>
  `).join('');
  const section = container.closest('section');
  if (section) section.style.display = reviews.length ? '' : 'none';
}

function bindFaqAccordion() {
  document.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((openItem) => openItem.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
}

function renderFaqSection() {
  const container = document.getElementById('faqList');
  if (!container) return;
  const faqs = Array.isArray(getStructuredBlocks().faqs) ? getStructuredBlocks().faqs : [];

  container.innerHTML = faqs.map((faq) => `
    <div class="faq-item">
      <button class="faq-question"><span>${esc(localizeBlockText(faq.question, ''))}</span> <span class="faq-icon">+</span></button>
      <div class="faq-answer"><p>${esc(localizeBlockText(faq.answer, ''))}</p></div>
    </div>
  `).join('');
  const section = container.closest('section');
  if (section) section.style.display = faqs.length ? '' : 'none';

  bindFaqAccordion();
}

function renderWarrantySection() {
  const container = document.getElementById('warrantyGrid');
  if (!container) return;
  const items = Array.isArray(getStructuredBlocks().warranty) ? getStructuredBlocks().warranty : [];

  container.innerHTML = items.map((item) => `
    <div class="warranty-card">
      <div class="warranty-icon">${warrantyIcon(item.icon)}</div>
      <h3>${esc(localizeBlockText(item.title, ''))}</h3>
      <p>${esc(localizeBlockText(item.description, ''))}</p>
    </div>
  `).join('');
  const section = container.closest('section');
  if (section) section.style.display = items.length ? '' : 'none';
}

function renderStructuredContent() {
  renderGallerySection();
  renderReviewsSection();
  renderFaqSection();
  renderWarrantySection();
  observeReveal();
}

// ===== BUNDLE: Compute pricing from API products =====
function updateBundlePricing() {
  if (!allProducts.length) return;

  // Find the "Pro Driver Kit" or compute from individual items
  const proKit = allProducts.find(p => p.slug === 'pro-driver-kit');
  const holder = allProducts.find(p => p.slug === 'magnetic-phone-holder');
  const charger = allProducts.find(p => p.slug === 'fast-car-charger');
  const cable = allProducts.find(p => p.slug === 'fast-charging-cable');

  let bundlePrice, bundleOld;
  if (proKit) {
    bundlePrice = proKit.price;
    bundleOld = proKit.oldPrice || Math.round(proKit.price * 1.28);
  } else if (holder && charger && cable) {
    bundleOld = (holder.oldPrice || holder.price) + (charger.oldPrice || charger.price) + (cable.oldPrice || cable.price);
    bundlePrice = holder.price + charger.price + cable.price;
  } else {
    bundlePrice = 547;
    bundleOld = 747;
  }

  const save = bundleOld - bundlePrice;
  const currency = getCurrency();

  const priceEl = document.getElementById('bundlePriceMain');
  const oldEl = document.getElementById('bundleOldPrice');
  const saveEl = document.getElementById('bundleSaveAmt');
  const ctaEl = document.getElementById('bundleCtaBtn');
  const mainBundleImg = document.getElementById('bundleMainVisualImg');
  const chargerThumb = document.getElementById('bundleThumbCharger');
  const holderThumb = document.getElementById('bundleThumbHolder');
  const cableThumb = document.getElementById('bundleThumbCable');

  if (priceEl) priceEl.textContent = bundlePrice.toLocaleString() + ' ' + currency;
  if (oldEl) oldEl.textContent = bundleOld.toLocaleString() + ' ' + currency;
  if (saveEl) saveEl.textContent = save.toLocaleString() + ' ' + currency;
  if (ctaEl) ctaEl.textContent = t('bundle_cta_price', { price: bundlePrice.toLocaleString() + ' ' + currency });
  if (mainBundleImg && proKit?.imageUrl) mainBundleImg.src = proKit.imageUrl;
  if (chargerThumb && charger?.imageUrl) chargerThumb.src = charger.imageUrl;
  if (holderThumb && holder?.imageUrl) holderThumb.src = holder.imageUrl;
  if (cableThumb && cable?.imageUrl) cableThumb.src = cable.imageUrl;
  if (typeof window.applyMediaImages === 'function') window.applyMediaImages();
}

// ===== ADD BUNDLE TO CART =====
function addBundleToCart() {
  if (!allProducts.length) {
    showToast(t('toast_selecting'), 'info');
    return;
  }

  // Look for the Pro Driver Kit bundle product first
  const bundle = allProducts.find(p => p.slug === 'pro-driver-kit');
  if (bundle) {
    addProduct(bundle.id);
    return;
  }

  // Otherwise add all 3 individual items as a custom bundle
  const holder = allProducts.find(p => p.slug === 'magnetic-phone-holder');
  const charger = allProducts.find(p => p.slug === 'fast-car-charger');

  if (holder) {
    pushToCart({ productId: holder.id, itemType: 'product', itemName: holder.name, cableType: null, quantity: 1, unitPrice: holder.price });
  }
  if (charger) {
    pushToCart({ productId: charger.id, itemType: 'product', itemName: charger.name, cableType: null, quantity: 1, unitPrice: charger.price });
  }

  const cable = allProducts.find(p => p.slug === 'fast-charging-cable');
  if (cable) {
    pushToCart({ productId: cable.id, itemType: 'product', itemName: cable.name, cableType: null, quantity: 1, unitPrice: cable.price });
  } else {
    scrollToOrder();
  }
}

// ===== LOAD PRODUCTS FROM API =====
async function loadProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="product-card skeleton-card">
      <div class="skeleton-img"></div>
      <div class="skeleton-text"></div>
      <div class="skeleton-text short"></div>
    </div>
  `).join('');

  try {
    const [res] = await Promise.all([
      fetch(`${API_URL}/products`, window.getAdminPreviewFetchOptions?.() || {}),
      loadPromotions(),
    ]);
    if (!res.ok) throw new Error(`Products request failed with ${res.status}`);
    const result = await res.json();
    allProducts = (Array.isArray(result.data) ? result.data : []).map(normalizeProduct);
    renderProducts(activeCategory);
    setupCategoryFilter();
    updateBundlePricing();
    observeReveal();
    handlePendingAdd();
  } catch (err) {
    try {
      const backupRes = await fetch('products_backup.json');
      if (!backupRes.ok) throw new Error('Backup products unavailable');
      const backup = await backupRes.json();
      allProducts = (Array.isArray(backup) ? backup : []).map(normalizeProduct).filter(p => p.isActive);
      renderProducts(activeCategory);
      setupCategoryFilter();
      updateBundlePricing();
      observeReveal();
    } catch {
      grid.innerHTML = `
        <div class="products-error" style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text-muted)">
          <div style="font-size:2rem;margin-bottom:12px">!</div>
          <p>${t('no_products')}</p>
          <button type="button" onclick="loadProducts()" style="margin-top:16px;padding:10px 24px;background:var(--gold);color:#fff;border:none;border-radius:50px;font-weight:700;cursor:pointer">${t('products_retry')}</button>
        </div>`;
    }
  }
}

function renderProducts(category = 'All') {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  const filtered = category === 'All' ? allProducts : allProducts.filter(p => p.category === category);

  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted)"><div style="font-size:2.5rem;margin-bottom:12px">-</div><p>${t('no_products')}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const isFeatured = p.isFeatured;
    const currency = getCurrency();
    const cp = cardPricing(p);
    const badgeHtml = cp.promo
      ? `<div class="promo-badge">${esc(cp.badge)}</div>`
      : (cp.oldPrice ? `<div class="discount-badge">-${cp.discountPct}%</div>` : '');
    return `
    <div class="product-card${isFeatured ? ' featured-product' : ''}${cp.promo ? ' has-promo' : ''}" data-id="${p.id}">
      ${isFeatured ? `<div class="featured-badge">${currentLang === 'ar' ? '\u0645\u0645\u064a\u0632' : 'Featured'}</div>` : ''}
      ${badgeHtml}
      <a class="product-media-link" href="product.html?id=${p.id}" aria-label="${esc(p.name)}">
        <div class="product-img-wrap">
          <img src="${esc(p.imageUrl || PLACEHOLDER_IMAGE)}" alt="${esc(p.name)}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMAGE}'"/>
        </div>
      </a>
      <div class="product-card-body">
        <div class="product-category-tag">${esc(p.category)}</div>
        <a class="product-title-link" href="product.html?id=${p.id}"><h3>${esc(p.name)}</h3></a>
        <p>${esc(p.shortDescription || (p.description || '').slice(0, 80))}</p>
        <div class="product-price-row">
          <span class="product-price">${cp.salePrice.toLocaleString()} ${currency}</span>
          ${cp.oldPrice ? `<span class="product-old-price">${cp.oldPrice.toLocaleString()} ${currency}</span>` : ''}
        </div>
        ${cp.promo && cp.desc ? `<div class="promo-note">${esc(cp.desc)}</div>` : ''}
        ${promoTimerHtml(cp.promo)}
        ${p.stock <= 5 && p.stock > 0 ? `<div class="stock-warning">${t('stock_low', { n: p.stock })}</div>` : ''}
        <button type="button" class="add-to-cart-btn" onclick="addProduct(${p.id})">${t('add_to_cart')}</button>
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('#productsGrid .product-card').forEach(el => {
    el.classList.add('reveal');
    revealObserver.observe(el);
  });
}

function setupCategoryFilter() {
  const bar = document.getElementById('categoryFilter');
  if (!bar) return;
  bar.innerHTML = CATEGORIES_EN.map(cat => `
    <button class="category-chip${cat === activeCategory ? ' active' : ''}" onclick="filterByCategory('${cat}')">${t(CATEGORY_KEYS[cat]) || cat}</button>
  `).join('');
}

function filterByCategory(cat) {
  activeCategory = cat;
  document.querySelectorAll('.category-chip').forEach(btn => {
    btn.classList.toggle('active', btn.textContent === (t(CATEGORY_KEYS[cat]) || cat));
  });
  renderProducts(cat);
}

// ===== PACKAGES =====
function selectPackage(identifier) {
  const product = allProducts.find(p =>
    p.id === identifier ||
    p.slug === identifier ||
    p.name.toLowerCase() === identifier.toLowerCase() ||
    p.slug.includes(identifier.toLowerCase().replace(/\s+/g, '-'))
  );
  if (product) {
    addProduct(product.id);
    scrollToOrder();
  } else {
    showToast(t('toast_selecting'), 'info');
    scrollToOrder();
  }
}

// ===== CART =====
function uid() { return Math.random().toString(36).slice(2, 9); }

function addProduct(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;
  pushToCart({ productId: product.id, itemType: 'product', itemName: product.name, cableType: null, quantity: 1, unitPrice: product.price });
}

// Adding from a product page redirects here as ?add=<id>; add it once products are loaded
function handlePendingAdd() {
  const addId = Number(new URLSearchParams(location.search).get('add'));
  if (addId && allProducts.find(p => p.id === addId)) {
    addProduct(addId);
    history.replaceState(null, '', location.pathname);
  }
}

function pushToCart(item) {
  const existing = cart.find(i => i.productId === item.productId && i.cableType === item.cableType);
  if (existing) {
    existing.quantity += item.quantity;
    renderCart();
    scrollToOrder();
    showToast(t('toast_updated', { name: item.itemName }));
    return;
  }
  cart.push({ uid: uid(), ...item });
  renderCart();
  scrollToOrder();
  showToast(t('toast_added', { name: item.itemName }));
  checkUpsell(item);
  // Meta Pixel — AddToCart
  if (typeof fbq !== 'undefined') {
    fbq('track', 'AddToCart', {
      content_name: item.itemName,
      content_ids: [item.productId || item.itemType],
      content_type: 'product',
      value: item.unitPrice,
      currency: 'EGP',
    });
  }
}

function removeFromCart(itemUid) {
  cart = cart.filter(i => i.uid !== itemUid);
  renderCart();
}

function changeQty(itemUid, delta) {
  const item = cart.find(i => i.uid === itemUid);
  if (!item) return;
  item.quantity = Math.max(1, item.quantity + delta);
  renderCart();
}

function getSubtotal() {
  return cart.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
}

// Promotion-aware totals for the whole cart. Uses the live product price + offers;
// the server re-verifies everything at checkout, so this is display-only.
function computeCart() {
  const now = Date.now();
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  let subtotal = 0;
  let discount = 0;
  let freeTotal = 0;
  const lines = cart.map((item) => {
    const product = allProducts.find((p) => p.id === item.productId);
    if (product && PROMO()) {
      const line = PROMO().computeLine({ id: product.id, price: product.price }, item.quantity, promosFor(product), now);
      subtotal += line.originalTotal;
      discount += line.discount;
      freeTotal += line.freeQty;
      return { item, ...line };
    }
    const unit = Number(item.unitPrice) || 0;
    const orig = item.quantity * unit;
    subtotal += orig;
    return {
      item, quantity: item.quantity, originalUnitPrice: unit, originalTotal: orig,
      lineTotal: orig, discount: 0, freeQty: 0, appliedPromotion: null,
    };
  });
  return { lines, subtotal: r2(subtotal), discount: r2(discount), total: r2(subtotal - discount), freeTotal };
}

// ===== PROMO CODE (coupon at checkout) =====
// Discount the applied code contributes to the given (item-discounted) subtotal.
// Display-only estimate — the server re-validates and re-computes at checkout.
function codeDiscountFor(sub) {
  if (!appliedPromo) return 0;
  if (sub < (appliedPromo.minOrderSubtotal || 0)) return 0;
  let d = appliedPromo.discountType === 'percent'
    ? sub * appliedPromo.discountValue / 100
    : appliedPromo.discountValue;
  d = Math.min(d, sub);
  return Math.round((d + Number.EPSILON) * 100) / 100;
}

function promoCodeReasonText(reason, minOrder) {
  const ar = currentLang === 'ar';
  const cur = getCurrency();
  switch (reason) {
    case 'not_found': return ar ? 'كود غير صحيح' : 'Invalid code';
    case 'inactive': return ar ? 'هذا الكود غير مفعّل' : 'This code is not active';
    case 'not_started': return ar ? 'هذا الكود لم يبدأ بعد' : 'This code is not active yet';
    case 'expired': return ar ? 'انتهت صلاحية هذا الكود' : 'This code has expired';
    case 'usage_limit': return ar ? 'تم استخدام هذا الكود بالكامل' : 'This code has reached its limit';
    case 'min_order': return ar ? `الحد الأدنى للطلب ${Number(minOrder || 0).toLocaleString()} ${cur}` : `Minimum order ${Number(minOrder || 0).toLocaleString()} ${cur}`;
    default: return ar ? 'تعذّر تطبيق الكود' : 'Could not apply this code';
  }
}

async function applyPromoCode() {
  const input = document.getElementById('promoCodeInput');
  const msg = document.getElementById('promoCodeMsg');
  const code = (input?.value || '').trim();
  if (!code) return;
  const btn = document.getElementById('promoCodeBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/promo-codes/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, subtotal: computeCart().total }),
    });
    const result = await res.json().catch(() => ({}));
    if (result && result.valid) {
      appliedPromo = {
        code: result.data.code, discountType: result.data.discountType,
        discountValue: result.data.discountValue, minOrderSubtotal: result.data.minOrderSubtotal || 0,
      };
      if (msg) { msg.textContent = ''; msg.className = 'promo-code-msg'; }
    } else {
      appliedPromo = null;
      if (msg) { msg.textContent = promoCodeReasonText(result.reason, result.minOrder); msg.className = 'promo-code-msg error'; }
    }
    renderCart();
  } catch {
    if (msg) { msg.textContent = promoCodeReasonText('error'); msg.className = 'promo-code-msg error'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function removePromoCode() {
  appliedPromo = null;
  const input = document.getElementById('promoCodeInput');
  if (input) input.value = '';
  const msg = document.getElementById('promoCodeMsg');
  if (msg) { msg.textContent = ''; msg.className = 'promo-code-msg'; }
  renderCart();
}

// Toggle input vs. "applied" chip and localize the static bits.
function renderPromoCodeUI(codeDiscount, currency) {
  const inputRow = document.querySelector('.promo-code-input-row');
  const appliedEl = document.getElementById('promoCodeApplied');
  const appliedText = document.getElementById('promoCodeAppliedText');
  const btn = document.getElementById('promoCodeBtn');
  const input = document.getElementById('promoCodeInput');
  const codeLabel = document.getElementById('cartCodeLabel');
  const ar = currentLang === 'ar';
  if (btn) btn.textContent = ar ? 'تطبيق' : 'Apply';
  if (input && document.activeElement !== input) input.placeholder = ar ? 'كود الخصم' : 'Promo code';
  if (codeLabel) codeLabel.textContent = (ar ? 'كود الخصم' : 'Promo code') + (appliedPromo ? ` (${appliedPromo.code})` : '');
  if (appliedPromo && codeDiscount > 0) {
    if (inputRow) inputRow.style.display = 'none';
    if (appliedEl) appliedEl.style.display = 'flex';
    if (appliedText) appliedText.textContent = `✓ ${appliedPromo.code}  (- ${codeDiscount.toLocaleString()} ${currency})`;
  } else {
    if (inputRow) inputRow.style.display = 'flex';
    if (appliedEl) appliedEl.style.display = 'none';
  }
}

// ===== UPSELL =====
function checkUpsell(addedItem) {
  const upsellBanner = document.getElementById('upsellBanner');
  if (!upsellBanner) return;

  const hasCable = cart.some(i => i.itemName.toLowerCase().includes('cable'));
  const hasMountOrBundle = cart.some(i =>
    i.itemName.toLowerCase().includes('holder') ||
    i.itemName.toLowerCase().includes('kit')
  );

  if (hasMountOrBundle && !hasCable) {
    const cable = allProducts.find(p => p.name.toLowerCase().includes('fast charging cable'));
    if (cable) {
      const currency = getCurrency();
      upsellBanner.innerHTML = `
        <div class="upsell-content">
          <span>${t('upsell_complete')}</span>
          <strong>${t('upsell_add_cable', { price: cable.price + ' ' + currency })}</strong>
          <button type="button" onclick="addProduct(${cable.id}); document.getElementById('upsellBanner').style.display='none'">${t('upsell_btn')}</button>
          <button type="button" class="upsell-dismiss" aria-label="Dismiss" onclick="document.getElementById('upsellBanner').style.display='none'">x</button>
        </div>`;
      upsellBanner.style.display = 'flex';
    }
  } else {
    upsellBanner.style.display = 'none';
  }
}

function renderCart() {
  const cartItems   = document.getElementById('cartItems');
  const cartTotal   = document.getElementById('cartTotal');
  const cartBadge   = document.getElementById('cartBadge');
  const emptyCart   = document.getElementById('emptyCart');
  const submitBtn   = document.getElementById('submitBtn');
  const cartSummary = document.getElementById('cartSummary');

  const totalQty = cart.reduce((s, i) => s + i.quantity, 0);
  if (cartBadge) cartBadge.textContent = totalQty > 0 ? totalQty : '';
  if (submitBtn) submitBtn.disabled = cart.length === 0;
  if (cartSummary) cartSummary.style.display = cart.length ? 'block' : 'none';

  if (!cart.length) {
    if (emptyCart) emptyCart.style.display = 'flex';
    if (cartItems) cartItems.innerHTML = '';
    if (cartTotal) cartTotal.textContent = '0 ' + getCurrency();
    return;
  }

  if (emptyCart) emptyCart.style.display = 'none';

  const currency = getCurrency();
  const breakdown = computeCart();
  const freeLabel = (n) => (currentLang === 'ar' ? `${n} مجانًا` : `${n} free`);

  if (cartItems) {
    cartItems.innerHTML = breakdown.lines.map(({ item, ...line }) => {
      const promo = line.appliedPromotion;
      const priceLine = item.unitPrice > 0 || line.originalUnitPrice > 0
        ? `${(line.originalUnitPrice || item.unitPrice).toLocaleString()} ${currency} x ${item.quantity}`
        : 'Included';
      return `
      <div class="cart-item${promo ? ' cart-item-promo' : ''}" id="ci-${item.uid}">
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(item.itemName)}</div>
          ${item.cableType ? `<div class="cart-item-cable">${item.cableType}</div>` : ''}
          <div class="cart-item-price">${priceLine}</div>
          ${promo ? `<div class="cart-item-offer">🏷️ ${esc(promo.title)}</div>` : ''}
          ${line.freeQty > 0 ? `<div class="cart-item-free">🎁 ${freeLabel(line.freeQty)}</div>` : ''}
          ${line.discount > 0 ? `<div class="cart-item-line-total">${line.lineTotal.toLocaleString()} ${currency} <s>${line.originalTotal.toLocaleString()} ${currency}</s></div>` : ''}
        </div>
        <div class="cart-item-controls">
          <button type="button" class="qty-btn" aria-label="Decrease quantity" onclick="changeQty('${item.uid}', -1)">-</button>
          <span class="qty-val">${item.quantity}</span>
          <button type="button" class="qty-btn" aria-label="Increase quantity" onclick="changeQty('${item.uid}', 1)">+</button>
          <button type="button" class="remove-btn" aria-label="Remove item" onclick="removeFromCart('${item.uid}')">x</button>
        </div>
      </div>`;
    }).join('');
  }

  const discountRow = document.getElementById('cartDiscountRow');
  const grandRow = document.getElementById('cartGrandRow');
  const discountEl = document.getElementById('cartDiscount');
  const grandEl = document.getElementById('cartGrand');
  if (cartTotal) cartTotal.textContent = breakdown.subtotal > 0 ? breakdown.subtotal.toLocaleString() + ' ' + currency : '0 ' + currency;
  const hasDiscount = breakdown.discount > 0;
  if (discountRow) discountRow.style.display = hasDiscount ? 'flex' : 'none';
  if (discountEl) discountEl.textContent = '- ' + breakdown.discount.toLocaleString() + ' ' + currency;

  // Promo code applies on top of item offers, against the item-discounted subtotal.
  const codeDiscount = codeDiscountFor(breakdown.total);
  renderPromoCodeUI(codeDiscount, currency);
  const codeRow = document.getElementById('cartCodeRow');
  const codeEl = document.getElementById('cartCodeDiscount');
  if (codeRow) codeRow.style.display = codeDiscount > 0 ? 'flex' : 'none';
  if (codeEl) codeEl.textContent = '- ' + codeDiscount.toLocaleString() + ' ' + currency;
  if (appliedPromo && codeDiscount === 0) {
    const msg = document.getElementById('promoCodeMsg');
    if (msg) { msg.textContent = promoCodeReasonText('min_order', appliedPromo.minOrderSubtotal); msg.className = 'promo-code-msg error'; }
  }

  const grand = Math.max(0, Math.round((breakdown.total - codeDiscount + Number.EPSILON) * 100) / 100);
  const showGrand = hasDiscount || codeDiscount > 0;
  if (grandRow) grandRow.style.display = showGrand ? 'flex' : 'none';
  if (grandEl) grandEl.textContent = grand.toLocaleString() + ' ' + currency;
}

// ===== SCROLL TO ORDER =====
function scrollToOrder() {
  const el = document.getElementById('order');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== TOAST =====
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-show'));
  setTimeout(() => { toast.classList.remove('toast-show'); setTimeout(() => toast.remove(), 400); }, 4000);
}

// ===== PHONE VALIDATION =====
function isValidEgyptianPhone(phone) {
  return /^01[0125][0-9]{8}$/.test(phone.replace(/\s/g, ''));
}

// ===== SUCCESS STATE =====
function showSuccess() {
  const form = document.getElementById('orderForm');
  const success = document.getElementById('orderSuccess');
  if (form) form.style.display = 'none';
  if (success) success.style.display = 'flex';
  cart = [];
  renderCart();
  const upsellBanner = document.getElementById('upsellBanner');
  if (upsellBanner) upsellBanner.style.display = 'none';
}

function resetForm() {
  const form = document.getElementById('orderForm');
  const success = document.getElementById('orderSuccess');
  if (form) { form.reset(); form.style.display = 'block'; }
  if (success) success.style.display = 'none';
}

// ===== SUBMIT ORDER =====
async function submitOrder(e) {
  e.preventDefault();
  if (cart.length === 0) { showToast(t('toast_empty_cart'), 'error'); return; }

  const btn = document.getElementById('submitBtn');
  const txt = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');

  const fields = ['fullName', 'phone', 'city', 'address'];
  let valid = true;
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      if (el) { el.style.borderColor = '#ff4444'; el.style.boxShadow = '0 0 0 3px rgba(255,68,68,0.15)'; }
      valid = false;
    } else {
      el.style.borderColor = '';
      el.style.boxShadow = '';
    }
  });

  const phoneEl = document.getElementById('phone');
  if (phoneEl && phoneEl.value.trim() && !isValidEgyptianPhone(phoneEl.value.trim())) {
    phoneEl.style.borderColor = '#ff4444';
    phoneEl.style.boxShadow = '0 0 0 3px rgba(255,68,68,0.15)';
    showToast(t('toast_invalid_phone'), 'error');
    return;
  }

  if (!valid) { showToast(t('toast_fill_fields'), 'error'); return; }

  const payload = {
    fullName: document.getElementById('fullName').value.trim(),
    phone:    document.getElementById('phone').value.trim(),
    city:     document.getElementById('city').value.trim(),
    address:  document.getElementById('address').value.trim(),
    notes:    document.getElementById('notes')?.value.trim() || '',
    shippingFee: 0,
    discount: 0,
    promoCode: appliedPromo ? appliedPromo.code : undefined,
    items: cart.map(i => ({
      productId:  i.productId || null,
      itemType:   i.itemType,
      itemName:   i.itemName,
      cableType:  i.cableType || null,
      quantity:   i.quantity,
      unitPrice:  i.unitPrice,
    })),
  };

  txt.style.display = 'none';
  loader.style.display = 'inline';
  btn.disabled = true;

  try {
    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = result.errors ? result.errors.map(e => e.message).join(', ') : result.message;
      throw new Error(msg);
    }
    appliedPromo = null;
    // Meta Pixel — Purchase
    if (typeof fbq !== 'undefined') {
      const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      fbq('track', 'Purchase', {
        value: total,
        currency: 'EGP',
        content_ids: cart.map(i => i.productId || i.itemType),
        content_type: 'product',
        num_items: cart.reduce((s, i) => s + i.quantity, 0),
      });
    }
    showSuccess();
  } catch (err) {
    showToast(err.message || t('toast_error'), 'error');
  } finally {
    txt.style.display = 'inline';
    loader.style.display = 'none';
    btn.disabled = cart.length === 0;
  }
}

// ===== ESCAPE HTML =====
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== INIT =====
renderCart();
loadProducts();
renderStructuredContent();
observeReveal();

document.addEventListener('star:site-config-loaded', () => {
  renderCart();
  updateBundlePricing();
  renderStructuredContent();
});

window.renderStructuredContent = renderStructuredContent;
