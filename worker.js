// Cloudflare Worker port of server.py + shelfcheck.py: same API, same ranking, static files from public/.
import catalog from "./catalog.json" with { type: "json" };
import demo from "./fixtures/skin-result.json" with { type: "json" };
import demoFitz from "./fixtures/fitzpatrick-result.json" with { type: "json" };

const API = "https://yce-api-01.makeupar.com/s2s/v2.0";
export const LABELS = {
  acne: "Breakouts", pore: "Visible pores", redness: "Redness", oiliness: "Oiliness",
  moisture: "Dehydration", wrinkle: "Fine lines", dark_circle_v2: "Dark circles", age_spot: "Dark spots",
};
const CONCERNS = Object.keys(LABELS);
// Mirror of shelfcheck.FITZ (parity-tested): Fitzpatrick type -> [extra weight per measured need, shopper note].
export const FITZ = {
  I: [{ wrinkle: 1.2, redness: 1.2, age_spot: 1.1 }, "Type I burns in minutes and never tans: sun damage shows early as fine lines, redness and spots, so those weigh more and sunscreen is a daily product."],
  II: [{ wrinkle: 1.15, redness: 1.15, age_spot: 1.1 }, "Type II burns easily and tans little: photo-ageing (fine lines, redness, spots) weighs more and sunscreen comes first."],
  III: [{}, "Type III sometimes burns and tans gradually: concerns are weighed exactly as measured; daily SPF is still non-negotiable."],
  IV: [{ age_spot: 1.2, acne: 1.1 }, "Type IV tans easily, but marks left after breakouts linger (post-inflammatory hyperpigmentation), so pigmentation care weighs more."],
  V: [{ age_spot: 1.3, acne: 1.15 }, "Type V rarely burns: the main risk is dark marks left by breakouts and irritation, so spot care and gentle actives weigh more."],
  VI: [{ age_spot: 1.35, acne: 1.15, moisture: 1.1 }, "Type VI almost never burns: post-inflammatory marks and visible dryness (ashiness) lead, so those weigh more."],
};
const MAX = 8 * 1024 * 1024;

export function parse(results) {
  const out = {};
  for (const o of results.output || []) {
    if (LABELS[o.type]) out[o.type] = { score: +(o.raw_score ?? o.ui_score ?? 100), ui: o.ui_score ?? null, mask: (o.mask_urls || [null])[0] };
  }
  return out;
}

// Overall skin score and estimated skin age come back in the same task output; no extra units.
export function summary(results) {
  const pick = (t) => (results.output || []).find((o) => o.type === t)?.score ?? null;
  return { overall: pick("all"), skin_age: pick("skin_age") };
}

export function parseSkinType(results) {
  const t = results?.fitzpatrick_scale;
  return t in FITZ ? t : null;
}

export function recommend(scores, items, top = 3, skinType = null) {
  const weight = (FITZ[skinType] || [{}])[0];
  const need = Object.fromEntries(Object.entries(scores).map(([c, v]) => [c, Math.max(0, 100 - v.score) * (weight[c] || 1)]));
  return items
    .map((item) => {
      const hits = item.treats.filter((c) => (need[c] || 0) > 0).sort((a, b) => need[b] - need[a]);
      const fit = hits.reduce((s, c) => s + need[c], 0);
      return fit > 0 && { ...item, fit: Math.round(fit * 10) / 10, because: hits.map((c) => LABELS[c]) };
    })
    .filter(Boolean)
    .sort((a, b) => b.fit - a.fit || a.price - b.price)
    .slice(0, top);
}

