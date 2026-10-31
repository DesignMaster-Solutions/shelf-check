// Parity check: the Worker ranks the captured demo response exactly like shelfcheck.py.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse, recommend, parseSkinType, FITZ } from "../worker.js";

const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url)));
const demo = JSON.parse(readFileSync(new URL("../fixtures/skin-result.json", import.meta.url)));

test("worker picks match the Python reference", () => {
  const js = recommend(parse(demo.data.results), catalog).map((p) => p.sku);
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import json,shelfcheck as s;d=json.load(open('fixtures/skin-result.json'));print(json.dumps([p['sku'] for p in s.recommend(s.parse(d['data']['results']),s.load_catalog())]))"],
    { cwd: new URL("..", import.meta.url).pathname }).toString());
  assert.equal(js.length, 3);
  assert.deepEqual(js, py);
});

test("demo masks are served locally, not from expiring signed URLs", () => {
  for (const v of Object.values(parse(demo.data.results))) assert.match(v.mask, /^\/masks\/\w+\.jpg$/);
});

test("summary exposes the overall score and skin age the API already returns", async () => {
  const { summary } = await import("../worker.js");
  assert.deepEqual(summary(demo.data.results), { overall: 79.5, skin_age: 68 });
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import json,shelfcheck as s;d=json.load(open('fixtures/skin-result.json'));print(json.dumps(s.summary(d['data']['results'])))"],
    { cwd: new URL("..", import.meta.url).pathname }).toString());
  assert.deepEqual(py, { overall: 79.5, skin_age: 68 });
});

test("skin type re-weights the picks exactly like the Python reference", () => {
  const scores = parse(demo.data.results);
  for (const t of Object.keys(FITZ)) {
    const js = recommend(scores, catalog, 3, t).map((p) => [p.sku, p.fit]);
    const py = JSON.parse(execFileSync("python3", ["-c",
      `import json,shelfcheck as s;d=json.load(open('fixtures/skin-result.json'));print(json.dumps([[p['sku'],p['fit']] for p in s.recommend(s.parse(d['data']['results']),s.load_catalog(),skin_type='${t}')]))`],
      { cwd: new URL("..", import.meta.url).pathname }).toString());
    assert.deepEqual(js, py, `type ${t}`);
  }
});

test("captured Fitzpatrick response parses and FITZ mirrors Python", () => {
  const fitz = JSON.parse(readFileSync(new URL("../fixtures/fitzpatrick-result.json", import.meta.url)));
  assert.equal(parseSkinType(fitz.data.results), "II");
  assert.equal(parseSkinType({ fitzpatrick_scale: "VII" }), null);
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import json,shelfcheck as s;print(json.dumps({k:[w,n] for k,(w,n) in s.FITZ.items()}))"],
    { cwd: new URL("..", import.meta.url).pathname }).toString());
  assert.deepEqual(FITZ, py);
});
