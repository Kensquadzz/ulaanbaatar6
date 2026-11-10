#include "ub6/Solar.h"
#include <cmath>
#include "MathUtil.h"

namespace ub6 {
using namespace detail;
namespace {

struct Ephem { double declRad; double eotMin; };

Ephem ephem(double unixUtc) {
    const double jd = unixUtc / 86400.0 + 2440587.5;
    const double t = (jd - 2451545.0) / 36525.0;
    const double l0 = wrap(280.46646 + t * (36000.76983 + 0.0003032 * t), 360.0);
    const double m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const double e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const double mr = rad(m);
    const double c = std::sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
                     std::sin(2 * mr) * (0.019993 - 0.000101 * t) + std::sin(3 * mr) * 0.000289;
    const double omega = rad(125.04 - 1934.136 * t);
    const double lambda = rad(l0 + c - 0.00569 - 0.00478 * std::sin(omega));
    const double eps0 = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0;
    const double eps = rad(eps0 + 0.00256 * std::cos(omega));
    const double decl = std::asin(std::sin(eps) * std::sin(lambda));
    const double y = std::tan(eps / 2) * std::tan(eps / 2);
    const double l0r = rad(l0);
    const double eot = 4.0 * deg(y * std::sin(2 * l0r) - 2 * e * std::sin(mr) +
                                 4 * e * y * std::sin(mr) * std::cos(2 * l0r) -
                                 0.5 * y * y * std::sin(4 * l0r) - 1.25 * e * e * std::sin(2 * mr));
    return {decl, eot};
}

// Hour angle (deg) at which the sun centre is at the given zenith; <0 if never.
double hourAngle(double latDeg, double declRad, double zenithDeg) {
    const double lat = rad(latDeg);
    const double c = std::cos(rad(zenithDeg)) / (std::cos(lat) * std::cos(declRad)) - std::tan(lat) * std::tan(declRad);
    if (c < -1.0 || c > 1.0) return -1.0;
    return deg(std::acos(c));
}
} // namespace

SunPosition sunPosition(int64_t unixUtc, double latDeg, double lonDeg) {
    const Ephem ep = ephem(static_cast<double>(unixUtc));
    const double minutesUtc = wrap(static_cast<double>(unixUtc), 86400.0) / 60.0;
    const double tst = wrap(minutesUtc + ep.eotMin + 4.0 * lonDeg, 1440.0);
    const double ha = rad(tst / 4.0 - 180.0);
    const double lat = rad(latDeg);
    double cosZ = std::sin(lat) * std::sin(ep.declRad) + std::cos(lat) * std::cos(ep.declRad) * std::cos(ha);
    cosZ = std::fmax(-1.0, std::fmin(1.0, cosZ));
    const double z = std::acos(cosZ);
    double az = 0;
    const double denom = std::cos(lat) * std::sin(z);
    if (std::fabs(denom) > 1e-9) {
        double a = (std::sin(lat) * cosZ - std::sin(ep.declRad)) / denom;
        a = deg(std::acos(std::fmax(-1.0, std::fmin(1.0, a))));
        az = ha > 0 ? wrap(a + 180.0, 360.0) : wrap(540.0 - a, 360.0);
    }
    return {90.0 - deg(z), az};
}

SunTimes sunTimes(int64_t unixUtc, double latDeg, double lonDeg, int utcOffsetSeconds) {
    SunTimes out;
    // Midnight (UTC seconds) of the local day.
    const int64_t local = unixUtc + utcOffsetSeconds;
    const int64_t dayStartLocal = local - ((local % 86400) + 86400) % 86400;
    const int64_t dayStartUtc = dayStartLocal - utcOffsetSeconds;

    auto solve = [&](double zenithDeg, int sign, int64_t& result) -> bool {
        double guess = static_cast<double>(dayStartUtc) + 43200.0;   // local noon
        for (int i = 0; i < 3; ++i) {
            const Ephem ep = ephem(guess);
            // Solar noon in minutes after local midnight.
            const double noonMin = 720.0 - 4.0 * lonDeg - ep.eotMin + utcOffsetSeconds / 60.0;
            double offsetMin = 0;
            if (sign != 0) {
                const double ha = hourAngle(latDeg, ep.declRad, zenithDeg);
                if (ha < 0) return false;
                offsetMin = sign * 4.0 * ha;
            }
            guess = static_cast<double>(dayStartUtc) + (noonMin + offsetMin) * 60.0;
        }
        result = static_cast<int64_t>(std::llround(guess));
        return true;
    };

    bool ok = solve(0, 0, out.solarNoon);
    ok = solve(90.833, -1, out.sunrise) && ok;      // refraction + solar radius
    ok = solve(90.833, +1, out.sunset) && ok;
    ok = solve(96.0, -1, out.civilDawn) && ok;
    ok = solve(96.0, +1, out.civilDusk) && ok;
    out.valid = ok;
    return out;
}

} // namespace ub6
