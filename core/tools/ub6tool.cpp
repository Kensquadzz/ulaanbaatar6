// Command-line access to the core, used by cross-checks against live services.
//   ub6tool sun <unixUtc>            -> elevation azimuth sunriseLocal sunsetLocal phase daylight
//   ub6tool route <graph> <e0> <n0> <e1> <n1> <car|foot|horse>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include "ub6/Geo.h"
#include "ub6/LiveClock.h"
#include "ub6/RoadGraph.h"

using namespace ub6;

int main(int argc, char** argv) {
    if (argc >= 3 && !std::strcmp(argv[1], "sun")) {
        LiveClock clock(kOriginLatDeg, kOriginLonDeg);
        const ClockState s = clock.evaluate(std::atoll(argv[2]));
        const char* phase[] = {"night", "dawn", "day", "dusk"};
        std::printf("%s %s elevation=%.3f azimuth=%.3f sunrise=%s sunset=%s phase=%s daylight=%.3f streetlights=%d\n",
                    formatDate(s.local).c_str(), formatTime(s.local).c_str(), s.sun.elevationDeg, s.sun.azimuthDeg,
                    formatTime(toLocal(s.sunTimes.sunrise)).c_str(), formatTime(toLocal(s.sunTimes.sunset)).c_str(),
                    phase[static_cast<int>(s.phase)], s.daylight, s.streetLightsOn ? 1 : 0);
        return 0;
    }
    if (argc >= 8 && (!std::strcmp(argv[1], "route") || !std::strcmp(argv[1], "routepts"))) {
        std::ifstream f(argv[2]);
        RoadGraph g;
        if (!g.load(f)) { std::fprintf(stderr, "cannot load graph\n"); return 2; }
        const TravelMode m = !std::strcmp(argv[7], "car") ? TravelMode::Car : (!std::strcmp(argv[7], "horse") ? TravelMode::Horse : TravelMode::Foot);
        const int32_t a = g.nearestNode(std::atof(argv[3]), std::atof(argv[4]), m);
        const int32_t b = g.nearestNode(std::atof(argv[5]), std::atof(argv[6]), m);
        const Route r = g.route(a, b, m);
        if (!std::strcmp(argv[1], "routepts")) {
            for (double v : r.polyline) std::printf("%.2f ", v);
            std::printf("\n");
            return r.found ? 0 : 1;
        }
        std::printf("found=%d length_m=%.0f duration_s=%.0f edges=%zu\n", r.found ? 1 : 0, r.lengthM, r.durationS, r.edges.size());
        return r.found ? 0 : 1;
    }
    std::fprintf(stderr, "usage: ub6tool sun <unixUtc> | route <graph> e0 n0 e1 n1 mode\n");
    return 64;
}
