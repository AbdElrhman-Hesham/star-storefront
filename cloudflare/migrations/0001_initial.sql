PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  short_description TEXT,
  price REAL NOT NULL,
  old_price REAL,
  image_url TEXT,
  category TEXT NOT NULL DEFAULT 'Accessories',
  stock INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_featured INTEGER DEFAULT 0 CHECK (is_featured IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT,
  admin_notes TEXT,
  subtotal REAL DEFAULT 0,
  shipping_fee REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  status TEXT DEFAULT 'new' CHECK (status IN ('new','confirmed','shipping','delivered','cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  item_type TEXT NOT NULL DEFAULT 'product',
  item_name TEXT NOT NULL,
  cable_type TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  total_price REAL DEFAULT 0,
  selected_options TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key TEXT NOT NULL UNIQUE,
  value_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_active_featured ON products(is_active, is_featured);
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

INSERT OR IGNORE INTO products
  (id, name, slug, description, short_description, price, old_price, image_url, category, stock, is_active, is_featured)
VALUES
  (1, 'START S015 Magnetic Phone Holder', 'magnetic-phone-holder', 'Ultra-strong N52 magnetic grip, 360 degree rotation, premium metal finish. Fits any car vent.', 'Strong N52 mag hold - 360 degree rotation - Universal vent fit', 199, 249, '/assets/images/holder_white.png', 'Phone Mounts', 100, 1, 1),
  (2, 'Premium Magnetic Holder', 'premium-magnetic-holder', 'Reinforced rare-earth magnet with premium brushed finish. Holds phones up to 400g securely.', 'Premium finish - Extra strong magnet - Pro look', 299, 399, '/assets/images/holder_detail.png', 'Phone Mounts', 50, 1, 0),
  (3, 'AORAX Lightning Cable', 'fast-charging-cable', 'Durable braided nylon cable supporting fast charging. 1.5m length with heavy-duty connectors.', 'Braided nylon - Fast charge - 1.5m', 149, 199, '/assets/images/cable_white.png', 'Charging', 200, 1, 0),
  (4, 'Soloffer C253 Car Charger', 'fast-car-charger', '52.5W dual fast charging - PD 30W Type-C + QC 22.5W USB-A. Premium metal construction.', '52.5W Dual Port - PD 30W + QC 22.5W - Metal design', 299, 349, '/assets/images/charger_white.png', 'Charging', 80, 1, 1),
  (5, 'Cable Organizer Clip', 'cable-organizer', 'Keep your charging cables tidy with this premium magnetic cable clip. No more tangled wires.', 'Magnetic clip - Tidy cables - Easy mount', 99, 129, '/assets/images/cable_detail.png', 'Organization', 150, 1, 0),
  (6, 'Basic Driver Kit', 'basic-driver-kit', '1x START S015 Magnetic Holder + 1x AORAX Charging Cable. Great value setup.', 'Holder + Cable - Free delivery', 299, 399, '/assets/images/holder_car.png', 'Driver Bundles', 100, 1, 1),
  (7, 'Pro Driver Kit', 'pro-driver-kit', '1x START S015 Magnetic Holder + 1x Soloffer C253 Car Charger + 1x AORAX Charging Cable. The ultimate professional setup.', 'Complete package - Most popular - Uber/Careem ready', 900, 1200, '/assets/images/bundle_box.png', 'Driver Bundles', 75, 1, 1),
  (8, 'VIP Driver Kit', 'vip-driver-kit', '1x Premium Magnetic Holder + 1x Soloffer C253 Car Charger + 2x AORAX Charging Cables + 1x Cable Organizer. The ultimate professional setup.', 'Full VIP setup - 2 cables + organizer - Premium look', 999, 1399, '/assets/images/bundle_box.png', 'Driver Bundles', 50, 1, 1);
