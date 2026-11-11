// Solar position (NOAA algorithm). Used for the live sun, sunrise, sunset, twilight.
#pragma once
#include <cstdint>

namespace ub6 {

struct SunPosition {
    double elevationDeg = 0;   // above horizon, geometric (no refraction)
    double azimuthDeg = 0;     // clockwise from true north
};

struct SunTimes {              // unix seconds UTC; valid=false in polar day/night
    bool valid = false;
    int64_t civilDawn = 0, sunrise = 0, solarNoon = 0, sunset = 0, civilDusk = 0;
};

SunPosition sunPosition(int64_t unixUtc, double latDeg, double lonDeg);
// Sun times for the local calendar day that contains unixUtc at the given UTC offset.
SunTimes sunTimes(int64_t unixUtc, double latDeg, double lonDeg, int utcOffsetSeconds);

} // namespace ub6
