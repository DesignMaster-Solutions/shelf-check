"""Shelf Check: YouCam Skin AI scores -> the products in *this* store's catalog that treat them."""
import json
import os
import time
import urllib.request

API = "https://yce-api-01.makeupar.com/s2s/v2.0"
CONCERNS = ["acne", "pore", "redness", "oiliness", "moisture", "wrinkle", "dark_circle_v2", "age_spot"]
LABELS = {
    "acne": "Breakouts", "pore": "Visible pores", "redness": "Redness", "oiliness": "Oiliness",
    "moisture": "Dehydration", "wrinkle": "Fine lines", "dark_circle_v2": "Dark circles", "age_spot": "Dark spots",
}


def _call(method, url, key, body=None, headers=None):
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def analyze(image: bytes, content_type: str, key: str, timeout=120) -> dict:
    """Upload a selfie, run SD skin analysis on 8 concerns (12 units) and return the raw task results."""
    f = _call("POST", f"{API}/file", key, {"files": [
        {"content_type": content_type, "file_name": f"selfie.{content_type.split('/')[-1]}", "file_size": len(image)}]})
    f = f["data"]["files"][0]
    put = f["requests"][0]
    urllib.request.urlopen(urllib.request.Request(put["url"], data=image, method="PUT", headers=put["headers"]),
                           timeout=60).read()
    task = _call("POST", f"{API}/task/skin-analysis", key, {
        "src_file_id": f["file_id"], "dst_actions": CONCERNS,
        "miniserver_args": {"enable_mask_overlay": True}, "format": "json"})["data"]["task_id"]
    end = time.time() + timeout
    while time.time() < end:
        d = _call("GET", f"{API}/task/skin-analysis/{task}", key)["data"]
        if d["task_status"] == "success":
            return d["results"]
        if d["task_status"] == "error":
            raise RuntimeError(d.get("error_message") or d.get("error"))
        time.sleep(3)
    raise TimeoutError("skin analysis still running")


def parse(results) -> dict:
    """Normalise the task output into {concern: {score, mask}}; lower score = worse skin."""
    out = {}
    for o in results.get("output", []):
        if o.get("type") in LABELS:
            out[o["type"]] = {"score": float(o.get("raw_score", o.get("ui_score", 100))),
                              "ui": o.get("ui_score"), "mask": (o.get("mask_urls") or [None])[0]}
    return out


def summary(results) -> dict:
    """Overall skin score and estimated skin age from the same task output (no extra units)."""
    by = {o.get("type"): o.get("score") for o in results.get("output", [])}
    return {"overall": by.get("all"), "skin_age": by.get("skin_age")}


def recommend(scores: dict, catalog: list, top=3) -> list:
    """Rank catalog items by how much of the shopper's measured need they cover.

    need = 100 - raw_score per concern (0 = no issue). An item scores the sum of the needs it
    treats; ties go to the cheaper item. Each pick carries the concerns that justified it.
    """
    need = {c: max(0.0, 100 - v["score"]) for c, v in scores.items()}
    ranked = []
    for item in catalog:
        hits = sorted((c for c in item["treats"] if need.get(c, 0) > 0), key=lambda c: -need[c])
        fit = sum(need[c] for c in hits)
        if fit > 0:
            ranked.append({**item, "fit": round(fit, 1), "because": [LABELS[c] for c in hits]})
    ranked.sort(key=lambda i: (-i["fit"], i["price"]))
    return ranked[:top]


def load_catalog(path=os.path.join(os.path.dirname(__file__), "catalog.json")):
    with open(path) as f:
        return json.load(f)
