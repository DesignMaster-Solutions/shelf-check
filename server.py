"""Tiny stdlib web server: GET / serves the shopper page, POST /api/check runs Skin AI + catalog match."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import shelfcheck as sc

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
KEY = os.environ.get("YOUCAM_API_KEY", "")
DEMO = os.path.join(ROOT, "fixtures", "skin-result.json")
MAX = 8 * 1024 * 1024


class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        name = self.path.split("?")[0].lstrip("/") or "index.html"
        path = os.path.normpath(os.path.join(PUBLIC, name))
        if not path.startswith(PUBLIC + os.sep) or not os.path.isfile(path):
            return self._send(404, {"error": "not found"})
        with open(path, "rb") as f:
            self._send(200, f.read(), "text/html; charset=utf-8" if name.endswith(".html") else "image/jpeg")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/check":
            return self._send(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type", "")
        if "demo=1" in self.path or not KEY:
            # Replays a real API response captured from fixtures/demo-face.jpg (no units spent).
            with open(DEMO) as f:
                results = json.load(f)["data"]["results"]
        elif not 0 < n <= MAX or ctype not in ("image/jpeg", "image/png"):
            return self._send(400, {"error": "send one JPG or PNG selfie up to 8 MB"})
        else:
            try:
                results = sc.analyze(self.rfile.read(n), ctype, KEY)
            except Exception as e:  # surface the engine message (e.g. no face found) to the shopper
                return self._send(502, {"error": str(e)})
        scores = sc.parse(results)
        self._send(200, {"scores": {c: {**v, "label": sc.LABELS[c]} for c, v in scores.items()},
                         **sc.summary(results), "picks": sc.recommend(scores, sc.load_catalog())})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8090))
    print(f"Shelf Check on http://127.0.0.1:{port} ({'live API' if KEY else 'demo replay'})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
