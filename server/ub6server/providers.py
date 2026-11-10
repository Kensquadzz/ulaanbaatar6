"""Weather provider adapters. Each returns the same normalised dict or raises ProviderError.

Normalised fields (SI units; None when the provider does not supply the value):
  observed_at (unix UTC), wmo_code, condition_text, temperature_c, feels_like_c, humidity_pct,
  wind_speed_ms, wind_direction_deg, wind_gust_ms, cloud_cover_pct, rain_mm_h, snowfall_cm_h,
  snow_depth_m, visibility_m, pressure_hpa, sunrise (unix UTC), sunset (unix UTC)
"""
import datetime as dt
import json
import os
import urllib.error
import urllib.parse
import urllib.request

UB_LAT, UB_LON = 47.918873, 106.917580
UB_TZ = dt.timezone(dt.timedelta(hours=8), "Asia/Ulaanbaatar")


class ProviderError(Exception):
    pass


class NotConfigured(ProviderError):
    """Provider needs credentials that are not present. Never retried."""


def http_get_json(url, timeout=15, headers=None):
    req = urllib.request.Request(url, headers={"User-Agent": "ub6-weather-server/1.0", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, json.JSONDecodeError) as e:
        raise ProviderError(f"{type(e).__name__}: {e}") from e


def _local_iso_to_unix(s):
    return int(dt.datetime.fromisoformat(s).replace(tzinfo=UB_TZ).timestamp())


class OpenMeteoProvider:
    """Open-Meteo forecast API (no key; CC BY 4.0 data, non-commercial free tier).

    A commercial release needs their paid plan or another provider: see docs/DEPENDENCIES.md.
    """
    name = "open-meteo"
    attribution = "Weather data by Open-Meteo.com (CC BY 4.0)"
    URL = "https://api.open-meteo.com/v1/forecast"
    CURRENT = ("temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,"
               "snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,"
               "wind_gusts_10m,visibility,snow_depth")

    def __init__(self, fetch=http_get_json):
        self._fetch = fetch

    def fetch(self):
        q = urllib.parse.urlencode({
            "latitude": UB_LAT, "longitude": UB_LON, "current": self.CURRENT, "daily": "sunrise,sunset",
            "wind_speed_unit": "ms", "timezone": "Asia/Ulaanbaatar", "forecast_days": 1})
        return self.parse(self._fetch(f"{self.URL}?{q}"))

    @staticmethod
    def parse(d):
        try:
            c = d["current"]
            # "current" precipitation values are sums over the preceding interval (seconds).
            per_hour = 3600.0 / float(c.get("interval") or 900)
            rain = (c.get("rain") or 0.0) + (c.get("showers") or 0.0)
            return {
                "observed_at": _local_iso_to_unix(c["time"]),
                "wmo_code": int(c["weather_code"]), "condition_text": None,
                "temperature_c": float(c["temperature_2m"]), "feels_like_c": float(c["apparent_temperature"]),
                "humidity_pct": float(c["relative_humidity_2m"]),
                "wind_speed_ms": float(c["wind_speed_10m"]), "wind_direction_deg": float(c["wind_direction_10m"]),
                "wind_gust_ms": c.get("wind_gusts_10m"), "cloud_cover_pct": float(c["cloud_cover"]),
                "rain_mm_h": rain * per_hour, "snowfall_cm_h": (c.get("snowfall") or 0.0) * per_hour,
                "snow_depth_m": c.get("snow_depth"), "visibility_m": c.get("visibility"),
                "pressure_hpa": c.get("pressure_msl"),
                "sunrise": _local_iso_to_unix(d["daily"]["sunrise"][0]),
                "sunset": _local_iso_to_unix(d["daily"]["sunset"][0]),
            }
        except (KeyError, TypeError, ValueError, IndexError) as e:
            raise ProviderError(f"unexpected Open-Meteo response: {e!r}") from e


# Google Weather API condition types -> WMO codes, so the game needs one mapping only.
_GOOGLE_TO_WMO = {
    "CLEAR": 0, "MOSTLY_CLEAR": 1, "PARTLY_CLOUDY": 2, "MOSTLY_CLOUDY": 3, "CLOUDY": 3,
    "WINDY": 1, "WIND_AND_RAIN": 63, "LIGHT_RAIN_SHOWERS": 80, "CHANCE_OF_SHOWERS": 80,
    "SCATTERED_SHOWERS": 80, "RAIN_SHOWERS": 81, "HEAVY_RAIN_SHOWERS": 82,
    "LIGHT_TO_MODERATE_RAIN": 61, "MODERATE_TO_HEAVY_RAIN": 65, "RAIN": 63, "LIGHT_RAIN": 61,
    "HEAVY_RAIN": 65, "RAIN_PERIODICALLY_HEAVY": 65, "LIGHT_SNOW_SHOWERS": 85,
    "CHANCE_OF_SNOW_SHOWERS": 85, "SCATTERED_SNOW_SHOWERS": 85, "SNOW_SHOWERS": 85,
    "HEAVY_SNOW_SHOWERS": 86, "LIGHT_TO_MODERATE_SNOW": 71, "MODERATE_TO_HEAVY_SNOW": 75,
    "SNOW": 73, "LIGHT_SNOW": 71, "HEAVY_SNOW": 75, "SNOWSTORM": 75, "SNOW_PERIODICALLY_HEAVY": 75,
    "HEAVY_SNOW_STORM": 75, "BLOWING_SNOW": 73, "RAIN_AND_SNOW": 67, "HAIL": 96, "HAIL_SHOWERS": 96,
    "THUNDERSTORM": 95, "THUNDERSHOWER": 95, "LIGHT_THUNDERSTORM_RAIN": 95,
    "SCATTERED_THUNDERSTORMS": 95, "HEAVY_THUNDERSTORM": 99,
}


class GoogleWeatherProvider:
    """Google Maps Platform Weather API, currentConditions:lookup.

    NOT TESTED against the live service: it needs a Google Cloud project with the Weather API
    enabled and billing. The key is read from GOOGLE_WEATHER_API_KEY on the server only and
    is never sent to the game client. The response mapping follows the public documentation
    and is unit-tested against a documented-shape sample, not a real response.
    """
    name = "google-weather"
    attribution = "Weather data (c) Google"
    URL = "https://weather.googleapis.com/v1/currentConditions:lookup"

    def __init__(self, api_key=None, fetch=http_get_json):
        self._key = api_key if api_key is not None else os.environ.get("GOOGLE_WEATHER_API_KEY", "")
        self._fetch = fetch

    def fetch(self):
        if not self._key:
            raise NotConfigured("GOOGLE_WEATHER_API_KEY is not set")
        q = urllib.parse.urlencode({"key": self._key, "location.latitude": UB_LAT,
                                    "location.longitude": UB_LON, "unitsSystem": "METRIC"})
        return self.parse(self._fetch(f"{self.URL}?{q}"))

    @staticmethod
    def parse(d):
        try:
            t = dt.datetime.fromisoformat(d["currentTime"].replace("Z", "+00:00"))
            cond = d.get("weatherCondition", {})
            ctype = cond.get("type", "")
            wind = d.get("wind", {})
            kmh = lambda o: None if not o or o.get("value") is None else float(o["value"]) / 3.6
            qpf = (d.get("precipitation", {}).get("qpf") or {}).get("quantity") or 0.0
            snow_qpf = (d.get("precipitation", {}).get("snowQpf") or {}).get("quantity") or 0.0
            vis = d.get("visibility", {}).get("distance")
            return {
                "observed_at": int(t.timestamp()),
                "wmo_code": _GOOGLE_TO_WMO.get(ctype, -1),
                "condition_text": (cond.get("description") or {}).get("text"),
                "temperature_c": float(d["temperature"]["degrees"]),
                "feels_like_c": float(d["feelsLikeTemperature"]["degrees"]),
                "humidity_pct": float(d["relativeHumidity"]),
                "wind_speed_ms": kmh(wind.get("speed")),
                "wind_direction_deg": (wind.get("direction") or {}).get("degrees"),
                "wind_gust_ms": kmh(wind.get("gust")),
                "cloud_cover_pct": d.get("cloudCover"),
                "rain_mm_h": float(qpf), "snowfall_cm_h": float(snow_qpf) / 10.0,
                "snow_depth_m": None,
                "visibility_m": None if vis is None else float(vis) * 1000.0,
                "pressure_hpa": (d.get("airPressure") or {}).get("meanSeaLevelMillibars"),
                "sunrise": None, "sunset": None,
            }
        except (KeyError, TypeError, ValueError) as e:
            raise ProviderError(f"unexpected Google Weather response: {e!r}") from e


class NamemProvider:
    """Mongolia's National Agency for Meteorology and Environmental Monitoring (NAMEM).

    Placeholder adapter: no documented public JSON API was available to build against.
    Enable only after NAMEM provides an endpoint and usage terms; see docs/DEPENDENCIES.md.
    """
    name = "namem"
    attribution = "NAMEM (tsag-agaar.gov.mn)"

    def fetch(self):
        raise NotConfigured("NAMEM has no documented API configured")
