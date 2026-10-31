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


# Fitzpatrick type -> (extra weight per measured need, the one line the shopper reads). Weights never go below 1:
# the Skin AI measurement stays; the type only says which needs matter MORE for that skin (photo-ageing on
# lighter types, post-inflammatory marks and visible dryness on darker types).
FITZ = {
    "I": ({"wrinkle": 1.2, "redness": 1.2, "age_spot": 1.1},
          "Type I burns in minutes and never tans: sun damage shows early as fine lines, redness and spots, "
          "so those weigh more and sunscreen is a daily product."),
    "II": ({"wrinkle": 1.15, "redness": 1.15, "age_spot": 1.1},
           "Type II burns easily and tans little: photo-ageing (fine lines, redness, spots) weighs more and "
           "sunscreen comes first."),
    "III": ({}, "Type III sometimes burns and tans gradually: concerns are weighed exactly as measured; daily "
                "SPF is still non-negotiable."),
    "IV": ({"age_spot": 1.2, "acne": 1.1},
           "Type IV tans easily, but marks left after breakouts linger (post-inflammatory hyperpigmentation), "
           "so pigmentation care weighs more."),
    "V": ({"age_spot": 1.3, "acne": 1.15},
          "Type V rarely burns: the main risk is dark marks left by breakouts and irritation, so spot care "
          "and gentle actives weigh more."),
    "VI": ({"age_spot": 1.35, "acne": 1.15, "moisture": 1.1},
           "Type VI almost never burns: post-inflammatory marks and visible dryness (ashiness) lead, so those "
           "weigh more."),
}


def _call(method, url, key, body=None, headers=None):
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    h.update(headers or {})
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def _upload(image: bytes, content_type: str, key: str) -> str:
    f = _call("POST", f"{API}/file", key, {"files": [
        {"content_type": content_type, "file_name": f"selfie.{content_type.split('/')[-1]}", "file_size": len(image)}]})
    f = f["data"]["files"][0]
    put = f["requests"][0]
    urllib.request.urlopen(urllib.request.Request(put["url"], data=image, method="PUT", headers=put["headers"]),
                           timeout=60).read()
    return f["file_id"]


def _task(name: str, body: dict, key: str, timeout: int) -> dict:
    """Start one YouCam task and poll it to success; raises on engine error or timeout."""
    task = _call("POST", f"{API}/task/{name}", key, body)["data"]["task_id"]
    end = time.time() + timeout
    while time.time() < end:
        d = _call("GET", f"{API}/task/{name}/{task}", key)["data"]
        if d["task_status"] == "success":
            return d["results"]
        if d["task_status"] == "error":
            raise RuntimeError(d.get("error_message") or d.get("error"))
        time.sleep(3)
    raise TimeoutError(f"{name} still running")


def analyze(image: bytes, content_type: str, key: str, timeout=120) -> tuple:
    """Upload a selfie once, then run SD skin analysis (8 concerns, 12 units) and the Fitzpatrick skin type
    on the same file. Returns (skin results, fitzpatrick results or None): the type is advisory, so its
    failure (face angle, lighting) never costs the shopper the skin map."""
    file_id = _upload(image, content_type, key)
    skin = _task("skin-analysis", {"src_file_id": file_id, "dst_actions": CONCERNS,
                                   "miniserver_args": {"enable_mask_overlay": True}, "format": "json"}, key, timeout)
    try:
        fitz = _task("fitzpatrick-scale-analyzer", {"version": "1.0", "src_file_id": file_id}, key, 60)
    except Exception:
        fitz = None
    return skin, fitz


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


def parse_skin_type(results):
    """Fitzpatrick type I-VI from the fitzpatrick-scale-analyzer task, or None if missing/unknown."""
    t = (results or {}).get("fitzpatrick_scale")
    return t if t in FITZ else None


def skin_type_note(skin_type):
    return FITZ[skin_type][1] if skin_type in FITZ else None


def recommend(scores: dict, catalog: list, top=3, skin_type=None) -> list:
    """Rank catalog items by how much of the shopper's measured need they cover.

    need = (100 - raw_score) x Fitzpatrick weight per concern (0 = no issue; weight 1 without a type).
    An item scores the sum of the needs it treats; ties go to the cheaper item. Each pick carries the
    concerns that justified it.
    """
    weight = FITZ.get(skin_type, ({}, ""))[0]
    need = {c: max(0.0, 100 - v["score"]) * weight.get(c, 1.0) for c, v in scores.items()}
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