// Any Shopify store's public catalog can be the shelf. Claims come only from the store's own words
// (title, product type, tags such as "Skin_Concern::Acne"); every pick shows the words that matched.
const CLAIMS = [
  [/salicylic|\bbha\b|benzoyl|azelaic|tea tree|\bacne\b|blemish|breakout|pimple/i, ["acne"]],
  [/\bpores?\b|oil[ -]?control|sebum|mattif\w*|\bclay\b/i, ["pore", "oiliness"]],
  [/niacinamide/i, ["pore", "oiliness", "redness", "age_spot"]],
  [/centella|\bcica\b|redness|calming|soothing/i, ["redness"]],
  [/hyaluronic|ceramides?|squalane|hydrat\w*|moisturi[sz]\w*|dryness|\bbarrier\b/i, ["moisture"]],
  [/retino\w*|retinal|bakuchiol|peptides?|wrinkles?|fine lines|anti-?ag(e)?ing|firming/i, ["wrinkle"]],
  [/\beye (cream|serum|gel|balm|patch|mask)|under-?eye|dark circle/i, ["dark_circle_v2"]],
  [/vitamin c|ascorbic|tranexamic|arbutin|kojic|dark spots?|brighten\w*|\w*pigment\w*|discolou?r\w*|even(ing)? (skin )?tone|\bspf\b|sunscreen/i, ["age_spot"]],
];

export function claims(p) {
  const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",");
  const text = [p.title, p.product_type, ...tags].join(" | ");
  const treats = new Set(), matched = [];
  for (const [re, cs] of CLAIMS) {
    const m = text.match(re);
    if (!m) continue;
    cs.forEach((c) => treats.add(c));
    if (!matched.includes(m[0].toLowerCase())) matched.push(m[0].toLowerCase());
  }
  return { treats: [...treats], matched };
}

// The selfie measures the face, so lip/body/hair products and non-products never make the shelf.
const NOT_FACE = /\b(lips?|body|hair|scalp|hands?|foot|feet|nails?|deodorant|shampoo|conditioner|candle|brush|tools?|accessor(y|ies)|merch|tote)\b|gift ?card|sample|^test$/i;

export function shelfFromShopify(products, host) {
  const best = new Map(); // same title listed twice (a duo, a size) -> keep the cheaper listing
  for (const p of products) {
    const v = (p.variants || []).find((x) => x.available !== false);
    const price = Number(v?.price);
    if (!(price > 0) || NOT_FACE.test(p.title || "") || NOT_FACE.test(p.product_type || "")) continue;
    const { treats, matched } = claims(p);
    const key = String(p.title).trim().toLowerCase();
    if (treats.length && !(best.get(key)?.price <= price))
      best.set(key, { sku: p.handle, name: p.title, price, url: `https://${host}/products/${encodeURIComponent(p.handle)}`, treats, matched });
  }
  return [...best.values()];
}

export const coverage = (items) => Object.fromEntries(CONCERNS.map((c) => [c, items.filter((i) => i.treats.includes(c)).length]));

// The Worker fetches whatever this returns, so only public DNS names pass: no IPs, no single-label or internal hosts.
export function storeHost(input) {
  const s = String(input || "").trim().toLowerCase();
  let h;
  try { h = s && new URL(s.includes("://") ? s : `https://${s}`).hostname; } catch { return null; }
  if (!h || !/^(?=.{4,253}$)([a-z0-9](-*[a-z0-9])*\.)+[a-z]{2,63}$/.test(h) || /\.(local|internal|localhost)$/.test(h)) return null;
  return h;
}

