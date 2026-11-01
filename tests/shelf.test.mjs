// Shopify shelf import: a real store's public catalog becomes the shelf Shelf Check ranks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { storeHost, claims, shelfFromShopify, coverage, recommend, parse, LABELS } from "../worker.js";

const shop = JSON.parse(readFileSync(new URL("../fixtures/shopify-sokoglam.json", import.meta.url)));
const demo = JSON.parse(readFileSync(new URL("../fixtures/skin-result.json", import.meta.url)));

test("store input becomes a public hostname, anything else is refused", () => {
  assert.equal(storeHost("sokoglam.com"), "sokoglam.com");
  assert.equal(storeHost(" SokoGlam.com "), "sokoglam.com");
  assert.equal(storeHost("https://www.sokoglam.com/collections/serums?page=2"), "www.sokoglam.com");
  for (const bad of ["", "localhost", "127.0.0.1", "http://10.0.0.1/x", "not a domain", "foo", "a..b", "shop.local", "javascript:alert(1)", "[::1]"])
    assert.equal(storeHost(bad), null, bad);
});

test("claims come from the store's own words and say which words matched", () => {
  const nia = claims({ title: "Niacinamide 10% + Zinc Serum" });
  for (const c of ["pore", "oiliness", "redness", "age_spot"]) assert.ok(nia.treats.includes(c), c);
  assert.ok(nia.matched.includes("niacinamide"));
  assert.deepEqual(claims({ title: "Water Gel", tags: ["Skin_Concern::Dryness/Hydration"] }).treats, ["moisture"]);
  assert.ok(claims({ title: "Bright Eyes", product_type: "Eye cream" }).treats.includes("dark_circle_v2"));
  assert.deepEqual(claims({ title: "Dark Spot Serum" }).treats, ["age_spot"]);
  assert.ok(claims({ title: "Acne Spot Patch" }).treats.includes("acne"));
  // Sensitivity is not one of the eight measured concerns: no claim is invented for it.
  assert.deepEqual(claims({ title: "Mild Toner", tags: ["Skin_Concern::Sensitive"] }).treats, []);
  assert.deepEqual(claims({ title: "Gift Card", product_type: "Gift Card" }).treats, []);
});

test("a real Shopify catalog becomes a priced, linked shelf", () => {
  const items = shelfFromShopify(shop.products, "sokoglam.com");
  // 30 listed: 13 sold out, one $0 bundle builder, two sets that claim none of the 8 concerns.
  assert.equal(items.length, 14);
  assert.ok(!items.some((i) => i.name === "Azelaic Acid 10 Kojic Tea Tree Serum"), "sold out stays off the shelf");
  for (const it of items) {
    assert.ok(it.price > 0, it.name);
    assert.match(it.url, /^https:\/\/sokoglam\.com\/products\/[\w-]+$/);
    assert.ok(it.treats.length && it.treats.every((c) => c in LABELS), it.name);
  }
  const klairs = items.find((i) => i.name === "Dear Klairs EGF Blue AC Calming Serum");
  assert.ok(klairs.treats.includes("acne") && klairs.treats.includes("redness"));
  const cov = coverage(items);
  assert.deepEqual(Object.keys(cov).sort(), Object.keys(LABELS).sort());
  assert.ok(cov.moisture > 0);
});

test("the shelf is for the face: lip/body products stay off, same-name listings collapse to the cheapest", () => {
  const v = (price) => [{ price, available: true }];
  const items = shelfFromShopify([
    { title: "Lip Barrier Relief", handle: "lip", tags: [], variants: v("14.00") },
    { title: "Ceramide Body Lotion", handle: "body", product_type: "Body", tags: [], variants: v("12.00") },
    { title: "Weekend Glow", handle: "glow-duo", tags: ["niacinamide"], variants: v("17.99") },
    { title: "Weekend Glow", handle: "glow", tags: ["niacinamide"], variants: v("14.99") },
  ], "versedskin.com");
  assert.deepEqual(items.map((i) => [i.sku, i.price]), [["glow", 14.99]]);
});

test("the measured demo selfie gets three picks from the imported shelf, each with its reason", () => {
  const picks = recommend(parse(demo.data.results), shelfFromShopify(shop.products, "sokoglam.com"), 3, "II");
  assert.equal(picks.length, 3);
  for (const p of picks) assert.ok(p.url && p.because.length && p.matched.length, p.name);
});

test("the Worker serves /api/shelf and ranks /api/check from the store it was given", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname !== "sokoglam.com") return new Response("{}", { status: 404 });
    if (u.pathname === "/meta.json") return Response.json({ name: "Soko Glam", currency: "USD" });
    if (u.pathname === "/products.json") return Response.json(shop);
    return new Response("{}", { status: 404 });
  };
  try {
    const env = {};
    const shelf = await (await worker.fetch(new Request("https://x/api/shelf?store=sokoglam.com"), env)).json();
    assert.equal(shelf.store.name, "Soko Glam");
    assert.equal(shelf.store.currency, "USD");
    assert.equal(shelf.total, shop.products.length);
    assert.equal(shelf.items, shelfFromShopify(shop.products, "sokoglam.com").length);
    assert.equal(Object.keys(shelf.coverage).length, 8);
    const check = await (await worker.fetch(new Request("https://x/api/check?demo=1&store=sokoglam.com", { method: "POST" }), env)).json();
    assert.equal(check.store.name, "Soko Glam");
    assert.equal(check.picks.length, 3);
    assert.ok(check.picks.every((p) => p.url.startsWith("https://sokoglam.com/products/")));
    assert.equal((await worker.fetch(new Request("https://x/api/shelf?store=localhost"), env)).status, 400);
    assert.equal((await worker.fetch(new Request("https://x/api/shelf?store=nostore.example"), env)).status, 502);
  } finally {
    globalThis.fetch = real;
  }
});
