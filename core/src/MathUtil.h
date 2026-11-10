// Internal helpers shared by core sources (kept in one place so unity builds do not clash).
#pragma once
#include <cmath>

namespace ub6 { namespace detail {
constexpr double kPi = 3.14159265358979323846;
inline double rad(double d) { return d * kPi / 180.0; }
inline double deg(double r) { return r * 180.0 / kPi; }
inline double wrap(double v, double m) { v = std::fmod(v, m); return v < 0 ? v + m : v; }
}} // namespace ub6::detail
