-- Sales & Promotions engine.
-- Timestamps (starts_at / ends_at) are stored as ISO-8601 UTC strings so the
-- server can decide "is this offer live right now?" from a single trusted clock.
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  badge_text TEXT,
  -- 'bogo' (buy X get Y free) | 'percent' | 'fixed' | 'special_price'
  offer_type TEXT NOT NULL,
  buy_qty INTEGER,
  get_qty INTEGER,
  discount_percent REAL,
  discount_amount REAL,
  special_price REAL,
  -- 'all' (every product) | 'products' (product_ids list)
  applies_to TEXT NOT NULL DEFAULT 'all',
  product_ids TEXT,                    -- JSON array of product ids when applies_to = 'products'
  priority INTEGER NOT NULL DEFAULT 0, -- higher wins when several offers hit one product
  allow_stacking INTEGER NOT NULL DEFAULT 0 CHECK (allow_stacking IN (0, 1)),
  starts_at TEXT,                      -- NULL = live immediately
  ends_at TEXT,                        -- NULL = no end / no countdown
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  max_uses_per_order INTEGER,          -- caps bogo groups / discounted units per order
  max_free_qty INTEGER,                -- caps free units per order (bogo)
  available_to_all INTEGER NOT NULL DEFAULT 1 CHECK (available_to_all IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promotions_active
  ON promotions(is_active, starts_at, ends_at, priority DESC);
