"""Weather service: provider fallback, retry, cache, last-good persistence, staleness.

Rule: weather is never fabricated. If every provider fails, the last successful observation
is served and marked stale; if there has never been one, weather is reported unavailable.
"""
import json
import os
import threading
import time

from .providers import NotConfigured, ProviderError

REFRESH_S = 300          # fetch at most every 5 minutes
LIVE_MAX_AGE_S = 20 * 60  # after this without a successful fetch, data is "stale"
RETRIES = 3


class WeatherService:
    def __init__(self, providers, state_path=None, now=time.time, sleep=time.sleep,
                 refresh_s=REFRESH_S, live_max_age_s=LIVE_MAX_AGE_S):
        self.providers, self.state_path = providers, state_path
        self.now, self.sleep = now, sleep
        self.refresh_s, self.live_max_age_s = refresh_s, live_max_age_s
        self._lock = threading.Lock()
        self._last_good = None        # {"data":…, "provider":…, "attribution":…, "fetched_at":…}
        self._last_attempt = 0.0
        self._errors = []
        if state_path and os.path.exists(state_path):
            try:
                with open(state_path, encoding="utf-8") as f:
                    self._last_good = json.load(f)
            except (OSError, ValueError):
                self._last_good = None

    def _try_provider(self, p):
        delay = 1.0
        for attempt in range(RETRIES):
            try:
                return p.fetch()
            except NotConfigured:
                raise
            except ProviderError:
                if attempt == RETRIES - 1:
                    raise
                self.sleep(delay)
                delay *= 2

    def refresh(self):
        """Try providers in priority order. Returns True when new data was stored."""
        errors = []
        for p in self.providers:
            try:
                data = self._try_provider(p)
            except NotConfigured as e:
                errors.append({"provider": p.name, "error": f"not configured: {e}"})
                continue
            except ProviderError as e:
                errors.append({"provider": p.name, "error": str(e)})
                continue
            self._last_good = {"data": data, "provider": p.name, "attribution": p.attribution,
                               "fetched_at": int(self.now())}
            self._errors = errors
            if self.state_path:
                tmp = self.state_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(self._last_good, f)
                os.replace(tmp, self.state_path)
            return True
        self._errors = errors
        return False

    def snapshot(self):
        with self._lock:
            now = self.now()
            due = now - self._last_attempt >= self.refresh_s
            if due or self._last_good is None and now - self._last_attempt >= 30:
                self._last_attempt = now
                self.refresh()
            now = int(self.now())
            local = time.gmtime(now + 8 * 3600)
            out = {
                "server_time_utc": now, "timezone": "Asia/Ulaanbaatar", "utc_offset_seconds": 8 * 3600,
                "local_time": time.strftime("%Y-%m-%dT%H:%M:%S", local),
                "location": {"lat": 47.918873, "lon": 106.917580},
                "refresh_seconds": self.refresh_s, "errors": self._errors,
            }
            if self._last_good is None:
                out.update({"freshness": "unavailable", "weather": None, "provider": None,
                            "fetched_at": None, "age_seconds": None, "attribution": None})
            else:
                age = now - self._last_good["fetched_at"]
                out.update({"freshness": "live" if age <= self.live_max_age_s else "stale",
                            "weather": self._last_good["data"], "provider": self._last_good["provider"],
                            "fetched_at": self._last_good["fetched_at"], "age_seconds": age,
                            "attribution": self._last_good["attribution"]})
            return out
