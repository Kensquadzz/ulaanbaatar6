"""HTTP entry point. The game client talks only to this server; provider keys stay here.

  GET /v1/world   -> real Ulaanbaatar time + latest weather + freshness
  GET /healthz

Run:  python -m ub6server.app            (PORT, UB6_STATE_FILE, GOOGLE_WEATHER_API_KEY optional)
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .providers import GoogleWeatherProvider, NamemProvider, OpenMeteoProvider
from .service import WeatherService


def build_service():
    return WeatherService([GoogleWeatherProvider(), NamemProvider(), OpenMeteoProvider()],
                          state_path=os.environ.get("UB6_STATE_FILE", "ub6_weather_state.json"))


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code, body):
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "public, max-age=60")
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/v1/world":
                self._send(200, service.snapshot())
            elif path == "/healthz":
                self._send(200, {"ok": True})
            else:
                self._send(404, {"error": "not found"})

        def log_message(self, fmt, *args):
            pass
    return Handler


def main():
    port = int(os.environ.get("PORT", "8080"))
    srv = ThreadingHTTPServer(("0.0.0.0", port), make_handler(build_service()))
    print(f"ub6 weather server on :{port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