async function shelf(host) {
  const get = (path) => fetch(`https://${host}${path}`, { headers: { Accept: "application/json", "User-Agent": "ShelfCheck/1.0 (+https://shelf-check.designmaster.workers.dev)" },
    cf: { cacheTtl: 900, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
  // shortcut: first 250 products (one page of /products.json); page through ?page=N when a store needs its whole range.
  const [pr, mr] = await Promise.all([get("/products.json?limit=250"), get("/meta.json").catch(() => null)]);
  const data = pr.ok ? await pr.json().catch(() => null) : null;
  if (!Array.isArray(data?.products)) throw new Error(`${host} did not share a Shopify catalog (HTTP ${pr.status}). Shopify stores publish /products.json unless the owner turns it off.`);
  const meta = mr?.ok ? await mr.json().catch(() => ({})) : {};
  return { store: { host, name: meta.name || host, currency: meta.currency || "USD" }, total: data.products.length, items: shelfFromShopify(data.products, host) };
}

async function call(method, url, key, body) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.message || `YouCam ${r.status}`);
  return j;
}

async function upload(image, type, key) {
  const f = (await call("POST", `${API}/file`, key, { files: [{ content_type: type, file_name: `selfie.${type.split("/")[1]}`, file_size: image.byteLength }] })).data.files[0];
  const put = f.requests[0];
  const up = await fetch(put.url, { method: "PUT", headers: put.headers, body: image });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  return f.file_id;
}

async function task(name, body, key, tries = 40) {
  const id = (await call("POST", `${API}/task/${name}`, key, body)).data.task_id;
  for (let i = 0; i < tries; i++) {
    const d = (await call("GET", `${API}/task/${name}/${id}`, key)).data;
    if (d.task_status === "success") return d.results;
    if (d.task_status === "error") throw new Error(d.error_message || d.error);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`${name} still running`);
}

// One upload, two YouCam tasks in parallel. The skin type is advisory: if its task fails (face angle,
// lighting) the shopper still gets the skin map and picks weighed as measured.
async function analyze(image, type, key) {
  const fileId = await upload(image, type, key);
  return Promise.all([
    task("skin-analysis", { src_file_id: fileId, dst_actions: CONCERNS, miniserver_args: { enable_mask_overlay: true }, format: "json" }, key),
    task("fitzpatrick-scale-analyzer", { version: "1.0", src_file_id: fileId }, key, 20).catch(() => null),
  ]);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!["/api/check", "/api/shelf"].includes(url.pathname)) return env.ASSETS.fetch(req);
    // The store's shelf loads before any YouCam unit is spent, so a bad store address costs nothing.
    let s = { store: null, total: catalog.length, items: catalog };
    if (url.searchParams.has("store") || url.pathname === "/api/shelf") {
      const host = storeHost(url.searchParams.get("store"));
      if (!host) return Response.json({ error: "type a store's web address, like sokoglam.com" }, { status: 400 });
      try { s = await shelf(host); } catch (e) { return Response.json({ error: String(e.message || e) }, { status: 502 }); }
    }
    if (url.pathname === "/api/shelf") return Response.json({ store: s.store, total: s.total, items: s.items.length,
      coverage: Object.fromEntries(Object.entries(coverage(s.items)).map(([c, n]) => [LABELS[c], n])) });
    if (req.method !== "POST") return Response.json({ error: "not found" }, { status: 404 });
    const type = req.headers.get("Content-Type") || "";
    let results, fitz;
    if (url.searchParams.get("demo") === "1" || !env.YOUCAM_API_KEY) {
      [results, fitz] = [demo.data.results, demoFitz.data.results]; // real API responses captured from public/demo-face.jpg (no units spent)
    } else {
      const image = await req.arrayBuffer();
      if (!image.byteLength || image.byteLength > MAX || !["image/jpeg", "image/png"].includes(type))
        return Response.json({ error: "send one JPG or PNG selfie up to 8 MB" }, { status: 400 });
      try { [results, fitz] = await analyze(image, type, env.YOUCAM_API_KEY); }
      catch (e) { return Response.json({ error: String(e.message || e) }, { status: 502 }); }
    }
    const scores = parse(results), skinType = parseSkinType(fitz), cov = coverage(s.items);
    const out = Object.fromEntries(Object.entries(scores).map(([c, v]) => [c, { ...v, label: LABELS[c] }]));
    return Response.json({ scores: out, ...summary(results), skin_type: skinType, skin_type_note: skinType && FITZ[skinType][1],
      store: s.store, picks: recommend(scores, s.items, 3, skinType),
      // Low-scoring concerns this shelf has nothing for: said out loud instead of picking something unrelated.
      unserved: Object.entries(scores).filter(([c, v]) => v.score < 70 && !cov[c]).map(([c]) => LABELS[c]) });
  },
};
