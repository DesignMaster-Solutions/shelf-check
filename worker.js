// Cloudflare Worker port of server.py + shelfcheck.py: same API, same ranking, static files from public/.
import catalog from "./catalog.json" with { type: "json" };
import demo from "./fixtures/skin-result.json" with { type: "json" };

const API = "https://yce-api-01.makeupar.com/s2s/v2.0";
export const LABELS = {
  acne: "Breakouts", pore: "Visible pores", redness: "Redness", oiliness: "Oiliness",
  moisture: "Dehydration", wrinkle: "Fine lines", dark_circle_v2: "Dark circles", age_spot: "Dark spots",
};
const CONCERNS = Object.keys(LABELS);
const MAX = 8 * 1024 * 1024;

export function parse(results) {
  const out = {};
  for (const o of results.output || []) {
    if (LABELS[o.type]) out[o.type] = { score: +(o.raw_score ?? o.ui_score ?? 100), ui: o.ui_score ?? null, mask: (o.mask_urls || [null])[0] };
  }
  return out;
}

export function recommend(scores, items, top = 3) {
  const need = Object.fromEntries(Object.entries(scores).map(([c, v]) => [c, Math.max(0, 100 - v.score)]));
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

async function analyze(image, type, key) {
  const f = (await call("POST", `${API}/file`, key, { files: [{ content_type: type, file_name: `selfie.${type.split("/")[1]}`, file_size: image.byteLength }] })).data.files[0];
  const put = f.requests[0];
  const up = await fetch(put.url, { method: "PUT", headers: put.headers, body: image });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  const task = (await call("POST", `${API}/task/skin-analysis`, key, { src_file_id: f.file_id, dst_actions: CONCERNS, miniserver_args: { enable_mask_overlay: true }, format: "json" })).data.task_id;
  for (let i = 0; i < 40; i++) {
    const d = (await call("GET", `${API}/task/skin-analysis/${task}`, key)).data;
    if (d.task_status === "success") return parse(d.results);
    if (d.task_status === "error") throw new Error(d.error_message || d.error);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("skin analysis still running");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== "/api/check") return env.ASSETS.fetch(req);
    if (req.method !== "POST") return Response.json({ error: "not found" }, { status: 404 });
    const type = req.headers.get("Content-Type") || "";
    let scores;
    if (url.searchParams.get("demo") === "1" || !env.YOUCAM_API_KEY) {
      scores = parse(demo.data.results); // real API response captured from public/demo-face.jpg (no units spent)
    } else {
      const image = await req.arrayBuffer();
      if (!image.byteLength || image.byteLength > MAX || !["image/jpeg", "image/png"].includes(type))
        return Response.json({ error: "send one JPG or PNG selfie up to 8 MB" }, { status: 400 });
      try { scores = await analyze(image, type, env.YOUCAM_API_KEY); }
      catch (e) { return Response.json({ error: String(e.message || e) }, { status: 502 }); }
    }
    const out = Object.fromEntries(Object.entries(scores).map(([c, v]) => [c, { ...v, label: LABELS[c] }]));
    return Response.json({ scores: out, picks: recommend(scores, catalog) });
  },
};
