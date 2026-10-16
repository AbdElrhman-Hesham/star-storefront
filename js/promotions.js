/**
 * STAR promotions — browser helpers (window.STAR_PROMO).
 *
 * The pricing math below is a mirror of cloudflare/src/promo-core.js. The server
 * is the source of truth for what a customer pays; this copy only powers the UI
 * (badges, sale prices, countdowns, cart preview). Keep the two in sync.
 */
(function () {
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function toTime(value) {
    if (!value) return null;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }

  function cap(value) {
    if (value == null || value === '') return null;
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }

  function isPromotionLive(promo, nowMs) {
    if (!promo || !(promo.isActive === true || promo.isActive === 1)) return false;
    const start = toTime(promo.startsAt);
    const end = toTime(promo.endsAt);
    if (start != null && nowMs < start) return false;
    if (end != null && nowMs >= end) return false;
    return true;
  }

  function promotionTargetsProduct(promo, productId) {
    if (!promo) return false;
    if (promo.appliesTo === 'all') return true;
    if (promo.appliesTo === 'products') {
      return Array.isArray(promo.productIds) && promo.productIds.map(Number).includes(Number(productId));
    }
    return false;
  }

  // A product's own quick sale as a low-priority special_price promotion (sentinel id -1).
  function productSalePromotion(product) {
    if (!product) return null;
    if (!(product.saleActive === true || product.saleActive === 1)) return null;
    const sp = Number(product.salePrice);
    const price = Number(product.price) || 0;
    if (!Number.isFinite(sp) || sp < 0 || sp >= price) return null;
    return {
      id: -1,
      title: product.saleTitle || 'Sale',
      offerType: 'special_price',
      specialPrice: sp,
      appliesTo: 'products',
      productIds: [Number(product.id)],
      priority: 0,
      allowStacking: false,
      isActive: true,
      startsAt: null,
      endsAt: product.saleEndsAt || null,
      badgeText: '',
    };
  }

  function withProductSale(promotions, product) {
    const sale = productSalePromotion(product);
    return sale ? (promotions || []).concat([sale]) : (promotions || []);
  }

  function applicablePromotions(promotions, productId, nowMs) {
    return (promotions || [])
      .filter(function (p) { return isPromotionLive(p, nowMs) && promotionTargetsProduct(p, productId); })
      .sort(function (a, b) {
        return (Number(b.priority || 0) - Number(a.priority || 0)) || (Number(b.id || 0) - Number(a.id || 0));
      });
  }

  function summarizePromotion(promo) {
    if (!promo) return null;
    return {
      id: promo.id,
      title: promo.title,
      offerType: promo.offerType,
      badgeText: promo.badgeText || '',
      buyQty: promo.buyQty != null ? promo.buyQty : null,
      getQty: promo.getQty != null ? promo.getQty : null,
      discountPercent: promo.discountPercent != null ? promo.discountPercent : null,
      discountAmount: promo.discountAmount != null ? promo.discountAmount : null,
      specialPrice: promo.specialPrice != null ? promo.specialPrice : null,
    };
  }

  function computeLine(product, qty, promotions, nowMs) {
    const price = Math.max(0, Number(product.price) || 0);
    const quantity = Math.max(0, Math.floor(Number(qty) || 0));
    const originalTotal = round2(price * quantity);

    const base = {
      productId: Number(product.id),
      quantity: quantity,
      originalUnitPrice: price,
      originalTotal: originalTotal,
      saleUnitPrice: price,
      effectiveUnitPrice: price,
      freeQty: 0,
      paidQty: quantity,
      lineTotal: originalTotal,
      discount: 0,
      appliedPromotion: null,
      stackedPromotions: [],
    };

    const applicable = applicablePromotions(promotions, product.id, nowMs);
    if (!applicable.length || quantity <= 0) return base;

    const winner = applicable[0];
    const stack = winner.allowStacking
      ? applicable.filter(function (p, i) { return i === 0 || p.allowStacking; })
      : [winner];

    let freeQty = 0;
    const bogo = stack.find(function (p) { return p.offerType === 'bogo'; });
    if (bogo) {
      const buy = Math.max(1, Math.floor(Number(bogo.buyQty) || 1));
      const get = Math.max(1, Math.floor(Number(bogo.getQty) || 1));
      let groups = Math.floor(quantity / (buy + get));
      const mu = cap(bogo.maxUsesPerOrder);
      if (mu != null) groups = Math.min(groups, mu);
      freeQty = groups * get;
      const mf = cap(bogo.maxFreeQty);
      if (mf != null) freeQty = Math.min(freeQty, mf);
    }

    let unit = price;
    stack.forEach(function (p) {
      if (p.offerType === 'percent') {
        unit *= (1 - Math.min(100, Math.max(0, Number(p.discountPercent) || 0)) / 100);
      } else if (p.offerType === 'fixed') {
        unit = Math.max(0, unit - Math.max(0, Number(p.discountAmount) || 0));
      } else if (p.offerType === 'special_price') {
        unit = Math.min(unit, Math.max(0, Number(p.specialPrice) || 0));
      }
    });
    unit = round2(unit);

    const paidQty = Math.max(0, quantity - freeQty);
    let discountedUnits = paidQty;
    if (winner.offerType !== 'bogo') {
      const mu = cap(winner.maxUsesPerOrder);
      if (mu != null) discountedUnits = Math.min(paidQty, mu);
    }
    const fullUnits = paidQty - discountedUnits;
    const lineTotal = round2(fullUnits * price + discountedUnits * unit);
    const discount = round2(originalTotal - lineTotal);

    return Object.assign({}, base, {
      saleUnitPrice: unit,
      effectiveUnitPrice: quantity > 0 ? round2(lineTotal / quantity) : price,
      freeQty: freeQty,
      paidQty: paidQty,
      lineTotal: lineTotal,
      discount: discount,
      appliedPromotion: summarizePromotion(winner),
      stackedPromotions: stack.map(summarizePromotion),
    });
  }

  // Best live promotion for a product (or null) — used for card/PDP display.
  function bestPromotion(promotions, productId, nowMs) {
    const list = applicablePromotions(promotions, productId, nowMs || Date.now());
    return list.length ? list[0] : null;
  }

  // Human badge label. Uses the admin-typed badge if present, else a sensible default.
  function badgeText(promo, lang) {
    if (!promo) return '';
    if (promo.badgeText) return promo.badgeText;
    const ar = lang === 'ar';
    switch (promo.offerType) {
      case 'bogo': {
        const b = Number(promo.buyQty) || 1;
        const g = Number(promo.getQty) || 1;
        return ar ? ('اشترِ ' + b + ' واحصل على ' + g + ' مجانًا') : ('Buy ' + b + ' Get ' + g + ' Free');
      }
      case 'percent':
        return ar ? ('خصم ' + (Number(promo.discountPercent) || 0) + '%') : ('-' + (Number(promo.discountPercent) || 0) + '%');
      case 'fixed':
        return ar ? 'خصم' : 'Sale';
      case 'special_price':
        return ar ? 'عرض' : 'Sale';
      default:
        return ar ? 'عرض' : 'Sale';
    }
  }

  // Short offer description for the customer.
  function offerDescription(promo, lang) {
    if (!promo) return '';
    if (promo.description) return promo.description;
    return badgeText(promo, lang);
  }

  // ms remaining until the offer ends (null if it has no end).
  function msRemaining(promo, nowMs) {
    const end = toTime(promo && promo.endsAt);
    if (end == null) return null;
    return Math.max(0, end - (nowMs || Date.now()));
  }

  // Break a duration into d/h/m/s parts for the countdown widget.
  function countdownParts(ms) {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    return {
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
      totalSeconds: total,
    };
  }

  window.STAR_PROMO = {
    round2: round2,
    isPromotionLive: isPromotionLive,
    promotionTargetsProduct: promotionTargetsProduct,
    productSalePromotion: productSalePromotion,
    withProductSale: withProductSale,
    applicablePromotions: applicablePromotions,
    computeLine: computeLine,
    bestPromotion: bestPromotion,
    badgeText: badgeText,
    offerDescription: offerDescription,
    msRemaining: msRemaining,
    countdownParts: countdownParts,
  };
})();
