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
    if (url.pathname !== "/api/check") return env.ASSETS.fetch(req);
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
    const scores = parse(results), skinType = parseSkinType(fitz);
    const out = Object.fromEntries(Object.entries(scores).map(([c, v]) => [c, { ...v, label: LABELS[c] }]));
    return Response.json({ scores: out, ...summary(results), skin_type: skinType, skin_type_note: skinType && FITZ[skinType][1],
      picks: recommend(scores, catalog, 3, skinType) });
  },
};
