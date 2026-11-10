// Live weather model and its translation into gameplay/visual parameters.
#pragma once
#include <cstdint>
#include <string>

namespace ub6 {

enum class WeatherCondition { Clear, PartlyCloudy, Overcast, Fog, Drizzle, Rain, FreezingRain, Snow, Thunderstorm, Unknown };
enum class DataFreshness { Live, Stale, Unavailable };

// One observation as delivered by the weather service (server/). NaN = not provided.
struct WeatherSnapshot {
    bool valid = false;
    int64_t observedUnixUtc = 0;      // provider observation time
    int64_t fetchedUnixUtc = 0;       // when our server last fetched successfully
    std::string provider;             // "open-meteo", "google-weather", ...
    WeatherCondition condition = WeatherCondition::Unknown;
    double temperatureC = 0, feelsLikeC = 0, humidityPct = 0;
    double windSpeedMs = 0, windDirectionDeg = 0, windGustMs = 0;
    double cloudCoverPct = 0, rainMmH = 0, snowfallCmH = 0, snowDepthM = 0;
    double visibilityM = 20000, pressureHpa = 1013;
};

// WMO weather interpretation codes (used by Open-Meteo and many met services).
WeatherCondition conditionFromWmoCode(int code);
const char* conditionKey(WeatherCondition c);       // localisation key, e.g. "weather.snow"

// A snapshot is LIVE while younger than liveMaxAgeS, then STALE. Never extrapolated.
DataFreshness freshness(const WeatherSnapshot& s, int64_t nowUnixUtc, int64_t liveMaxAgeS = 20 * 60);

// What the renderer and physics consume. All 0..1 unless noted.
struct WeatherSimParams {
    double snowfallIntensity = 0, rainIntensity = 0;
    double snowCover = 0;             // ground/roof/vehicle accumulation
    double roadWetness = 0, puddles = 0, ice = 0;
    double tireFriction = 1.0;        // multiplier on dry-asphalt grip
    double fogDensity = 0;            // exponential height fog scale
    double visibilityM = 20000;
    double cloudCover = 0;
    double windStrength = 0;          // tree/flag sway
    double windDirectionDeg = 0;
    bool breathVisible = false, frost = false, wipersNeeded = false, winterClothing = false;
};

// Stateful so accumulation and drying evolve over time instead of snapping.
class WeatherSimulation {
public:
    void reset(const WeatherSnapshot& s);                 // jump straight to steady state
    void update(const WeatherSnapshot& s, double dtSeconds);
    const WeatherSimParams& params() const { return p_; }
private:
    WeatherSimParams target(const WeatherSnapshot& s) const;
    WeatherSimParams p_;
};

} // namespace ub6
