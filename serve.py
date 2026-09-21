#!/usr/bin/env python3
"""Static dev server with no-cache headers (same job as serve.mjs, for setups without Node).
   python3 serve.py            -> http://localhost:4419
   PORT=5000 python3 serve.py  -> another port
"""
import os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", sys.argv[1] if len(sys.argv) > 1 else 4419))

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"}
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    print(f"Outreach Tracker → http://localhost:{PORT}  (lead page: http://localhost:{PORT}/admin.html)", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
