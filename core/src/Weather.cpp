#include "ub6/Weather.h"
#include <algorithm>
#include <cmath>

namespace ub6 {
namespace {
inline double sat01(double v) { return std::clamp(v, 0.0, 1.0); }
inline double approachRate(double cur, double tgt, double ratePerS, double dt) {
    const double step = ratePerS * dt;
    return cur < tgt ? std::min(tgt, cur + step) : std::max(tgt, cur - step);
}
}

WeatherCondition conditionFromWmoCode(int c) {
    if (c == 0 || c == 1) return WeatherCondition::Clear;
    if (c == 2) return WeatherCondition::PartlyCloudy;
    if (c == 3) return WeatherCondition::Overcast;
    if (c == 45 || c == 48) return WeatherCondition::Fog;
    if (c >= 51 && c <= 55) return WeatherCondition::Drizzle;
    if (c == 56 || c == 57 || c == 66 || c == 67) return WeatherCondition::FreezingRain;
    if ((c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return WeatherCondition::Rain;
    if ((c >= 71 && c <= 77) || c == 85 || c == 86) return WeatherCondition::Snow;
    if (c >= 95 && c <= 99) return WeatherCondition::Thunderstorm;
    return WeatherCondition::Unknown;
}

const char* conditionKey(WeatherCondition c) {
    switch (c) {
        case WeatherCondition::Clear: return "weather.clear";
        case WeatherCondition::PartlyCloudy: return "weather.partly_cloudy";
        case WeatherCondition::Overcast: return "weather.overcast";
        case WeatherCondition::Fog: return "weather.fog";
        case WeatherCondition::Drizzle: return "weather.drizzle";
        case WeatherCondition::Rain: return "weather.rain";
        case WeatherCondition::FreezingRain: return "weather.freezing_rain";
        case WeatherCondition::Snow: return "weather.snow";
        case WeatherCondition::Thunderstorm: return "weather.thunderstorm";
        default: return "weather.unknown";
    }
}

DataFreshness freshness(const WeatherSnapshot& s, int64_t now, int64_t liveMaxAgeS) {
    if (!s.valid) return DataFreshness::Unavailable;
    return (now - s.fetchedUnixUtc) <= liveMaxAgeS ? DataFreshness::Live : DataFreshness::Stale;
}

WeatherSimParams WeatherSimulation::target(const WeatherSnapshot& s) const {
    WeatherSimParams t;
    const bool freezing = s.temperatureC <= 0.0;
    t.snowfallIntensity = sat01(s.snowfallCmH / 3.0);            // 3 cm/h = heavy snow
    t.rainIntensity = sat01(s.rainMmH / 8.0);                    // 8 mm/h = heavy rain
    // Reported snow depth is authoritative; 5 cm fully covers the ground visually.
    t.snowCover = sat01(std::max(s.snowDepthM / 0.05, t.snowfallIntensity > 0 && freezing ? 0.15 : 0.0));
    if (s.temperatureC > 3.0 && s.snowDepthM <= 0.0) t.snowCover = 0.0;
    t.roadWetness = freezing ? 0.0 : sat01(t.rainIntensity * 1.5 + (s.rainMmH > 0 ? 0.3 : 0.0));
    t.puddles = sat01((t.rainIntensity - 0.25) / 0.75);
    const bool freezingRain = s.condition == WeatherCondition::FreezingRain;
    t.ice = freezingRain ? 0.8 : (freezing && (t.snowCover > 0.2 || s.humidityPct > 85.0) ? sat01(0.3 + -s.temperatureC / 40.0) : 0.0);
    // Grip: dry 1.0, wet ~0.7, packed snow ~0.4, ice ~0.2 (typical friction ratios).
    double grip = 1.0;
    grip = std::min(grip, 1.0 - 0.3 * t.roadWetness);
    grip = std::min(grip, 1.0 - 0.6 * t.snowCover);
    grip = std::min(grip, 1.0 - 0.8 * t.ice);
    t.tireFriction = std::clamp(grip, 0.2, 1.0);
    t.visibilityM = std::clamp(s.visibilityM, 50.0, 50000.0);
    // Koschmieder: extinction = 3.912 / visibility. Normalised so 200 m fog = 1.
    t.fogDensity = sat01((3.912 / t.visibilityM) / (3.912 / 200.0));
    t.cloudCover = sat01(s.cloudCoverPct / 100.0);
    t.windStrength = sat01(s.windSpeedMs / 15.0);
    t.windDirectionDeg = s.windDirectionDeg;
    t.breathVisible = s.temperatureC < 5.0;
    t.frost = s.temperatureC < -5.0;
    t.wipersNeeded = t.rainIntensity > 0.02 || t.snowfallIntensity > 0.02;
    t.winterClothing = s.feelsLikeC < 5.0;
    return t;
}

void WeatherSimulation::reset(const WeatherSnapshot& s) { if (s.valid) p_ = target(s); }

void WeatherSimulation::update(const WeatherSnapshot& s, double dt) {
    if (!s.valid) return;                      // keep last state; never invent weather
    const WeatherSimParams t = target(s);
    p_.snowfallIntensity = approachRate(p_.snowfallIntensity, t.snowfallIntensity, 1.0 / 30.0, dt);
    p_.rainIntensity = approachRate(p_.rainIntensity, t.rainIntensity, 1.0 / 30.0, dt);
    p_.snowCover = approachRate(p_.snowCover, t.snowCover, 1.0 / 600.0, dt);     // minutes to settle/melt
    p_.roadWetness = approachRate(p_.roadWetness, t.roadWetness, t.roadWetness > p_.roadWetness ? 1.0 / 60.0 : 1.0 / 900.0, dt);
    p_.puddles = approachRate(p_.puddles, t.puddles, 1.0 / 300.0, dt);
    p_.ice = approachRate(p_.ice, t.ice, 1.0 / 600.0, dt);
    p_.fogDensity = approachRate(p_.fogDensity, t.fogDensity, 1.0 / 120.0, dt);
    p_.cloudCover = approachRate(p_.cloudCover, t.cloudCover, 1.0 / 120.0, dt);
    p_.windStrength = approachRate(p_.windStrength, t.windStrength, 1.0 / 20.0, dt);
    p_.visibilityM = t.visibilityM;
    p_.windDirectionDeg = t.windDirectionDeg;
    double grip = 1.0;
    grip = std::min(grip, 1.0 - 0.3 * p_.roadWetness);
    grip = std::min(grip, 1.0 - 0.6 * p_.snowCover);
    grip = std::min(grip, 1.0 - 0.8 * p_.ice);
    p_.tireFriction = std::clamp(grip, 0.2, 1.0);
    p_.breathVisible = t.breathVisible; p_.frost = t.frost;
    p_.wipersNeeded = p_.rainIntensity > 0.02 || p_.snowfallIntensity > 0.02;
    p_.winterClothing = t.winterClothing;
}

} // namespace ub6
