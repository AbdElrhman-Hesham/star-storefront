/**
 * Promotion math — the single source of truth for how an offer changes a price.
 *
 * IMPORTANT: this logic is mirrored, function-for-function, in the browser copy
 * at js/promotions.js (window.STAR_PROMO). If you change the math here, change it
 * there too. The server is authoritative; the browser copy only drives the UI.
 *
 * A "promotion" object here uses camelCase fields (see publicPromotion in
 * promotions.js): id, title, offerType, buyQty, getQty, discountPercent,
 * discountAmount, specialPrice, appliesTo, productIds, priority, allowStacking,
 * startsAt, endsAt, isActive, maxUsesPerOrder, maxFreeQty.
 */

export function round2(n) {
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

// Is this promotion switched on AND inside its scheduled window right now?
export function isPromotionLive(promo, nowMs) {
  if (!promo || !(promo.isActive === true || promo.isActive === 1)) return false;
  const start = toTime(promo.startsAt);
  const end = toTime(promo.endsAt);
  if (start != null && nowMs < start) return false;
  if (end != null && nowMs >= end) return false;
  return true;
}

// Does this promotion target the given product?
export function promotionTargetsProduct(promo, productId) {
  if (!promo) return false;
  if (promo.appliesTo === 'all') return true;
  if (promo.appliesTo === 'products') {
    return Array.isArray(promo.productIds) && promo.productIds.map(Number).includes(Number(productId));
  }
  return false;
}

// A product's own "quick sale" expressed as a promotion, so the same engine prices
// it. It is a low-priority special_price on that one product with a sentinel id (-1),
// so ANY real promotion (positive id / higher priority) overrides it on ties.
export function productSalePromotion(product) {
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

// Candidate promotions for a product = admin promotions + its own quick sale (if any).
export function withProductSale(promotions, product) {
  const sale = productSalePromotion(product);
  return sale ? (promotions || []).concat([sale]) : (promotions || []);
}

// Live + targeted promotions for a product, best (highest priority) first.
export function applicablePromotions(promotions, productId, nowMs) {
  return (promotions || [])
    .filter((p) => isPromotionLive(p, nowMs) && promotionTargetsProduct(p, productId))
    .sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)) || (Number(b.id || 0) - Number(a.id || 0)));
}

// A compact snapshot stored inside an order so it survives later edits/deletes.
export function summarizePromotion(promo) {
  if (!promo) return null;
  return {
    id: promo.id,
    title: promo.title,
    offerType: promo.offerType,
    badgeText: promo.badgeText || '',
    buyQty: promo.buyQty ?? null,
    getQty: promo.getQty ?? null,
    discountPercent: promo.discountPercent ?? null,
    discountAmount: promo.discountAmount ?? null,
    specialPrice: promo.specialPrice ?? null,
  };
}

/**
 * Compute the pricing outcome for one cart line.
 * @param product   { id, price }
 * @param qty       integer quantity in the cart
 * @param promotions full list of candidate promotions (camelCase)
 * @param nowMs      current time in ms (server clock is authoritative)
 * @returns breakdown incl. freeQty, lineTotal, discount, applied promotion snapshot.
 */
export function computeLine(product, qty, promotions, nowMs) {
  const price = Math.max(0, Number(product.price) || 0);
  const quantity = Math.max(0, Math.floor(Number(qty) || 0));
  const originalTotal = round2(price * quantity);

  const base = {
    productId: Number(product.id),
    quantity,
    originalUnitPrice: price,
    originalTotal,
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
    ? applicable.filter((p, i) => i === 0 || p.allowStacking)
    : [winner];

  // 1) Free units come from the highest-priority "buy X get Y" offer in the stack.
  let freeQty = 0;
  const bogo = stack.find((p) => p.offerType === 'bogo');
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

  // 2) Per-unit price after the stacked discount offers.
  let unit = price;
  stack.forEach((p) => {
    if (p.offerType === 'percent') {
      unit *= (1 - Math.min(100, Math.max(0, Number(p.discountPercent) || 0)) / 100);
    } else if (p.offerType === 'fixed') {
      unit = Math.max(0, unit - Math.max(0, Number(p.discountAmount) || 0));
    } else if (p.offerType === 'special_price') {
      unit = Math.min(unit, Math.max(0, Number(p.specialPrice) || 0));
    }
  });
  unit = round2(unit);

  // 3) Assemble the line. maxUsesPerOrder on a discount-type winner caps how many
  //    units get the discounted price; the rest stay at full price.
  const paidQty = Math.max(0, quantity - freeQty);
  let discountedUnits = paidQty;
  if (winner.offerType !== 'bogo') {
    const mu = cap(winner.maxUsesPerOrder);
    if (mu != null) discountedUnits = Math.min(paidQty, mu);
  }
  const fullUnits = paidQty - discountedUnits;
  const lineTotal = round2(fullUnits * price + discountedUnits * unit);
  const discount = round2(originalTotal - lineTotal);

  return {
    ...base,
    saleUnitPrice: unit,
    effectiveUnitPrice: quantity > 0 ? round2(lineTotal / quantity) : price,
    freeQty,
    paidQty,
    lineTotal,
    discount,
    appliedPromotion: summarizePromotion(winner),
    stackedPromotions: stack.map(summarizePromotion),
  };
}
