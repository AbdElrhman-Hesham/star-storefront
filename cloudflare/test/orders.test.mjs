// Checkout/order rules of the STAR Worker, run against a local stand-in for D1.
//
// The D1 binding is an in-memory SQLite database (node:sqlite) built from this
// project's own migrations, so the real SQL in src/ runs unchanged. Nothing here
// touches Cloudflare, the live store, WhatsApp or any real order: no WHATSAPP_*
// variables are set, ASSETS is a stub and every request is a synthetic Request.
//
// Run from cloudflare/:  node --no-warnings --test test/orders.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/index.js';
import { computeLine as serverComputeLine, withProductSale as serverWithProductSale } from '../src/promo-core.js';

const here = new URL('.', import.meta.url);
const migrations = new URL('../migrations/', here);

function createD1() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
  const norm = (value) => {
    if (value === undefined) throw new TypeError('D1_TYPE_ERROR: undefined cannot be bound');
    return typeof value === 'boolean' ? Number(value) : value;
  };
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { return new Statement(this.sql, args.map(norm)); }
    async first(column) {
      const row = db.prepare(this.sql).get(...this.args);
      if (!row) return null;
      return column ? row[column] : { ...row };
    }
    async all() { return { success: true, results: db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })), meta: {} }; }
    async run() {
      const info = db.prepare(this.sql).run(...this.args);
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    }
  }
  return {
    sqlite: db,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const statement of statements) out.push(await statement.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function setup() {
  const DB = createD1();
  const env = { DB, ASSETS: { fetch: async () => new Response('asset') }, JWT_SECRET: 'test-only-secret', ADMIN_PASSWORD: 'test-only' };
  const ctx = { waitUntil() {} };
  const call = async (method, path, body, headers = {}) => {
    const init = { method, headers: { 'cf-connecting-ip': '203.0.113.7', ...headers } };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await worker.fetch(new Request(`https://star.test${path}`, init), env, ctx);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { DB, env, call };
}

const customer = { fullName: 'Test Buyer', phone: '01012345678', city: 'Cairo', address: '1 Test Street' };
const order = (items, extra = {}) => ({ ...customer, shippingFee: 0, discount: 0, ...extra, items });
const line = (productId, quantity, unitPrice, name = 'Item') => ({ productId, itemType: 'product', itemName: name, quantity, unitPrice });
const orderCount = (DB) => DB.sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n;

test('active product is priced from the database, not from the browser', async () => {
  const { call } = setup();
  const res = await call('POST', '/api/orders', order([line(4, 2, 1, 'Car charger')]));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.total, 598);
  assert.equal(res.body.data.items[0].unitPrice, 299);
});

test('a line without a product id cannot set its own price', async () => {
  const { DB, call } = setup();
  const res = await call('POST', '/api/orders', order([{ itemType: 'product', itemName: 'Pro Driver Kit', quantity: 1, unitPrice: 0 }]));
  assert.equal(res.status, 400, `expected rejection, got ${res.status} total=${res.body?.data?.total}`);
  assert.equal(orderCount(DB), 0);
});

test('an inactive product cannot be ordered at a browser-chosen price', async () => {
  const { DB, call } = setup();
  DB.sqlite.exec('UPDATE products SET is_active = 0 WHERE id = 7');
  const res = await call('POST', '/api/orders', order([line(7, 1, 1, 'Pro Driver Kit')]));
  assert.equal(res.status, 400, `expected rejection, got ${res.status} total=${res.body?.data?.total}`);
  assert.equal(orderCount(DB), 0);
});

test('an unknown product id is rejected', async () => {
  const { DB, call } = setup();
  const res = await call('POST', '/api/orders', order([line(999, 1, 5)]));
  assert.equal(res.status, 400);
  assert.equal(orderCount(DB), 0);
});

test('promo code and discount are recomputed on the server', async () => {
  const { DB, call } = setup();
  DB.sqlite.exec("INSERT INTO promo_codes (code, discount_type, discount_value) VALUES ('SAVE10', 'percent', 10)");
  const res = await call('POST', '/api/orders', order([line(1, 1, 199)], { promoCode: 'save10', discount: 500 }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.promoCode, 'SAVE10');
  assert.equal(res.body.data.total, 179.1);
  assert.equal(DB.sqlite.prepare("SELECT used_count FROM promo_codes WHERE code = 'SAVE10'").get().used_count, 1);
});

test('an expired promo code gives no discount', async () => {
  const { DB, call } = setup();
  DB.sqlite.exec("INSERT INTO promo_codes (code, discount_type, discount_value, ends_at) VALUES ('OLD', 'fixed', 50, '2020-01-01T00:00:00Z')");
  const res = await call('POST', '/api/orders', order([line(1, 1, 199)], { promoCode: 'OLD' }));
  assert.equal(res.status, 201);
  assert.equal(res.body.data.total, 199);
  assert.equal(res.body.data.promoCode, null);
});

test('invalid customer details are rejected before anything is stored', async () => {
  const { DB, call } = setup();
  const res = await call('POST', '/api/orders', { ...order([line(1, 1, 199)]), phone: '12345' });
  assert.equal(res.status, 400);
  assert.equal(orderCount(DB), 0);
});

test('orders are rate limited per client IP (10 per 10 minutes)', async () => {
  const { call } = setup();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await call('POST', '/api/orders', order([line(5, 1, 99)]))).status, 201);
  }
  assert.equal((await call('POST', '/api/orders', order([line(5, 1, 99)]))).status, 429);
});

test('admin order routes require a valid admin token', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/orders/admin')).status, 401);
  assert.equal((await call('GET', '/api/orders/admin', undefined, { authorization: 'Bearer aaa.bbb.ccc' })).status, 401);
});

test('browser promotion math matches the server (js/promotions.js mirror)', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../../js/promotions.js', here), 'utf8'), sandbox);
  const browser = sandbox.window.STAR_PROMO;
  const now = Date.parse('2026-10-16T12:00:00Z');
  const promos = [
    { id: 1, offerType: 'bogo', buyQty: 2, getQty: 1, appliesTo: 'products', productIds: [1], priority: 5, isActive: true, maxFreeQty: 2 },
    { id: 2, offerType: 'percent', discountPercent: 15, appliesTo: 'all', priority: 1, isActive: true, allowStacking: true },
    { id: 3, offerType: 'fixed', discountAmount: 20, appliesTo: 'products', productIds: [2], priority: 3, isActive: true, allowStacking: true, maxUsesPerOrder: 2 },
    { id: 4, offerType: 'special_price', specialPrice: 120, appliesTo: 'products', productIds: [3], priority: 9, isActive: true, endsAt: '2026-10-16T11:00:00Z' },
  ];
  const products = [{ id: 1, price: 199 }, { id: 2, price: 299 }, { id: 3, price: 149 }, { id: 4, price: 99.5, saleActive: 1, salePrice: 79.9 }];
  for (const product of products) {
    for (const qty of [0, 1, 2, 3, 5, 7]) {
      for (const set of [[], promos, promos.slice(1)]) {
        const a = serverComputeLine(product, qty, serverWithProductSale(set, product), now);
        const b = browser.computeLine(product, qty, browser.withProductSale(set, product), now);
        for (const key of ['lineTotal', 'discount', 'freeQty', 'paidQty', 'saleUnitPrice']) {
          assert.equal(b[key], a[key], `product ${product.id} qty ${qty} ${key}`);
        }
      }
    }
  }
});
