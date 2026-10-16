(function () {
  const API = (window.STAR_CONFIG && window.STAR_CONFIG.API_URL) || '/api';
  const LANG = localStorage.getItem('star_lang') || 'en';
  const RTL = LANG === 'ar';
  const id = Number(new URLSearchParams(location.search).get('id'));
  const root = document.getElementById('pdpRoot');
  let currency = 'EGP';
  let selectedRating = 0;

  const T = {
    en: {
      inStock: 'In stock', lowStock: 'Only {n} left', outStock: 'Out of stock',
      order: 'Order Now', save: 'Save {n}',
      reviewsTitle: 'Customer Reviews',
      noReviews: 'No reviews yet. Be the first to review this product!',
      basedOn: 'based on {n} review(s)', writeTitle: 'Write a review',
      yourName: 'Your name', yourRating: 'Your rating', yourReview: 'Your review',
      submit: 'Submit review', submitting: 'Submitting…',
      thanks: 'Thank you! Your review will appear after it is approved.',
      fillAll: 'Please add your name, a rating, and a review.',
      genericErr: 'Something went wrong. Please try again.',
      notFound: 'Product not found.', backLink: 'Go back to the store',
      namePh: 'e.g. Ahmed', reviewPh: 'Share your experience with this product…',
    },
    ar: {
      inStock: 'متوفر', lowStock: 'باقي {n} بس', outStock: 'غير متوفر',
      order: 'اطلب الآن', save: 'وفّرت {n}',
      reviewsTitle: 'تقييمات العملاء',
      noReviews: 'مفيش تقييمات لسه. كن أول من يقيّم المنتج ده!',
      basedOn: 'بناءً على {n} تقييم', writeTitle: 'اكتب تقييم',
      yourName: 'اسمك', yourRating: 'تقييمك', yourReview: 'رأيك',
      submit: 'أرسل التقييم', submitting: 'جاري الإرسال…',
      thanks: 'شكراً! تقييمك هيظهر بعد الموافقة عليه.',
      fillAll: 'من فضلك اكتب اسمك والتقييم والرأي.',
      genericErr: 'حصل خطأ. حاول تاني.',
      notFound: 'المنتج غير موجود.', backLink: 'ارجع للمتجر',
      namePh: 'مثال: أحمد', reviewPh: 'شاركنا تجربتك مع المنتج…',
    },
  };
  const L = T[LANG] || T.en;
  const tt = (k, n) => String(L[k] || k).replace('{n}', n);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clamp = (r) => Math.max(0, Math.min(5, Math.round(Number(r) || 0)));
  const stars = (r) => '★'.repeat(clamp(r)) + '☆'.repeat(5 - clamp(r));
  const fmt = (n) => Number(n || 0).toLocaleString(RTL ? 'ar-EG' : 'en-US');

  // ===== Promotions (mirrors the storefront cards) =====
  const PROMO = () => window.STAR_PROMO;
  let activePromotions = [];
  let promoTimer = null;

  function pdpPricing(p) {
    const promos = PROMO() ? PROMO().withProductSale(activePromotions, p) : [];
    const promo = PROMO() ? PROMO().bestPromotion(promos, p.id, Date.now()) : null;
    if (!promo) {
      const has = p.oldPrice && p.oldPrice > p.price;
      return { promo: null, isBogo: false, salePrice: p.price, oldPrice: has ? p.oldPrice : null };
    }
    const line = PROMO().computeLine({ id: p.id, price: p.price }, 1, promos, Date.now());
    const isBogo = promo.offerType === 'bogo';
    const salePrice = isBogo ? p.price : line.saleUnitPrice;
    const showStrike = !isBogo && salePrice < p.price;
    return {
      promo, isBogo, salePrice,
      oldPrice: showStrike ? p.price : (p.oldPrice && p.oldPrice > p.price ? p.oldPrice : null),
      badge: PROMO().badgeText(promo, LANG),
      desc: PROMO().offerDescription(promo, LANG),
    };
  }

  function countdownInner(ms) {
    const c = PROMO().countdownParts(ms);
    const lbl = RTL ? { d: 'ي', h: 'س', m: 'د', s: 'ث' } : { d: 'd', h: 'h', m: 'm', s: 's' };
    const cell = (v, x) => `<span class="pdp-timer-cell"><b>${String(v).padStart(2, '0')}</b><i>${x}</i></span>`;
    const parts = [];
    if (c.days > 0) parts.push(cell(c.days, lbl.d));
    parts.push(cell(c.hours, lbl.h), cell(c.minutes, lbl.m), cell(c.seconds, lbl.s));
    return parts.join('');
  }

  function timerHtml(promo) {
    if (!promo || !promo.endsAt) return '';
    const label = RTL ? 'ينتهي خلال' : 'Ends in';
    return `<div class="pdp-timer" data-ends="${esc(promo.endsAt)}">
      <span class="pdp-timer-label">${label}</span>
      <span class="pdp-timer-clock">${countdownInner(PROMO().msRemaining(promo, Date.now()))}</span>
    </div>`;
  }

  function startPromoTicker(product) {
    if (promoTimer || !PROMO()) return;
    promoTimer = setInterval(() => {
      const now = Date.now();
      let expired = false;
      document.querySelectorAll('.pdp-timer').forEach((el) => {
        const ms = Date.parse(el.getAttribute('data-ends')) - now;
        if (ms <= 0) expired = true;
        const clock = el.querySelector('.pdp-timer-clock');
        if (clock) clock.innerHTML = countdownInner(Math.max(0, ms));
      });
      if (expired) renderProduct(product);
    }, 1000);
  }

  function showError() {
    root.innerHTML = `<div class="pdp-empty"><p style="font-size:1.1rem;margin-bottom:12px">${esc(L.notFound)}</p><a href="index.html">${esc(L.backLink)}</a></div>`;
  }

  function renderProduct(p) {
    const cp = pdpPricing(p);
    const save = cp.oldPrice ? cp.oldPrice - cp.salePrice : 0;
    let stockCls = 'in';
    let stockTxt = L.inStock;
    if (p.stock <= 0) { stockCls = 'out'; stockTxt = L.outStock; }
    else if (p.stock <= 5) { stockCls = 'low'; stockTxt = tt('lowStock', p.stock); }

    root.innerHTML = `
      <div class="pdp-grid">
        <div class="pdp-media">
          ${cp.promo ? `<span class="pdp-promo-badge">${esc(cp.badge)}</span>` : ''}
          <img src="${esc(p.imageUrl || '/assets/images/product-1.jpg')}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='/assets/images/product-1.jpg'"/>
        </div>
        <div class="pdp-info">
          <div class="pdp-cat">${esc(p.category || '')}</div>
          <h1 class="pdp-title">${esc(p.name)}</h1>
          <div class="pdp-price-row">
            <span class="pdp-price">${fmt(cp.salePrice)} ${esc(currency)}</span>
            ${cp.oldPrice ? `<span class="pdp-old">${fmt(cp.oldPrice)} ${esc(currency)}</span><span class="pdp-save">${esc(tt('save', fmt(save) + ' ' + currency))}</span>` : ''}
          </div>
          ${cp.promo && cp.desc ? `<div class="pdp-offer">🏷️ ${esc(cp.desc)}</div>` : ''}
          ${timerHtml(cp.promo)}
          <div class="pdp-stock ${stockCls}">${esc(stockTxt)}</div>
          ${p.description ? `<div class="pdp-desc">${esc(p.description)}</div>` : ''}
          <button class="pdp-cta" ${p.stock <= 0 ? 'disabled' : ''} onclick="location.href='index.html?add=${p.id}'">${esc(L.order)}</button>
        </div>
      </div>
      <section class="pdp-reviews">
        <h2>${esc(L.reviewsTitle)}</h2>
        <div class="pdp-rev-summary" id="pdpRevSummary"></div>
        <div class="pdp-rev-list" id="pdpRevList"></div>
        <div class="pdp-form">
          <h3>${esc(L.writeTitle)}</h3>
          <div class="pdp-field">
            <label>${esc(L.yourRating)}</label>
            <div class="pdp-rating-input" id="pdpRating">${[1, 2, 3, 4, 5].map((i) => `<span data-v="${i}">★</span>`).join('')}</div>
          </div>
          <div class="pdp-field">
            <label for="rvName">${esc(L.yourName)}</label>
            <input id="rvName" type="text" maxlength="60" placeholder="${esc(L.namePh)}"/>
          </div>
          <div class="pdp-field">
            <label for="rvText">${esc(L.yourReview)}</label>
            <textarea id="rvText" rows="4" maxlength="1000" placeholder="${esc(L.reviewPh)}"></textarea>
          </div>
          <button class="pdp-cta" id="rvSubmit" style="max-width:220px" onclick="submitReview(${p.id})">${esc(L.submit)}</button>
          <div class="pdp-form-note" id="rvNote"></div>
        </div>
      </section>`;

    const rat = document.getElementById('pdpRating');
    rat.querySelectorAll('span').forEach((s) => {
      s.addEventListener('click', () => {
        selectedRating = Number(s.getAttribute('data-v'));
        rat.querySelectorAll('span').forEach((x) => x.classList.toggle('on', Number(x.getAttribute('data-v')) <= selectedRating));
      });
    });
  }

  async function loadReviews(pid) {
    try {
      const res = await fetch(`${API}/products/${pid}/reviews`);
      const j = await res.json();
      const list = document.getElementById('pdpRevList');
      const summary = document.getElementById('pdpRevSummary');
      const rows = j.data || [];
      if (!rows.length) {
        summary.innerHTML = '';
        list.innerHTML = `<div class="pdp-rev-empty">${esc(L.noReviews)}</div>`;
        return;
      }
      summary.innerHTML = `<span class="pdp-rev-avg">${j.averageRating}</span><span class="pdp-stars">${stars(j.averageRating)}</span><span>${esc(tt('basedOn', j.count))}</span>`;
      list.innerHTML = rows.map((r) => `
        <div class="pdp-rev-card">
          <div class="pdp-rev-head">
            <span class="pdp-rev-name">${esc(r.authorName)}</span>
            <span class="pdp-rev-date">${esc(new Date(r.createdAt).toLocaleDateString(RTL ? 'ar-EG' : 'en-GB'))}</span>
          </div>
          <div class="pdp-stars" style="margin-bottom:6px">${stars(r.rating)}</div>
          <div class="pdp-rev-text">${esc(r.comment)}</div>
        </div>`).join('');
    } catch (_) { /* keep silent */ }
  }

  window.submitReview = async function submitReview(pid) {
    const nameEl = document.getElementById('rvName');
    const textEl = document.getElementById('rvText');
    const note = document.getElementById('rvNote');
    const btn = document.getElementById('rvSubmit');
    const name = nameEl.value.trim();
    const text = textEl.value.trim();
    if (!name || !text || !selectedRating) {
      note.className = 'pdp-form-note err';
      note.textContent = L.fillAll;
      return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = L.submitting;
    try {
      const res = await fetch(`${API}/products/${pid}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorName: name, rating: selectedRating, comment: text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.errors ? j.errors.map((e) => e.message).join(', ') : (j.message || ''));
      note.className = 'pdp-form-note ok';
      note.textContent = j.message || L.thanks;
      nameEl.value = '';
      textEl.value = '';
      selectedRating = 0;
      document.querySelectorAll('#pdpRating span').forEach((x) => x.classList.remove('on'));
    } catch (e) {
      note.className = 'pdp-form-note err';
      note.textContent = e.message || L.genericErr;
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  };

  async function init() {
    document.documentElement.dir = RTL ? 'rtl' : 'ltr';
    document.documentElement.lang = LANG;
    if (!id) { showError(); return; }
    try { await window.STAR_SITE_READY; } catch (_) { /* ignore */ }
    try { currency = (window.STAR_SITE_SETTINGS && window.STAR_SITE_SETTINGS.currencyCode) || 'EGP'; } catch (_) { /* ignore */ }
    try {
      const [res] = await Promise.all([
        fetch(`${API}/products/${id}`),
        (async () => {
          try {
            const pr = await fetch(`${API}/promotions`, { cache: 'no-store' });
            if (pr.ok) { const pj = await pr.json(); activePromotions = Array.isArray(pj.data) ? pj.data : []; }
          } catch (_) { /* offers are optional */ }
        })(),
      ]);
      if (!res.ok) { showError(); return; }
      const j = await res.json();
      const product = j.data;
      if (!product) { showError(); return; }
      document.title = `${product.name} — STAR`;
      renderProduct(product);
      startPromoTicker(product);
      loadReviews(id);
    } catch (_) {
      showError();
    }
  }

  init();
})();
