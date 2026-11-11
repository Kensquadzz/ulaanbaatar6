// Reads "ring" lines (x y x y ...) on stdin, reports how many triangulate and the area error.
#include <cmath>
#include <cstdio>
#include <iostream>
#include <sstream>
#include <string>
#include "ub6/Mesh.h"
int main() {
    std::string line; long ok = 0, bad = 0, tris = 0; double worst = 0;
    while (std::getline(std::cin, line)) {
        std::istringstream ss(line); std::vector<double> r; double v;
        while (ss >> v) r.push_back(v);
        std::vector<uint32_t> t;
        if (!ub6::triangulate(r, t)) { ++bad; continue; }
        double a = 0;
        for (size_t k = 0; k < t.size(); k += 3)
            a += 0.5 * std::fabs((r[t[k + 1] * 2] - r[t[k] * 2]) * (r[t[k + 2] * 2 + 1] - r[t[k] * 2 + 1]) - (r[t[k + 1] * 2 + 1] - r[t[k] * 2 + 1]) * (r[t[k + 2] * 2] - r[t[k] * 2]));
        const double ref = std::fabs(ub6::ringArea(r));
        worst = std::max(worst, std::fabs(a - ref) / std::max(ref, 1.0));
        ++ok; tris += static_cast<long>(t.size() / 3);
    }
    std::printf("triangulated=%ld failed=%ld triangles=%ld worst_relative_area_error=%.2e\n", ok, bad, tris, worst);
    return 0;
}
