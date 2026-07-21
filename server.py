# -*- coding: utf-8 -*-
"""Local server cho app lịch học SIC2026 – phục vụ static + proxy/refresh sheet."""
import json
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/refresh":
            return self.handle_refresh()
        if path in ("/", ""):
            self.path = "/index.html"
        return super().do_GET()

    def handle_refresh(self):
        try:
            # Import parser in-process
            sys.path.insert(0, str(ROOT))
            import parse_schedule  # noqa: WPS433

            payload = parse_schedule.main()
            body = json.dumps(
                {"ok": True, "stats": payload.get("stats"), "updated_at": payload.get("updated_at")},
                ensure_ascii=False,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            body = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[lich-hoc] " + (fmt % args) + "\n")


def main():
    # Pre-fetch schedule if missing
    if not (ROOT / "schedule.json").exists():
        print("Chưa có schedule.json — đang tải từ Google Sheet...")
        sys.path.insert(0, str(ROOT))
        import parse_schedule

        parse_schedule.main()

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/"
    print("=" * 50)
    print("  Lịch học SIC2026 · Samsung ICTU")
    print(f"  Mở trình duyệt: {url}")
    print("  Nhấn Ctrl+C để dừng")
    print("=" * 50)

    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nĐã dừng server.")
        server.server_close()


if __name__ == "__main__":
    main()
