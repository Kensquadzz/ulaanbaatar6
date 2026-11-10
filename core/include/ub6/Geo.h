// ULAANBAATAR 6 core: geodesy. Engine independent, double precision.
#pragma once
#include <cstdint>

namespace ub6 {

struct GeoPoint { double latDeg = 0, lonDeg = 0, heightM = 0; };
struct Enu { double east = 0, north = 0, up = 0; };   // metres from world origin
struct ChunkCoord {
    int32_t x = 0, y = 0;
    bool operator==(const ChunkCoord& o) const { return x == o.x && y == o.y; }
    bool operator<(const ChunkCoord& o) const { return x != o.x ? x < o.x : y < o.y; }
};

// World origin: centre of Sukhbaatar Square. Must match pipeline/config.py.
constexpr double kOriginLatDeg = 47.918873;
constexpr double kOriginLonDeg = 106.917580;
constexpr double kChunkSizeM = 256.0;

// Local tangent plane (East-North-Up) through WGS84 ECEF. Exact, not a flat-earth
// approximation, so the whole city can be added later without drift.
class LocalFrame {
public:
    explicit LocalFrame(GeoPoint origin = {kOriginLatDeg, kOriginLonDeg, 0.0});
    Enu toEnu(const GeoPoint& p) const;
    GeoPoint toGeo(const Enu& e) const;
    const GeoPoint& origin() const { return origin_; }
private:
    GeoPoint origin_;
    double ox_, oy_, oz_;          // origin ECEF
    double r_[3][3];               // ECEF -> ENU rotation
};

double haversineM(const GeoPoint& a, const GeoPoint& b);
ChunkCoord chunkOf(double east, double north, double chunkSize = kChunkSizeM);

} // namespace ub6
