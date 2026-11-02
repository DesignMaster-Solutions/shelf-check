# Shelf Check

**One selfie in, the right products from *this* store's shelf out.**

Beauty shoppers stand in front of 40 serums and ask one question: *which one is for me?* Shelf Check answers it with two
YouCam APIs on one selfie: the [Skin Analysis API](https://docs.perfectcorp.com/reference/description/ai_skin_analysis.md)
measures eight skin concerns (acne, pores, redness, oiliness, hydration, fine lines, dark circles, dark spots) and the
[Fitzpatrick Skin Type API](https://docs.perfectcorp.com/reference/description/ai_fitzpatrick_skin_type.md) tells which of
those concerns matter *more* for that skin (photo-ageing on types I-II, post-inflammatory marks and visible dryness on
types IV-VI). Shelf Check then ranks only the products the store actually stocks by how much of the shopper's weighted
need each one covers. Every pick says *why* ("For: Dehydration, Redness"), so the shopper trusts it and the store sells
what it has.

Built for the YouCam API Skin AI & eCommerce VTO Hackathon by Design Master Solutions LLC.

**Live:** https://shelf-check.designmaster.workers.dev (real API on uploads; **Use sample selfie** replays a captured response).

## How it works

1. The browser sends the selfie to `POST /api/check`.
2. The server calls the YouCam **File API** once, uploads to the pre-signed URL, then runs two tasks on the same file in
   parallel: **skin-analysis** (SD, 8 concerns, 12 units) and **fitzpatrick-scale-analyzer** (type I-VI). Both are polled
   until `success`; if the skin-type task fails (face angle, lighting) the shopper still gets the skin map, weighed as measured.
3. The page shows the overall skin score, estimated skin age and Fitzpatrick type, one line on what that type means for
   the picks, and every concern bar opens the API's own mask overlay on the selfie, so the shopper sees *where* each
   concern was found (it opens on the biggest one).
4. `need = (100 - raw_score) x type weight` per concern (`FITZ` in `shelfcheck.py`: e.g. dark spots x1.3 on type V, fine
   lines and redness x1.2 on type I; weights never go below 1, so a measured need is never hidden). Each catalog item
   scores the sum of the needs it treats; ties go to the cheaper item. Top 3 are returned with the concerns that justified them.

The demo shelf is a plain `catalog.json` (`sku`, `name`, `price`, `treats`).

## Any Shopify store's shelf

Type a store's address under **Whose shelf?** (or open `/?store=sokoglam.com`) and Shelf Check ranks that store's real
products instead of the demo shelf. The Worker reads the store's public `/products.json` (first 250 products) and
`/meta.json` (name, currency), and keeps a product only if it is in stock, priced, made for the face (no lip, body or
hair products), and its **own title, product type or tags** claim one of the eight measured concerns: concern tags like
`Skin_Concern::Dryness/Hydration`, actives like niacinamide, salicylic acid, retinal, tranexamic acid, or words like
"eye cream" and "SPF". Nothing is inferred beyond the store's words, and every pick shows them ("Store says:
niacinamide, barrier"). Same-name listings collapse to the cheaper one.

The same scan gives the store owner a **shelf map**: how many products claim each concern, with gaps highlighted. On
sokoglam.com (01/11/2026) 131 of 250 listed products made the shelf, 86 claim hydration and 5 claim dark circles; on
kravebeauty.com 12 of 34 made it and none claims redness, pores or breakouts in its listing text. When a shopper's
low-scoring concern has nothing on the shelf, the page says so instead of selling something unrelated.

Each store's catalog is read at most once an hour and kept in Workers KV (`SHELVES`); Shopify answers HTTP 429 to
bursts, so a busy store serves its last good read, labeled with the time it was read. The shelf loads before any YouCam
unit is spent, so a wrong store address costs nothing. Only public DNS names are
fetched (no IPs, no internal hosts), and every store-supplied string is escaped before it reaches the page.

## Run

```bash
export YOUCAM_API_KEY=...   # from yce.makeupar.com/api-console
python3 server.py           # http://127.0.0.1:8090, no dependencies (Python 3.9+ stdlib)
```

Without a key, or with **Use sample selfie**, the app replays the real API responses captured from the sample photo
(`fixtures/skin-result.json`, `fixtures/fitzpatrick-result.json`), so judges can try it without spending units.

## Deploy (Cloudflare Workers)

`worker.js` is the same flow in JavaScript; `public/` holds the page, the sample selfie and the sample masks.

```bash
npx wrangler deploy
npx wrangler secret put YOUCAM_API_KEY
```

## Test

```bash
npm test   # Python unit tests, Worker parity with the Python ranking (all six skin types), Shopify shelf import
```

## Credits

Sample selfie: "Kimberlee-Weatherall-profile.jpg", Wikimedia Commons, CC0. Demo catalog: 10 sample SKUs. `fixtures/shopify-sokoglam.json`: the first 30 products of sokoglam.com's public catalog (01/11/2026), trimmed to title, handle, type, tags and variant price/stock, used only by the tests.
