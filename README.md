# Shelf Check

**One selfie in, the right products from *this* store's shelf out.**

Beauty shoppers stand in front of 40 serums and ask one question: *which one is for me?* Shelf Check answers it with the
[YouCam Skin Analysis API](https://docs.perfectcorp.com/reference/description/ai_skin_analysis.md): it measures eight
skin concerns from a front-facing selfie (acne, pores, redness, oiliness, hydration, fine lines, dark circles, dark
spots) and ranks only the products the store actually stocks by how much of the shopper's measured need each one covers.
Every pick says *why* ("For: Dehydration, Redness"), so the shopper trusts it and the store sells what it has.

Built for the YouCam API Skin AI & eCommerce VTO Hackathon by Design Master Solutions LLC.

## How it works

1. The browser sends the selfie to `POST /api/check`.
2. The server calls the YouCam **File API**, uploads to the pre-signed URL, starts a **skin-analysis** task
   (SD, 8 concerns, 12 units) and polls until `success`.
3. `need = 100 - raw_score` per concern. Each catalog item scores the sum of the needs it treats; ties go to the cheaper
   item. Top 3 are returned with the concerns that justified them.

The store's catalog is a plain `catalog.json` (`sku`, `name`, `price`, `treats`), so any shop can plug in its own shelf.

## Run

```bash
export YOUCAM_API_KEY=...   # from yce.makeupar.com/api-console
python3 server.py           # http://127.0.0.1:8090, no dependencies (Python 3.9+ stdlib)
```

Without a key, or with **Use sample selfie**, the app replays a real API response captured from the sample photo
(`fixtures/skin-result.json`), so judges can try it without spending units.

## Test

```bash
python3 -m unittest discover -s tests
```

## Credits

Sample selfie: "Kimberlee-Weatherall-profile.jpg", Wikimedia Commons, CC0. Catalog: 10 sample SKUs for a demo store.
