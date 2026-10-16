-- Per-product quick sale + promo codes (coupons).
-- A product "sale" is treated by the pricing engine as a low-priority special_price
-- promotion targeting that one product (see productSalePromotion in promo-core.js),
-- so an explicit promotion always overrides it.
ALTER TABLE products ADD COLUMN sale_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN sale_price REAL;
ALTER TABLE products ADD COLUMN sale_ends_at TEXT;

-- Coupon codes applied at checkout, on top of item-level offers, to the order.
CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- stored uppercase
  discount_type TEXT NOT NULL,         -- 'percent' | 'fixed'
  discount_value REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  starts_at TEXT,                      -- NULL = live immediately
  ends_at TEXT,                        -- NULL = no expiry
  min_order_subtotal REAL NOT NULL DEFAULT 0,
  max_uses INTEGER,                    -- NULL = unlimited
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active, code);

-- Record which code was used on each order and how much it saved (survives code edits/deletes).
ALTER TABLE orders ADD COLUMN promo_code TEXT;
ALTER TABLE orders ADD COLUMN promo_code_discount REAL NOT NULL DEFAULT 0;
