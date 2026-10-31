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

The store's catalog is a plain `catalog.json` (`sku`, `name`, `price`, `treats`), so any shop can plug in its own shelf.

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
npm test   # Python unit tests + Worker parity with the Python ranking (incl. all six skin-type weightings)
```

## Credits

Sample selfie: "Kimberlee-Weatherall-profile.jpg", Wikimedia Commons, CC0. Catalog: 10 sample SKUs for a demo store.
