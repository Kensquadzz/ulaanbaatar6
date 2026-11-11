#include "ub6/Mesh.h"
#include <algorithm>
#include <cmath>

namespace ub6 {
namespace {
struct P2 { double x, y; };
inline double cross(const P2& a, const P2& b, const P2& c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
inline bool inTri(const P2& p, const P2& a, const P2& b, const P2& c) {
    const double d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12;
}
inline void push3(std::vector<float>& v, double x, double y, double z) {
    v.push_back(static_cast<float>(x)); v.push_back(static_cast<float>(y)); v.push_back(static_cast<float>(z));
}
}

double ringArea(const std::vector<double>& r) {
    const size_t n = r.size() / 2;
    double a = 0;
    for (size_t i = 0; i < n; ++i) {
        const size_t j = (i + 1) % n;
        a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
    }
    return a / 2;
}

bool triangulate(const std::vector<double>& ring, std::vector<uint32_t>& out) {
    const size_t n0 = ring.size() / 2;
    if (n0 < 3) return false;
    const bool ccw = ringArea(ring) > 0;
    // Work list in counter-clockwise order, dropping consecutive duplicates.
    std::vector<uint32_t> idx;
    idx.reserve(n0);
    for (size_t k = 0; k < n0; ++k) {
        const uint32_t i = static_cast<uint32_t>(ccw ? k : n0 - 1 - k);
        if (!idx.empty()) {
            const uint32_t p = idx.back();
            if (std::fabs(ring[p * 2] - ring[i * 2]) < 1e-9 && std::fabs(ring[p * 2 + 1] - ring[i * 2 + 1]) < 1e-9) continue;
        }
        idx.push_back(i);
    }
    while (idx.size() > 1 && std::fabs(ring[idx.front() * 2] - ring[idx.back() * 2]) < 1e-9 &&
           std::fabs(ring[idx.front() * 2 + 1] - ring[idx.back() * 2 + 1]) < 1e-9) idx.pop_back();
    if (idx.size() < 3) return false;
    auto pt = [&](uint32_t i) { return P2{ring[i * 2], ring[i * 2 + 1]}; };
    const size_t start = out.size();
    size_t guard = idx.size() * idx.size() + 16;
    size_t i = 0;
    while (idx.size() > 3 && guard-- > 0) {
        const size_t n = idx.size();
        const uint32_t ia = idx[(i + n - 1) % n], ib = idx[i % n], ic = idx[(i + 1) % n];
        const P2 a = pt(ia), b = pt(ib), c = pt(ic);
        const double cr = cross(a, b, c);
        bool ear = cr > 1e-12;
        if (ear) {
            for (size_t k = 0; k < n && ear; ++k) {
                const uint32_t ik = idx[k];
                if (ik == ia || ik == ib || ik == ic) continue;
                const P2 p = pt(ik);
                // Vertices coincident with a corner (pinch points) do not block the ear.
                if ((p.x == a.x && p.y == a.y) || (p.x == b.x && p.y == b.y) || (p.x == c.x && p.y == c.y)) continue;
                if (inTri(p, a, b, c)) ear = false;
            }
        }
        if (ear) { out.push_back(ia); out.push_back(ib); out.push_back(ic); idx.erase(idx.begin() + static_cast<long>(i % n)); i = 0; }
        else if (std::fabs(cr) <= 1e-12) { idx.erase(idx.begin() + static_cast<long>(i % n)); i = 0; }   // collinear: drop
        else ++i;
        if (i >= idx.size() * 2) break;                    // no ear found: self-intersecting input
    }
    if (idx.size() == 3) {
        if (cross(pt(idx[0]), pt(idx[1]), pt(idx[2])) > 1e-12) { out.push_back(idx[0]); out.push_back(idx[1]); out.push_back(idx[2]); }
        return out.size() > start;
    }
    out.resize(start);
    return false;
}

bool appendBuilding(MeshData& m, const std::vector<double>& ring, double baseZ, double height) {
    std::vector<uint32_t> tri;
    if (!triangulate(ring, tri)) return false;
    const size_t n = ring.size() / 2;
    const double top = baseZ + height;
    const uint32_t roof0 = static_cast<uint32_t>(m.vertexCount());
    for (size_t i = 0; i < n; ++i) { push3(m.positions, ring[i * 2], ring[i * 2 + 1], top); push3(m.normals, 0, 0, 1); }
    for (uint32_t t : tri) m.indices.push_back(roof0 + t);
    const double sign = ringArea(ring) > 0 ? 1.0 : -1.0;   // outward normal depends on winding
    for (size_t i = 0; i < n; ++i) {
        const size_t j = (i + 1) % n;
        const double ax = ring[i * 2], ay = ring[i * 2 + 1], bx = ring[j * 2], by = ring[j * 2 + 1];
        const double dx = bx - ax, dy = by - ay, len = std::hypot(dx, dy);
        if (len < 1e-6) continue;
        const double nx = sign * dy / len, ny = -sign * dx / len;
        const uint32_t v = static_cast<uint32_t>(m.vertexCount());
        push3(m.positions, ax, ay, baseZ); push3(m.positions, bx, by, baseZ);
        push3(m.positions, bx, by, top);   push3(m.positions, ax, ay, top);
        for (int k = 0; k < 4; ++k) push3(m.normals, nx, ny, 0);
        if (sign > 0) { m.indices.insert(m.indices.end(), {v, v + 1, v + 2, v, v + 2, v + 3}); }
        else          { m.indices.insert(m.indices.end(), {v, v + 2, v + 1, v, v + 3, v + 2}); }
    }
    return true;
}

void appendRoad(MeshData& m, const std::vector<double>& p, double width, double zOffset) {
    const size_t n = p.size() / 3;
    if (n < 2) return;
    const double hw = width / 2;
    const uint32_t base = static_cast<uint32_t>(m.vertexCount());
    for (size_t i = 0; i < n; ++i) {
        const size_t a = i == 0 ? 0 : i - 1, b = i == n - 1 ? n - 1 : i + 1;
        double d1x = p[i * 3] - p[a * 3], d1y = p[i * 3 + 1] - p[a * 3 + 1];
        double d2x = p[b * 3] - p[i * 3], d2y = p[b * 3 + 1] - p[i * 3 + 1];
        const double l1 = std::hypot(d1x, d1y), l2 = std::hypot(d2x, d2y);
        if (l1 > 1e-9) { d1x /= l1; d1y /= l1; } else { d1x = d2x / std::max(l2, 1e-9); d1y = d2y / std::max(l2, 1e-9); }
        if (l2 > 1e-9) { d2x /= l2; d2y /= l2; } else { d2x = d1x; d2y = d1y; }
        double tx = d1x + d2x, ty = d1y + d2y;
        const double tl = std::hypot(tx, ty);
        if (tl < 1e-9) { tx = d2x; ty = d2y; } else { tx /= tl; ty /= tl; }
        // Mitre: widen at corners so the ribbon keeps its width, capped to avoid spikes.
        const double cosHalf = std::max(0.35, tx * d2x + ty * d2y);
        const double w = hw / cosHalf;
        const double nx = -ty, ny = tx;                    // left of travel
        push3(m.positions, p[i * 3] + nx * w, p[i * 3 + 1] + ny * w, p[i * 3 + 2] + zOffset);
        push3(m.positions, p[i * 3] - nx * w, p[i * 3 + 1] - ny * w, p[i * 3 + 2] + zOffset);
        push3(m.normals, 0, 0, 1); push3(m.normals, 0, 0, 1);
    }
    for (uint32_t i = 0; i + 1 < n; ++i) {
        const uint32_t l0 = base + i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
        m.indices.insert(m.indices.end(), {l0, r0, r1, l0, r1, l1});
    }
}

void appendTerrain(MeshData& m, const std::vector<float>& h, int n, double ox, double oy, double cell, int step) {
    if (n < 2 || static_cast<int>(h.size()) < n * n || step < 1 || (n - 1) % step != 0) return;
    const int cnt = (n - 1) / step + 1;
    const uint32_t base = static_cast<uint32_t>(m.vertexCount());
    auto H = [&](int i, int j) { return static_cast<double>(h[static_cast<size_t>(std::clamp(j, 0, n - 1)) * n + std::clamp(i, 0, n - 1)]); };
    for (int j = 0; j < cnt; ++j)
        for (int i = 0; i < cnt; ++i) {
            const int gi = i * step, gj = j * step;
            push3(m.positions, ox + gi * cell, oy + gj * cell, H(gi, gj));
            const double dzdx = (H(gi + 1, gj) - H(gi - 1, gj)) / ((std::min(gi + 1, n - 1) - std::max(gi - 1, 0)) * cell);
            const double dzdy = (H(gi, gj + 1) - H(gi, gj - 1)) / ((std::min(gj + 1, n - 1) - std::max(gj - 1, 0)) * cell);
            const double l = std::sqrt(dzdx * dzdx + dzdy * dzdy + 1);
            push3(m.normals, -dzdx / l, -dzdy / l, 1 / l);
        }
    for (int j = 0; j + 1 < cnt; ++j)
        for (int i = 0; i + 1 < cnt; ++i) {
            const uint32_t a = base + static_cast<uint32_t>(j * cnt + i), b = a + 1, c = a + static_cast<uint32_t>(cnt), d = c + 1;
            m.indices.insert(m.indices.end(), {a, b, d, a, d, c});
        }
}

double sampleTerrain(const std::vector<float>& h, int n, double ox, double oy, double cell, double x, double y) {
    if (n < 2 || static_cast<int>(h.size()) < n * n) return 0;
    const double fx = std::clamp((x - ox) / cell, 0.0, n - 1.0), fy = std::clamp((y - oy) / cell, 0.0, n - 1.0);
    const int i = std::min(static_cast<int>(fx), n - 2), j = std::min(static_cast<int>(fy), n - 2);
    const double u = fx - i, v = fy - j;
    auto H = [&](int a, int b) { return static_cast<double>(h[static_cast<size_t>(b) * n + a]); };
    return (H(i, j) * (1 - u) + H(i + 1, j) * u) * (1 - v) + (H(i, j + 1) * (1 - u) + H(i + 1, j + 1) * u) * v;
}

} // namespace ub6
