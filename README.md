# STAR Storefront

Arabic/English storefront for a small car-accessories shop, with a cart and cash-on-delivery checkout, product pages, an admin dashboard (orders, products, promotions, promo codes, reviews, site texts and media) and a Cloudflare Worker backend on D1 (SQLite) and KV.

## Status

Source snapshot of a store that runs live. This repository is not the deployment: checkout and pricing repairs in this source have not been deployed from here, and the older server deployment is not included.

## What is here

| Path | Contents |
|---|---|
| `index.html`, `product.html`, `js/`, `css/`, `assets/` | Static storefront (bilingual, RTL/LTR) and product imagery. |
| `admin.html` | Admin dashboard served by the same Worker. |
| `cloudflare/src/` | Worker API: products, orders (server-side pricing), promotions and promo codes, reviews, site settings, media, admin auth. |
| `cloudflare/migrations/` | D1 schema migrations. |
| `cloudflare/test/orders.test.mjs` | Synthetic checkout tests on an in-memory SQLite database. |

## Replaced or not included

- Live orders, customers, reviews and any database export.
- Secrets (`ADMIN_PASSWORD`, `JWT_SECRET`, optional `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_ID`) — set them as Worker secrets.
- Cloudflare D1 database ID and KV namespace ID → `REPLACE_WITH_YOUR_ID` in `cloudflare/wrangler.jsonc`. The custom-domain routes there point to the store's own domain; change them for your deployment.
- Store contact and tracking identifiers → placeholders: WhatsApp/support number `201000000000`, Meta Pixel ID `YOUR_META_PIXEL_ID`, Facebook/Instagram links empty.

The STAR name, logos and product images are the store's brand assets and are not licensed for reuse.

## Running

Serve the repository root as static files for the storefront. For the Worker, use the scripts in `cloudflare/package.json` with Wrangler after filling in the IDs and secrets above.

## Verification

```
node --test cloudflare/test/orders.test.mjs     # 10 passed (Node 24, synthetic data)
```

The tests cover server-side pricing, promo codes, input validation, rate limiting, admin auth and the browser/server promotion-math mirror. They do not touch Cloudflare, WhatsApp or the live store.

## License

No license file is included; no open-source license is granted.

## Portfolio

https://abdelrahman-hesham-portfolio.vercel.app
