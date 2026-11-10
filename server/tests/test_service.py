import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from ub6server.app import make_handler
from ub6server.providers import (GoogleWeatherProvider, NamemProvider, NotConfigured,
                                 OpenMeteoProvider, ProviderError)
from ub6server.service import WeatherService

OPEN_METEO_SAMPLE = {
    "current": {"time": "2026-01-15T09:15", "interval": 900, "temperature_2m": -24.3,
                "relative_humidity_2m": 78, "apparent_temperature": -30.1, "precipitation": 0.1,
                "rain": 0.0, "showers": 0.0, "snowfall": 0.07, "weather_code": 71, "cloud_cover": 100,
                "pressure_msl": 1036.2, "wind_speed_10m": 2.1, "wind_direction_10m": 310,
                "wind_gusts_10m": 4.0, "visibility": 4200.0, "snow_depth": 0.08},
    "daily": {"sunrise": ["2026-01-15T08:36"], "sunset": ["2026-01-15T17:27"]},
}


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t
    def __call__(self):
        return self.t


class Fake:
    attribution = "fake"
    def __init__(self, name, results):
        self.name, self.results, self.calls = name, list(results), 0
    def fetch(self):
        self.calls += 1
        r = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(r, Exception):
            raise r
        return r


def svc(providers, clock, tmp_path=None):
    return WeatherService(providers, state_path=str(tmp_path / "s.json") if tmp_path else None,
                          now=clock, sleep=lambda s: None)


def test_open_meteo_parse_converts_units():
    w = OpenMeteoProvider.parse(OPEN_METEO_SAMPLE)
    assert w["temperature_c"] == -24.3 and w["wmo_code"] == 71
    assert w["snowfall_cm_h"] == pytest.approx(0.28)      # 0.07 cm per 15 min
    assert w["rain_mm_h"] == 0.0 and w["snow_depth_m"] == 0.08
    assert w["observed_at"] == 1768439700                 # 09:15 +08:00 == 01:15Z
    assert w["sunset"] - w["sunrise"] == (8 * 60 + 51) * 60


def test_open_meteo_bad_payload_is_an_error_not_fake_data():
    with pytest.raises(ProviderError):
        OpenMeteoProvider.parse({"current": {"time": "2026-01-15T09:15"}})
    with pytest.raises(ProviderError):
        OpenMeteoProvider(fetch=lambda url: {"error": True, "reason": "x"}).fetch()


def test_google_requires_key_and_never_leaks_it():
    with pytest.raises(NotConfigured):
        GoogleWeatherProvider(api_key="").fetch()
    seen = {}
    def fetch(url):
        seen["url"] = url
        return {"currentTime": "2026-01-15T01:15:00Z", "weatherCondition": {"type": "LIGHT_SNOW", "description": {"text": "Light snow"}},
                "temperature": {"degrees": -24.0}, "feelsLikeTemperature": {"degrees": -30.0}, "relativeHumidity": 78,
                "wind": {"direction": {"degrees": 310}, "speed": {"value": 7.2}, "gust": {"value": 14.4}},
                "cloudCover": 100, "visibility": {"distance": 4.2}, "airPressure": {"meanSeaLevelMillibars": 1036.2},
                "precipitation": {"qpf": {"quantity": 0.0}}}
    w = GoogleWeatherProvider(api_key="k123", fetch=fetch).fetch()
    assert "key=k123" in seen["url"] and w["wmo_code"] == 71 and w["wind_speed_ms"] == pytest.approx(2.0)
    assert w["visibility_m"] == 4200.0
    s = svc([GoogleWeatherProvider(api_key="k123", fetch=fetch)], Clock())
    assert "k123" not in json.dumps(s.snapshot())


def test_fallback_order_and_error_reporting():
    good = OpenMeteoProvider.parse(OPEN_METEO_SAMPLE)
    g = Fake("google-weather", [NotConfigured("no key")])
    n = NamemProvider()
    o = Fake("open-meteo", [good])
    out = svc([g, n, o], Clock()).snapshot()
    assert out["freshness"] == "live" and out["provider"] == "open-meteo"
    assert out["weather"]["temperature_c"] == -24.3
    assert [e["provider"] for e in out["errors"]] == ["google-weather", "namem"]
    assert g.calls == 1                                   # missing credentials are not retried


def test_retry_then_success():
    good = OpenMeteoProvider.parse(OPEN_METEO_SAMPLE)
    p = Fake("open-meteo", [ProviderError("timeout"), ProviderError("timeout"), good])
    out = svc([p], Clock()).snapshot()
    assert out["freshness"] == "live" and p.calls == 3


def test_cache_then_stale_then_recovery(tmp_path):
    clock = Clock()
    good = OpenMeteoProvider.parse(OPEN_METEO_SAMPLE)
    p = Fake("open-meteo", [good, ProviderError("down")])
    s = svc([p], clock, tmp_path)
    assert s.snapshot()["freshness"] == "live" and p.calls == 1
    clock.t += 120
    assert s.snapshot()["age_seconds"] == 120 and p.calls == 1          # cached for 5 minutes
    clock.t += 300                                                       # provider now down
    out = s.snapshot()
    assert out["freshness"] == "live" and out["weather"]["temperature_c"] == -24.3
    assert out["errors"][0]["provider"] == "open-meteo"
    clock.t += 3600
    out = s.snapshot()
    assert out["freshness"] == "stale" and out["age_seconds"] == 4020    # last good shown, flagged
    assert out["weather"]["temperature_c"] == -24.3
    # Restart: last good survives on disk and is still marked stale.
    s2 = svc([Fake("open-meteo", [ProviderError("down")])], clock, tmp_path)
    out = s2.snapshot()
    assert out["freshness"] == "stale" and out["fetched_at"] == 1_000_000
    # Provider returns: live again.
    p.results = [dict(good, temperature_c=-20.0)]
    clock.t += 300
    out = s.snapshot()
    assert out["freshness"] == "live" and out["weather"]["temperature_c"] == -20.0


def test_unavailable_when_never_fetched():
    out = svc([Fake("open-meteo", [ProviderError("down")])], Clock()).snapshot()
    assert out["freshness"] == "unavailable" and out["weather"] is None
    assert out["local_time"] and out["utc_offset_seconds"] == 28800     # the clock still works


def test_local_time_is_ulaanbaatar():
    out = svc([Fake("x", [ProviderError("down")])], Clock(1794297600)).snapshot()
    assert out["local_time"] == "2026-11-10T16:00:00"


def test_http_endpoint():
    good = OpenMeteoProvider.parse(OPEN_METEO_SAMPLE)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(svc([Fake("open-meteo", [good])], Clock())))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        body = json.loads(opener.open(base + "/v1/world", timeout=5).read())
        assert body["freshness"] == "live" and body["weather"]["wmo_code"] == 71
        assert json.loads(opener.open(base + "/healthz", timeout=5).read()) == {"ok": True}
    finally:
        srv.shutdown()


@pytest.mark.live
def test_live_open_meteo_ulaanbaatar():
    """Hits the real API. Skipped automatically when the network is unavailable."""
    try:
        w = OpenMeteoProvider().fetch()
    except ProviderError as e:
        pytest.skip(f"network unavailable: {e}")
    assert -60 < w["temperature_c"] < 45 and 0 <= w["humidity_pct"] <= 100
    assert w["sunrise"] < w["sunset"] and 0 <= w["wmo_code"] <= 99
    print("LIVE Ulaanbaatar weather:", json.dumps(w))
