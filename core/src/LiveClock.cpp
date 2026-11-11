#include "ub6/LiveClock.h"
#include <algorithm>
#include <cstdio>

namespace ub6 {

LocalDateTime toLocal(int64_t unixUtc, int utcOffsetSeconds) {
    const int64_t t = unixUtc + utcOffsetSeconds;
    int64_t days = t / 86400;
    int64_t rem = t % 86400;
    if (rem < 0) { rem += 86400; --days; }
    // Civil-from-days (Howard Hinnant), valid for the proleptic Gregorian calendar.
    const int64_t z = days + 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const int64_t doe = z - era * 146097;
    const int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const int64_t mp = (5 * doy + 2) / 153;
    LocalDateTime o{};
    o.day = static_cast<int>(doy - (153 * mp + 2) / 5 + 1);
    o.month = static_cast<int>(mp < 10 ? mp + 3 : mp - 9);
    o.year = static_cast<int>(yoe + era * 400 + (o.month <= 2 ? 1 : 0));
    o.hour = static_cast<int>(rem / 3600);
    o.minute = static_cast<int>((rem % 3600) / 60);
    o.second = static_cast<int>(rem % 60);
    o.weekday = static_cast<int>(((days % 7) + 11) % 7);   // 1970-01-01 was a Thursday
    return o;
}

std::string formatTime(const LocalDateTime& t) {
    char b[8];
    std::snprintf(b, sizeof b, "%02d:%02d", t.hour, t.minute);
    return b;
}

std::string formatDate(const LocalDateTime& t) {
    char b[16];
    std::snprintf(b, sizeof b, "%04d-%02d-%02d", t.year, t.month, t.day);
    return b;
}

LiveClock::LiveClock(double latDeg, double lonDeg, int utcOffsetSeconds)
    : lat_(latDeg), lon_(lonDeg), offset_(utcOffsetSeconds) {}

void LiveClock::setFreePlayTime(int64_t unixUtc, double timeScale) {
    freeUnix_ = static_cast<double>(unixUtc);
    freeScale_ = timeScale;
}

void LiveClock::tickFreePlay(double realDeltaSeconds) {
    if (mode_ == WorldMode::FreePlay) freeUnix_ += realDeltaSeconds * freeScale_;
}

ClockState LiveClock::evaluate(int64_t realNowUnixUtc) const {
    ClockState s;
    s.mode = mode_;
    s.unixUtc = mode_ == WorldMode::Live ? realNowUnixUtc : static_cast<int64_t>(freeUnix_);
    s.local = toLocal(s.unixUtc, offset_);
    s.sun = sunPosition(s.unixUtc, lat_, lon_);
    s.sunTimes = sunTimes(s.unixUtc, lat_, lon_, offset_);
    const double el = s.sun.elevationDeg;
    const bool morning = !s.sunTimes.valid || s.unixUtc < s.sunTimes.solarNoon;
    if (el > -0.833) s.phase = DayPhase::Day;
    else if (el > -6.0) s.phase = morning ? DayPhase::Dawn : DayPhase::Dusk;
    else s.phase = DayPhase::Night;
    // Smooth 0..1 between end of civil twilight (-6 deg) and +6 deg.
    const double x = std::clamp((el + 6.0) / 12.0, 0.0, 1.0);
    s.daylight = x * x * (3.0 - 2.0 * x);
    // Street lights follow a photocell-like rule: on while the sun is below +1 deg.
    s.streetLightsOn = el < 1.0;
    s.buildingLightsOn = el < -2.0;
    return s;
}

} // namespace ub6
