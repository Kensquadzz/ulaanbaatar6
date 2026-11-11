#include "ub6/Geo.h"
#include <cmath>
#include "MathUtil.h"

namespace ub6 {
using namespace detail;
namespace {
constexpr double kA = 6378137.0;                 // WGS84 semi-major axis
constexpr double kF = 1.0 / 298.257223563;
constexpr double kE2 = kF * (2.0 - kF);

void geoToEcef(const GeoPoint& p, double& x, double& y, double& z) {
    const double lat = rad(p.latDeg), lon = rad(p.lonDeg);
    const double s = std::sin(lat), c = std::cos(lat);
    const double n = kA / std::sqrt(1.0 - kE2 * s * s);
    x = (n + p.heightM) * c * std::cos(lon);
    y = (n + p.heightM) * c * std::sin(lon);
    z = (n * (1.0 - kE2) + p.heightM) * s;
}

GeoPoint ecefToGeo(double x, double y, double z) {
    const double lon = std::atan2(y, x);
    const double p = std::sqrt(x * x + y * y);
    double lat = std::atan2(z, p * (1.0 - kE2));
    double h = 0;
    for (int i = 0; i < 6; ++i) {                // converges to < 1e-9 m near the surface
        const double s = std::sin(lat);
        const double n = kA / std::sqrt(1.0 - kE2 * s * s);
        h = p / std::cos(lat) - n;
        lat = std::atan2(z, p * (1.0 - kE2 * n / (n + h)));
    }
    return {deg(lat), deg(lon), h};
}
} // namespace

LocalFrame::LocalFrame(GeoPoint origin) : origin_(origin) {
    geoToEcef(origin_, ox_, oy_, oz_);
    const double lat = rad(origin_.latDeg), lon = rad(origin_.lonDeg);
    const double sl = std::sin(lat), cl = std::cos(lat), so = std::sin(lon), co = std::cos(lon);
    r_[0][0] = -so;      r_[0][1] = co;       r_[0][2] = 0;
    r_[1][0] = -sl * co; r_[1][1] = -sl * so; r_[1][2] = cl;
    r_[2][0] = cl * co;  r_[2][1] = cl * so;  r_[2][2] = sl;
}

Enu LocalFrame::toEnu(const GeoPoint& p) const {
    double x, y, z;
    geoToEcef(p, x, y, z);
    const double dx = x - ox_, dy = y - oy_, dz = z - oz_;
    return {r_[0][0] * dx + r_[0][1] * dy + r_[0][2] * dz,
            r_[1][0] * dx + r_[1][1] * dy + r_[1][2] * dz,
            r_[2][0] * dx + r_[2][1] * dy + r_[2][2] * dz};
}

GeoPoint LocalFrame::toGeo(const Enu& e) const {
    const double x = ox_ + r_[0][0] * e.east + r_[1][0] * e.north + r_[2][0] * e.up;
    const double y = oy_ + r_[0][1] * e.east + r_[1][1] * e.north + r_[2][1] * e.up;
    const double z = oz_ + r_[0][2] * e.east + r_[1][2] * e.north + r_[2][2] * e.up;
    return ecefToGeo(x, y, z);
}

double haversineM(const GeoPoint& a, const GeoPoint& b) {
    const double r = 6371008.8;
    const double dlat = rad(b.latDeg - a.latDeg), dlon = rad(b.lonDeg - a.lonDeg);
    const double h = std::sin(dlat / 2) * std::sin(dlat / 2) +
                     std::cos(rad(a.latDeg)) * std::cos(rad(b.latDeg)) * std::sin(dlon / 2) * std::sin(dlon / 2);
    return 2 * r * std::asin(std::sqrt(h));
}

ChunkCoord chunkOf(double east, double north, double chunkSize) {
    return {static_cast<int32_t>(std::floor(east / chunkSize)),
            static_cast<int32_t>(std::floor(north / chunkSize))};
}

} // namespace ub6
