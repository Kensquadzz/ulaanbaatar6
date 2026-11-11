// Unit tests for the engine-independent core. No external framework needed.
#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
#include <string>
#include <vector>
#include "ub6/Gameplay.h"
#include "ub6/Geo.h"
#include "ub6/LiveClock.h"
#include "ub6/Mesh.h"
#include "ub6/Quality.h"
#include "ub6/RoadGraph.h"
#include "ub6/Solar.h"
#include "ub6/Streaming.h"
#include "ub6/TouchControls.h"
#include "ub6/Vehicle.h"
#include "ub6/Weather.h"

using namespace ub6;

static int g_failed = 0, g_checks = 0;
#define CHECK(cond) do { ++g_checks; if (!(cond)) { ++g_failed; std::printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } } while (0)
#define NEAR(a, b, tol) do { ++g_checks; const double _a = (a), _b = (b); if (!(std::fabs(_a - _b) <= (tol))) { ++g_failed; std::printf("  FAIL %s:%d  %s=%.6f expected %.6f +-%g\n", __FILE__, __LINE__, #a, _a, _b, (double)(tol)); } } while (0)

static void testGeo() {
    LocalFrame f;
    const Enu o = f.toEnu({kOriginLatDeg, kOriginLonDeg, 0});
    NEAR(o.east, 0, 1e-6); NEAR(o.north, 0, 1e-6); NEAR(o.up, 0, 1e-6);
    // Zaisan Hill as located by the pipeline (Python implementation of the same maths).
    const GeoPoint zaisan{47.883993, 106.915507, 0};
    const Enu z = f.toEnu(zaisan);
    NEAR(z.east, -155.02, 0.2); NEAR(z.north, -3878.26, 0.2);
    const GeoPoint back = f.toGeo(z);
    NEAR(back.latDeg, zaisan.latDeg, 1e-9); NEAR(back.lonDeg, zaisan.lonDeg, 1e-9); NEAR(back.heightM, 0, 1e-4);
    // Distance Sukhbaatar Square -> Zaisan is about 3.88 km.
    NEAR(haversineM({kOriginLatDeg, kOriginLonDeg, 0}, zaisan), 3881.0, 15.0);
    // Round trip stays sub-millimetre 40 km out (whole-city scale, e.g. the new airport).
    const GeoPoint far{47.6469, 106.8194, 1366};
    const GeoPoint far2 = f.toGeo(f.toEnu(far));
    NEAR(far2.latDeg, far.latDeg, 1e-9); NEAR(far2.lonDeg, far.lonDeg, 1e-9); NEAR(far2.heightM, far.heightM, 1e-3);
    CHECK((chunkOf(0.1, 0.1) == ChunkCoord{0, 0}));
    CHECK((chunkOf(-0.1, -0.1) == ChunkCoord{-1, -1}));
    CHECK((chunkOf(-155.02, -3878.26) == ChunkCoord{-1, -16}));
}

static void testSolar() {
    // 2026-06-21 12:52 local is near solar noon: elevation ~ 90 - lat + 23.44.
    const SunPosition noon = sunPosition(1782017520, kOriginLatDeg, kOriginLonDeg);
    NEAR(noon.elevationDeg, 90.0 - kOriginLatDeg + 23.44, 0.15);
    NEAR(noon.azimuthDeg, 180.0, 3.0);
    // 2026-11-10: Open-Meteo reports sunrise 07:50 and sunset 17:21 local for this point.
    const SunTimes t = sunTimes(1794297600, kOriginLatDeg, kOriginLonDeg, kUlaanbaatarUtcOffsetS);
    CHECK(t.valid);
    const LocalDateTime rise = toLocal(t.sunrise), set = toLocal(t.sunset);
    NEAR(rise.hour * 60 + rise.minute + rise.second / 60.0, 7 * 60 + 50, 3.0);
    NEAR(set.hour * 60 + set.minute + set.second / 60.0, 17 * 60 + 21, 3.0);
    CHECK(t.civilDawn < t.sunrise && t.sunrise < t.solarNoon && t.solarNoon < t.sunset && t.sunset < t.civilDusk);
    NEAR(sunPosition(t.sunrise, kOriginLatDeg, kOriginLonDeg).elevationDeg, -0.833, 0.05);
    NEAR(sunPosition(t.civilDusk, kOriginLatDeg, kOriginLonDeg).elevationDeg, -6.0, 0.05);
    // Midnight local: sun well below the horizon, to the north.
    const SunPosition mid = sunPosition(1794297600 + 8 * 3600, kOriginLatDeg, kOriginLonDeg);
    CHECK(mid.elevationDeg < -40);
}

static void testClock() {
    LocalDateTime a = toLocal(1794297600);          // 2026-11-10T08:00Z
    CHECK(a.year == 2026 && a.month == 11 && a.day == 10 && a.hour == 16 && a.minute == 0 && a.weekday == 2);
    CHECK(formatTime(a) == "16:00"); CHECK(formatDate(a) == "2026-11-10");
    LocalDateTime b = toLocal(1798734600);          // crosses into the new year locally
    CHECK(b.year == 2027 && b.month == 1 && b.day == 1 && b.hour == 0 && b.minute == 30 && b.weekday == 5);
    LocalDateTime c = toLocal(1709222399);          // leap day
    CHECK(c.year == 2024 && c.month == 2 && c.day == 29 && c.hour == 23 && c.second == 59 && c.weekday == 4);

    LiveClock clock(kOriginLatDeg, kOriginLonDeg);
    const ClockState day = clock.evaluate(1794297600);              // 16:00, before 17:21 sunset
    CHECK(day.mode == WorldMode::Live && day.phase == DayPhase::Day && !day.buildingLightsOn && day.daylight > 0.9);
    const ClockState night = clock.evaluate(1794297600 + 8 * 3600); // 00:00
    CHECK(night.phase == DayPhase::Night && night.streetLightsOn && night.buildingLightsOn && night.daylight == 0.0);
    const ClockState dusk = clock.evaluate(day.sunTimes.sunset + 10 * 60);
    CHECK(dusk.phase == DayPhase::Dusk && dusk.streetLightsOn);
    const ClockState dawn = clock.evaluate(day.sunTimes.sunrise - 10 * 60);
    CHECK(dawn.phase == DayPhase::Dawn);
    // LIVE mode ignores free-play settings; FREE PLAY ignores real time.
    clock.setFreePlayTime(1782017520, 60.0);
    CHECK(clock.evaluate(1794297600).local.hour == 16);
    clock.setMode(WorldMode::FreePlay);
    CHECK(clock.evaluate(1794297600).local.month == 6);
    clock.tickFreePlay(60.0);                                       // 60 real s at 60x = 1 h
    const ClockState fp = clock.evaluate(1794297600);
    CHECK(fp.local.hour == 13 && fp.local.minute == 52);
}

static WeatherSnapshot snap(double tempC, double rain, double snow, double depth, double vis = 20000) {
    WeatherSnapshot s; s.valid = true; s.temperatureC = tempC; s.feelsLikeC = tempC - 3; s.rainMmH = rain;
    s.snowfallCmH = snow; s.snowDepthM = depth; s.visibilityM = vis; s.humidityPct = 60; s.fetchedUnixUtc = 1000;
    return s;
}

static void testWeather() {
    CHECK(conditionFromWmoCode(0) == WeatherCondition::Clear);
    CHECK(conditionFromWmoCode(3) == WeatherCondition::Overcast);
    CHECK(conditionFromWmoCode(48) == WeatherCondition::Fog);
    CHECK(conditionFromWmoCode(63) == WeatherCondition::Rain);
    CHECK(conditionFromWmoCode(67) == WeatherCondition::FreezingRain);
    CHECK(conditionFromWmoCode(73) == WeatherCondition::Snow);
    CHECK(conditionFromWmoCode(86) == WeatherCondition::Snow);
    CHECK(conditionFromWmoCode(95) == WeatherCondition::Thunderstorm);
    CHECK(conditionFromWmoCode(1234) == WeatherCondition::Unknown);

    WeatherSnapshot none;
    CHECK(freshness(none, 5000) == DataFreshness::Unavailable);
    WeatherSnapshot s = snap(6.4, 0, 0, 0);
    CHECK(freshness(s, 1000 + 300) == DataFreshness::Live);
    CHECK(freshness(s, 1000 + 3600) == DataFreshness::Stale);

    WeatherSimulation sim;
    sim.reset(snap(6.4, 0, 0, 0));                 // mild clear day
    CHECK(sim.params().tireFriction == 1.0 && sim.params().snowCover == 0 && !sim.params().wipersNeeded);
    CHECK(!sim.params().breathVisible);
    sim.reset(snap(-22, 0, 1.5, 0.12));            // Ulaanbaatar winter snowfall
    CHECK(sim.params().snowCover == 1.0 && sim.params().snowfallIntensity == 0.5);
    CHECK(sim.params().tireFriction <= 0.4 && sim.params().tireFriction >= 0.2);
    CHECK(sim.params().breathVisible && sim.params().frost && sim.params().wipersNeeded && sim.params().winterClothing);
    CHECK(sim.params().roadWetness == 0.0);        // frozen, not wet
    sim.reset(snap(15, 6, 0, 0));                  // summer rain
    CHECK(sim.params().roadWetness == 1.0 && sim.params().puddles > 0.5 && sim.params().snowCover == 0);
    NEAR(sim.params().tireFriction, 0.7, 1e-9);
    sim.reset(snap(-5, 0, 0, 0, 150));             // ice fog
    CHECK(sim.params().fogDensity == 1.0);

    // Transitions are gradual: snow does not appear in one frame, and roads dry slowly.
    sim.reset(snap(-10, 0, 0, 0));
    sim.update(snap(-10, 0, 3, 0.10), 1.0);
    CHECK(sim.params().snowCover > 0 && sim.params().snowCover < 0.01);
    for (int i = 0; i < 700; ++i) sim.update(snap(-10, 0, 3, 0.10), 1.0);
    CHECK(sim.params().snowCover == 1.0);
    sim.reset(snap(15, 6, 0, 0));
    sim.update(snap(15, 0, 0, 0), 60.0);
    CHECK(sim.params().roadWetness > 0.9);
    // Missing data must not change the world.
    const double before = sim.params().roadWetness;
    sim.update(none, 600.0);
    CHECK(sim.params().roadWetness == before);
}

static void testStreaming() {
    StreamingConfig cfg; cfg.maxLoadsPerUpdate = 1000; cfg.maxResidentChunks = 100000;
    ChunkStreamer s(cfg);
    StreamingDelta d = s.update(10, 10, 0, 0);
    CHECK(d.load.size() == 17u * 17u && d.unload.empty());
    CHECK((d.load.front().coord == ChunkCoord{0, 0}) && d.load.front().lod == ChunkLod::Lod0);
    CHECK(s.resident().at({1, 1}) == ChunkLod::Lod0 && s.resident().at({2, 0}) == ChunkLod::Lod1);
    CHECK(s.resident().at({4, -4}) == ChunkLod::Lod2 && s.resident().at({8, 0}) == ChunkLod::Lod3);
    CHECK(s.update(20, 20, 0, 0).load.empty());                  // no churn while standing still

    // Driving east at 20 m/s: chunks ahead are preloaded at high detail before arrival.
    d = s.update(200, 10, 20, 0);
    bool promoted = false;
    for (const auto& c : d.changeLod) if (c.coord == ChunkCoord{2, 0} && c.lod == ChunkLod::Lod0) promoted = true;
    CHECK(promoted);
    // Hysteresis: one chunk of travel does not unload the trailing ring.
    d = s.update(300, 10, 0, 0);
    CHECK(d.unload.empty());
    d = s.update(300 + 3 * 256, 10, 0, 0);
    CHECK(!d.unload.empty());
    for (const auto& kv : s.resident()) CHECK(std::abs(kv.first.x - 4) <= 9 && std::abs(kv.first.y) <= 9);

    // Throttling, bounds and the memory cap.
    StreamingConfig low = settingsFor(QualityPreset::Low).streaming;
    ChunkStreamer t(low);
    t.setWorldBounds({-10, -19}, {9, 6});
    size_t frames = 0;
    while (true) { d = t.update(0, 0, 0, 0); if (d.load.empty()) break; CHECK(d.load.size() <= 1u); ++frames; }
    CHECK(frames == t.resident().size());
    CHECK(t.resident().size() <= static_cast<size_t>(low.maxResidentChunks));
    for (const auto& kv : t.resident()) CHECK(kv.first.y <= 6 && kv.first.x >= -10);
    // A long drive across the slice never exceeds the cap.
    size_t peak = 0;
    for (double n = 0; n > -4000; n -= 15.0 / 30.0 * 30) { t.update(-150, n, 0, -15); peak = std::max(peak, t.resident().size()); }
    CHECK(peak <= static_cast<size_t>(low.maxResidentChunks));

    CHECK(simTierForDistance(10, 40, 120, 400) == SimTier::Full);
    CHECK(simTierForDistance(100, 40, 120, 400) == SimTier::Reduced);
    CHECK(simTierForDistance(300, 40, 120, 400) == SimTier::Statistical);
    CHECK(simTierForDistance(900, 40, 120, 400) == SimTier::Culled);
}

static void testQuality() {
    CHECK(recommendPreset({3000, 8, true, 1}) == QualityPreset::Low);
    CHECK(recommendPreset({6000, 8, true, 1}) == QualityPreset::Medium);
    CHECK(recommendPreset({8000, 8, true, 2}) == QualityPreset::High);
    CHECK(recommendPreset({8000, 8, false, 2}) == QualityPreset::Low);
    const QualitySettings lo = settingsFor(QualityPreset::Low), mid = settingsFor(QualityPreset::Medium), hi = settingsFor(QualityPreset::High);
    CHECK(lo.drawDistanceM < mid.drawDistanceM && mid.drawDistanceM < hi.drawDistanceM);
    CHECK(lo.maxFullNpcs < mid.maxFullNpcs && mid.maxFullNpcs < hi.maxFullNpcs);
    CHECK(lo.targetFps == 30 && hi.targetFps == 60);

    QualityGovernor g(QualityPreset::High);
    PerfSample bad; bad.fps = 40;
    g.update(bad); g.update(bad);
    CHECK(g.resolutionScale() < 1.0 && g.active().preset == QualityPreset::High);   // resolution first
    for (int i = 0; i < 40; ++i) g.update(bad);
    CHECK(g.active().preset == QualityPreset::Medium);                              // then preset
    for (int i = 0; i < 60; ++i) g.update(bad);                                     // 40 fps is fine on Medium...
    CHECK(g.active().preset == QualityPreset::Medium);                              // ...but no bounce back to High
    PerfSample hot; hot.fps = 60; hot.thermal = ThermalState::Critical;
    g.update(hot);
    CHECK(g.active().preset == QualityPreset::Low);
    PerfSample warm; warm.fps = 60; warm.thermal = ThermalState::Fair;
    for (int i = 0; i < 100; ++i) g.update(warm);
    CHECK(g.active().preset == QualityPreset::Low);                                 // never raise while warm
    PerfSample good; good.fps = 60;
    for (int i = 0; i < 200; ++i) g.update(good);
    CHECK(g.active().preset == QualityPreset::High);                                // recovers to the user's choice
    QualityGovernor m(QualityPreset::Medium);
    for (int i = 0; i < 200; ++i) m.update(good);
    CHECK(m.active().preset == QualityPreset::Medium);                              // never above it
    PerfSample mem; mem.fps = 30; mem.memoryUsedFraction = 0.95;
    m.update(mem);
    CHECK(m.active().preset == QualityPreset::Low);
}

static void testRoadGraph() {
    std::ifstream f(std::string(UB6_DATA_DIR) + "/nav/roadgraph.txt");
    if (!f) { std::printf("  SKIP real road graph not built (run the pipeline)\n"); return; }
    RoadGraph g;
    CHECK(g.load(f));
    CHECK(g.nodeCount() > 5000 && g.edgeCount() > 5000);
    // Sukhbaatar Square (origin) to Zaisan Square, as located in the source data.
    const double ze = -135.73, zn = -3574.0;
    const int32_t a = g.nearestNode(0, 0, TravelMode::Car), b = g.nearestNode(ze, zn, TravelMode::Car);
    CHECK(a >= 0 && b >= 0 && a != b);
    const Route car = g.route(a, b, TravelMode::Car);
    CHECK(car.found);
    const double crow = std::hypot(g.node(a).east - g.node(b).east, g.node(a).north - g.node(b).north);
    CHECK(car.lengthM >= crow && car.lengthM < crow * 2.2);
    CHECK(car.durationS > 200 && car.durationS < 1500);
    // The route is continuous real geometry and obeys one-way and drivable rules.
    double px = car.polyline[0], py = car.polyline[1], maxGap = 0, len = 0;
    for (size_t i = 2; i + 1 < car.polyline.size(); i += 2) {
        const double d = std::hypot(car.polyline[i] - px, car.polyline[i + 1] - py);
        maxGap = std::max(maxGap, d); len += d; px = car.polyline[i]; py = car.polyline[i + 1];
    }
    CHECK(maxGap < 400.0); NEAR(len, car.lengthM, car.lengthM * 0.01);
    int32_t at = a;
    for (int32_t ei : car.edges) {
        const RoadEdge& e = g.edge(ei);
        CHECK(e.drivable);
        const bool fwd = e.a == at;
        CHECK(fwd || e.b == at);
        if (e.oneway == 1) CHECK(fwd);
        if (e.oneway == -1) CHECK(!fwd);
        at = fwd ? e.b : e.a;
    }
    CHECK(at == b);
    const Route back = g.route(b, a, TravelMode::Car);
    CHECK(back.found);
    const Route foot = g.route(g.nearestNode(0, 0, TravelMode::Foot), g.nearestNode(ze, zn, TravelMode::Foot), TravelMode::Foot);
    CHECK(foot.found && foot.lengthM <= car.lengthM * 1.05 && foot.durationS > car.durationS);
    const Route horse = g.route(g.nearestNode(0, 0, TravelMode::Horse), g.nearestNode(ze, zn, TravelMode::Horse), TravelMode::Horse);
    CHECK(horse.found);
    for (int32_t ei : horse.edges) CHECK(g.edge(ei).roadClass != "steps");
    // Zaisan Square's nearest footway node can only be left by stairs in the real data;
    // the horse GPS must snap to the rideable network instead.
    CHECK(g.nearestNode(ze, zn, TravelMode::Horse) != g.nearestNode(ze, zn, TravelMode::Foot));
    std::printf("  real route Sukhbaatar Sq -> Zaisan: car %.0f m / %.0f s, foot %.0f m, horse %.0f m (straight line %.0f m)\n",
                car.lengthM, car.durationS, foot.lengthM, horse.lengthM, crow);
}

static void testGameplay() {
    HorseModel h;
    h.requestGait(HorseGait::Walk);
    for (int i = 0; i < 100; ++i) h.update(0.05, 0);
    NEAR(h.speedMs(), 1.8, 1e-9); CHECK(h.stamina() == 1.0);
    h.requestGait(HorseGait::Gallop);
    for (int i = 0; i < 200; ++i) h.update(0.05, 0);            // 10 s
    NEAR(h.speedMs(), 11.0, 1e-9); CHECK(h.gait() == HorseGait::Gallop);
    NEAR(h.stamina(), 1.0 - 10.0 / 45.0, 1e-6);
    for (int i = 0; i < 1000; ++i) h.update(0.05, 0);           // run it out
    CHECK(h.gait() == HorseGait::Trot && h.stamina() == 0.0);
    NEAR(h.speedMs(), 4.0, 1e-9);
    h.requestGait(HorseGait::Halt);
    for (int i = 0; i < 100; ++i) h.update(0.05, 0);            // 5 s rest
    CHECK(h.speedMs() == 0.0 && h.stamina() > 0.15);
    h.feed(1.0); CHECK(h.stamina() == 1.0);
    h.requestGait(HorseGait::Trot);
    for (int i = 0; i < 100; ++i) h.update(0.05, 0, 0.2);       // icy ground slows the horse
    NEAR(h.speedMs(), 4.0 * 0.6, 1e-9);
    NEAR(h.update(0.1, 1.0), 60 * 0.1, 1e-9);
    NEAR(h.update(0.1, -5.0), -60 * 0.1, 1e-9);                 // steering clamped

    FuelTank tank;
    CHECK(tank.consume(100000, 0.5, 0));                        // 100 km at half throttle
    NEAR(tank.levelL, 45.0 - 4.5, 1e-9);
    tank.levelL = 0.001;
    CHECK(!tank.consume(5000, 1.0, 10)); CHECK(tank.fraction() == 0.0);

    CHECK(shapeVirtualStick(3, 3, 100).magnitude == 0.0);       // dead zone
    StickOutput s = shapeVirtualStick(300, 0, 100);
    NEAR(s.x, 1.0, 1e-9); NEAR(s.y, 0.0, 1e-9);
    s = shapeVirtualStick(0, -56, 100);
    NEAR(s.magnitude, std::pow(0.5, 1.5), 1e-9); NEAR(s.y, -s.magnitude, 1e-9);
    // iPhone landscape with a Dynamic Island on the left and a home indicator at the bottom.
    const SafeInsets in{59, 0, 59, 21};
    const ScreenRect stick = placeInSafeArea(2556, 1179, in, 0.0, 1.0, 0.36);
    CHECK(stick.x >= 59 && stick.y + stick.h <= 1179 - 21 + 1e-9);
    const ScreenRect gas = placeInSafeArea(2556, 1179, in, 1.0, 1.0, 0.2);
    CHECK(gas.x + gas.w <= 2556 - 59 + 1e-9 && gas.x > stick.x + stick.w);
    // Same layout on a 4:3 tablet stays on screen.
    const ScreenRect t = placeInSafeArea(2048, 1536, {}, 1.0, 1.0, 0.2);
    CHECK(t.x + t.w <= 2048 && t.y + t.h <= 1536);
}

static double meshArea(const MeshData& m, bool roofOnly, double z) {
    double a = 0;
    for (size_t t = 0; t < m.indices.size(); t += 3) {
        const float* p0 = &m.positions[m.indices[t] * 3]; const float* p1 = &m.positions[m.indices[t + 1] * 3]; const float* p2 = &m.positions[m.indices[t + 2] * 3];
        if (roofOnly && !(std::fabs(p0[2] - z) < 1e-4 && std::fabs(p1[2] - z) < 1e-4 && std::fabs(p2[2] - z) < 1e-4)) continue;
        a += 0.5 * ((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]));
    }
    return a;
}

// Every triangle must face outwards: its geometric normal agrees with the stored vertex normal.
static bool windingMatchesNormals(const MeshData& m) {
    for (size_t t = 0; t < m.indices.size(); t += 3) {
        const uint32_t i0 = m.indices[t], i1 = m.indices[t + 1], i2 = m.indices[t + 2];
        const float* a = &m.positions[i0 * 3]; const float* b = &m.positions[i1 * 3]; const float* c = &m.positions[i2 * 3];
        const double ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const float* n = &m.normals[i0 * 3];
        if (nx * n[0] + ny * n[1] + nz * n[2] <= 0) return false;
    }
    return true;
}

static void testMesh() {
    // L-shaped (concave) footprint, area 3, given clockwise then counter-clockwise.
    const std::vector<double> ccw = {0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2};
    std::vector<double> cw;
    for (int i = 5; i >= 0; --i) { cw.push_back(ccw[i * 2]); cw.push_back(ccw[i * 2 + 1]); }
    NEAR(ringArea(ccw), 3.0, 1e-12); NEAR(ringArea(cw), -3.0, 1e-12);
    for (const auto& ring : {ccw, cw}) {
        std::vector<uint32_t> tri;
        CHECK(triangulate(ring, tri)); CHECK(tri.size() == 4u * 3u);
        MeshData m;
        CHECK(appendBuilding(m, ring, 10.0, 6.0));
        NEAR(meshArea(m, true, 16.0), 3.0, 1e-5);                 // roof covers the footprint exactly once
        CHECK(windingMatchesNormals(m));
        CHECK(m.triangleCount() == 4u + 6u * 2u);
        float zmin = 1e9f, zmax = -1e9f;
        for (size_t i = 2; i < m.positions.size(); i += 3) { zmin = std::min(zmin, m.positions[i]); zmax = std::max(zmax, m.positions[i]); }
        CHECK(zmin == 10.0f && zmax == 16.0f);
    }
    // Closed ring with repeated first point and a collinear vertex still works.
    std::vector<uint32_t> tri;
    const std::vector<double> closed = {0, 0, 1, 0, 2, 0, 2, 2, 0, 2, 0, 0};
    CHECK(triangulate(closed, tri)); CHECK(tri.size() == 6u || tri.size() == 9u);
    double a = 0;
    for (size_t k = 0; k < tri.size(); k += 3)
        a += 0.5 * ((closed[tri[k + 1] * 2] - closed[tri[k] * 2]) * (closed[tri[k + 2] * 2 + 1] - closed[tri[k] * 2 + 1]) -
                    (closed[tri[k + 1] * 2 + 1] - closed[tri[k] * 2 + 1]) * (closed[tri[k + 2] * 2] - closed[tri[k] * 2]));
    NEAR(a, 4.0, 1e-12);
    tri.clear();
    CHECK(!triangulate({0, 0, 1, 1, 2, 2}, tri)); CHECK(tri.empty());   // degenerate
    MeshData bad; CHECK(!appendBuilding(bad, {0, 0, 1, 1}, 0, 5)); CHECK(bad.indices.empty());

    // Straight 10 m road, 7 m wide: area 70, lies just above the ground, faces up.
    MeshData r;
    appendRoad(r, {0, 0, 5, 10, 0, 5}, 7.0);
    NEAR(meshArea(r, false, 0), 70.0, 1e-4); CHECK(windingMatchesNormals(r));
    NEAR(r.positions[2], 5.05, 1e-5);
    // Right-angle corner keeps full width on both legs (mitre).
    MeshData c;
    appendRoad(c, {0, 0, 0, 10, 0, 0, 10, 10, 0}, 4.0);
    CHECK(windingMatchesNormals(c)); NEAR(meshArea(c, false, 0), 80.0, 1e-3);

    // Terrain: plane z = 2x + 100 on a 5x5 grid of 16 m cells.
    std::vector<float> h(25);
    for (int j = 0; j < 5; ++j) for (int i = 0; i < 5; ++i) h[j * 5 + i] = static_cast<float>(100 + 2.0 * i * 16);
    MeshData t;
    appendTerrain(t, h, 5, 256, -512, 16);
    CHECK(t.vertexCount() == 25u && t.triangleCount() == 32u && windingMatchesNormals(t));
    NEAR(meshArea(t, false, 0), 64.0 * 64.0, 1e-2);
    NEAR(t.normals[0], -2.0 / std::sqrt(5.0), 1e-5);
    MeshData t2;
    appendTerrain(t2, h, 5, 256, -512, 16, 2);                    // lower LOD: same extent, fewer triangles
    CHECK(t2.vertexCount() == 9u && t2.triangleCount() == 8u);
    NEAR(meshArea(t2, false, 0), 64.0 * 64.0, 1e-2);
    NEAR(sampleTerrain(h, 5, 256, -512, 16, 256 + 24, -500), 100 + 2 * 24, 1e-4);
    NEAR(sampleTerrain(h, 5, 256, -512, 16, 9999, 9999), 100 + 2 * 64, 1e-4);   // clamped at the edge
}

static void testVehicle() {
    const double dt = 1.0 / 60.0;
    VehicleInput gas; gas.throttle = 1;
    // 0-100 km/h in a plausible time for this class of car (real ones take about 10-11 s).
    VehicleModel car;
    double t = 0;
    while (car.state().speedMs < 100 / 3.6 && t < 60) { car.update(dt, gas); t += dt; }
    CHECK(t > 8.0 && t < 13.0);
    // Top speed is drag-limited, in the real-world range.
    for (int i = 0; i < 60 * 120; ++i) car.update(dt, gas);
    CHECK(car.state().speedMs * 3.6 > 160 && car.state().speedMs * 3.6 < 200);
    NEAR(car.state().x, 0, 1e-6); CHECK(car.state().y > 1000);          // drove straight north

    // Braking distance from 100 km/h: ~40-45 m dry, much longer on packed snow and ice.
    auto brakeDistance = [&](double grip) {
        VehicleModel c; c.state().speedMs = 100 / 3.6;
        VehicleInput b; b.brake = 1;
        for (int i = 0; i < 60 * 60 && c.state().speedMs > 0; ++i) c.update(dt, b, grip);
        CHECK(c.state().speedMs == 0.0);
        return c.state().y;
    };
    const double dry = brakeDistance(1.0), snow = brakeDistance(0.4), ice = brakeDistance(0.2);
    CHECK(dry > 36 && dry < 48); CHECK(snow > dry * 2.0); CHECK(ice > snow * 1.4);   // air drag and engine braking still help on ice

    // Low-speed full lock turns on the geometric circle: R = wheelbase / tan(steer).
    VehicleModel slow; slow.state().speedMs = 2.0;
    VehicleInput turn; turn.steer = 1; turn.throttle = 0.05;
    for (int i = 0; i < 120; ++i) slow.update(dt, turn);
    const double radius = std::fabs(slow.state().speedMs / slow.state().yawRateRadS);
    const double lock = slow.state().steerAngleRad;
    NEAR(radius, 2.70 / std::tan(lock), 0.05); CHECK(radius > 3.5 && radius < 6.5);
    CHECK(slow.state().yawRateRadS > 0 && !slow.state().sliding);        // right steer = clockwise heading

    // Cornering never exceeds available grip; on ice the same input slides and turns less.
    auto corner = [&](double grip, bool& slid) {
        VehicleModel c; c.state().speedMs = 60 / 3.6;
        VehicleInput in; in.steer = 1; in.throttle = 0.3;
        double maxLat = 0; slid = false;
        for (int i = 0; i < 180; ++i) { c.update(dt, in, grip); maxLat = std::max(maxLat, std::fabs(c.state().lateralAccelMs2)); slid = slid || c.state().sliding; }
        return maxLat;
    };
    bool slidDry = false, slidIce = false;
    const double latDry = corner(1.0, slidDry), latIce = corner(0.2, slidIce);
    CHECK(latDry <= 0.95 * 9.81 + 1e-6); CHECK(latIce <= 0.2 * 0.95 * 9.81 + 1e-6);
    CHECK(slidIce && latIce < latDry * 0.5);

    // Reverse is speed-limited; no fuel means no drive; coasting slows down.
    VehicleModel rev; VehicleInput back; back.throttle = 1; back.reverse = true;
    for (int i = 0; i < 60 * 20; ++i) rev.update(dt, back);
    CHECK(rev.state().speedMs < -7.0 && rev.state().speedMs >= -8.0 - 0.2); CHECK(rev.state().y < 0);
    VehicleModel dryTank;
    for (int i = 0; i < 600; ++i) dryTank.update(dt, gas, 1.0, false);
    CHECK(dryTank.state().speedMs == 0.0);
    VehicleModel coast; coast.state().speedMs = 20;
    for (int i = 0; i < 600; ++i) coast.update(dt, VehicleInput{});
    CHECK(coast.state().speedMs < 20 && coast.state().speedMs >= 0);
    VehicleModel hit; hit.state().speedMs = 10; hit.onImpact();
    NEAR(hit.state().speedMs, -2.0, 1e-12);
}

static void testTouch() {
    auto centre = [](const ScreenRect& r, double& x, double& y) { x = r.x + r.w / 2; y = r.y + r.h / 2; };
    // Layout sanity on several real screen shapes: every control inside the safe area, and
    // no two controls of the same mode overlap.
    struct Screen { double w, h; SafeInsets in; };
    const Screen screens[] = {{2556, 1179, {59, 0, 59, 21}},     // iPhone, Dynamic Island + home bar
                              {2400, 1080, {80, 0, 0, 0}},        // Android 20:9 with punch-hole cut-out
                              {1280, 720, {}},                    // entry-level 16:9
                              {2048, 1536, {}},                   // 4:3 tablet
                              {2208, 1768, {}}};                  // unfolded foldable
    for (const Screen& sc : screens) {
        TouchControls tc; tc.setScreen(sc.w, sc.h, sc.in);
        for (ControlMode m : {ControlMode::OnFoot, ControlMode::Driving, ControlMode::Riding}) {
            for (int steerButtons = 0; steerButtons < 2; ++steerButtons) {
                TouchLayout l = TouchLayout::defaults(); l.steerWithButtons = steerButtons == 1; tc.setLayout(l);
                std::vector<ScreenRect> rects;
                if (!(m == ControlMode::Driving && l.steerWithButtons)) rects.push_back(tc.stickRect());
                for (int b = 0; b < kTouchButtonCount; ++b)
                    if (TouchControls::buttonInMode(static_cast<TouchButton>(b), m, l)) rects.push_back(tc.buttonRect(static_cast<TouchButton>(b)));
                CHECK(rects.size() >= 4);
                for (size_t i = 0; i < rects.size(); ++i) {
                    const ScreenRect& r = rects[i];
                    CHECK(r.x >= sc.in.left - 1e-9 && r.y >= sc.in.top - 1e-9);
                    CHECK(r.x + r.w <= sc.w - sc.in.right + 1e-9 && r.y + r.h <= sc.h - sc.in.bottom + 1e-9);
                    CHECK(r.w >= sc.h * 0.09 - 1e-9);                         // fingertip-sized or larger
                    for (size_t j = i + 1; j < rects.size(); ++j) {
                        const ScreenRect& q = rects[j];
                        const bool overlap = r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h;
                        CHECK(!overlap);
                    }
                }
            }
        }
    }

    TouchControls tc; tc.setScreen(2400, 1080, {});
    double jx, jy; centre(tc.buttonRect(TouchButton::Jump), jx, jy);
    // Walking: left thumb pushes forward, right thumb looks around, a third finger jumps.
    TouchOutput o = tc.update({{1, 300, 800, true}});
    CHECK(o.moveX == 0 && o.moveY == 0);                                       // touch down = stick centre
    o = tc.update({{1, 300, 800 - 150, true}});
    CHECK(o.moveY > 0.5 && std::fabs(o.moveX) < 1e-9);
    o = tc.update({{1, 300, 650, true}, {2, 1500, 500, true}});
    CHECK(o.lookYawDeg == 0 && o.moveY > 0.5);
    o = tc.update({{1, 300, 650, true}, {2, 1600, 480, true}});
    NEAR(o.lookYawDeg, 100 * 0.18, 1e-9); NEAR(o.lookPitchDeg, 20 * 0.18, 1e-9);
    o = tc.update({{1, 300, 650, true}, {2, 1600, 480, true}, {3, jx, jy, true}});
    CHECK(o.wasPressed(TouchButton::Jump) && o.isHeld(TouchButton::Jump) && o.moveY > 0.5 && o.lookYawDeg == 0);
    o = tc.update({{1, 300, 650, true}, {2, 1600, 480, true}, {3, jx, jy, true}});
    CHECK(!o.wasPressed(TouchButton::Jump) && o.isHeld(TouchButton::Jump));    // edge fires once
    o = tc.update({{1, 300, 650, true}, {2, 1600, 480, true}});
    CHECK(!o.isHeld(TouchButton::Jump));
    // Dragging far past the pad keeps full deflection and the base follows the thumb.
    o = tc.update({{1, 900, 650, true}});
    NEAR(std::hypot(o.moveX, o.moveY), 1.0, 1e-9); CHECK(o.moveX > 0.9);
    double sbx, sby, kx, ky, rad; tc.stickVisual(sbx, sby, kx, ky, rad);
    NEAR(std::hypot(kx, ky), rad, 1e-6); CHECK(sbx > 600);                     // base followed the thumb
    o = tc.update({{1, 900 - 2 * rad, 650, true}});
    CHECK(o.moveX < -0.5);                                                     // one pad-width back reverses
    o = tc.update({});
    CHECK(o.moveX == 0 && o.moveY == 0);
    // Driving buttons are not active on foot, and the look finger never triggers them later.
    double gx, gy; centre(tc.buttonRect(TouchButton::Gas), gx, gy);
    o = tc.update({{5, gx, gy, true}});
    CHECK(!o.isHeld(TouchButton::Gas));
    tc.update({});

    tc.setMode(ControlMode::Driving);
    double bx, by; centre(tc.buttonRect(TouchButton::Brake), bx, by);
    o = tc.update({{1, 300, 800, true}, {2, gx, gy, true}});
    o = tc.update({{1, 300 + 120, 800, true}, {2, gx, gy, true}});
    CHECK(o.isHeld(TouchButton::Gas) && o.steer > 0.4 && o.moveX == 0);
    o = tc.update({{1, 420, 800, true}, {2, gx, gy, true}, {3, bx, by, true}});
    CHECK(o.isHeld(TouchButton::Gas) && o.isHeld(TouchButton::Brake) && o.wasPressed(TouchButton::Brake));
    o = tc.update({{1, 420, 800, true}, {2, gx - 900, gy - 600, true}});
    CHECK(!o.isHeld(TouchButton::Gas));                                        // slid off: accelerator released
    tc.update({});
    TouchLayout wheel = TouchLayout::defaults(); wheel.steerWithButtons = true; tc.setLayout(wheel);
    double lx, ly; centre(tc.buttonRect(TouchButton::SteerLeft), lx, ly);
    o = tc.update({{1, lx, ly, true}});
    CHECK(o.steer == -1.0);
    tc.update({});

    tc.setLayout(TouchLayout::defaults());
    tc.setMode(ControlMode::Riding);
    double ux, uy; centre(tc.buttonRect(TouchButton::GaitUp), ux, uy);
    o = tc.update({{1, ux, uy, true}, {2, 300, 800, true}});
    CHECK(o.wasPressed(TouchButton::GaitUp) && !o.isHeld(TouchButton::Gas));
    // A finger held through a mode change does nothing until lifted and pressed again.
    tc.setMode(ControlMode::OnFoot);
    o = tc.update({{1, ux, uy, true}});
    CHECK(!o.isHeld(TouchButton::Jump) && !o.wasPressed(TouchButton::Jump) && !o.isHeld(TouchButton::GaitUp));

    // Customisation is clamped so a control can never become unusably small or leave the screen.
    TouchLayout custom = TouchLayout::defaults();
    custom.buttons[static_cast<int>(TouchButton::Jump)] = {true, 7.0, -3.0, 0.001, true};
    custom.lookSensitivity = 50;
    tc.setLayout(custom);
    const ScreenRect r = tc.buttonRect(TouchButton::Jump);
    CHECK(r.w >= 1080 * 0.09 - 1e-9 && r.x + r.w <= 2400 + 1e-9 && r.y >= 0);
    CHECK(tc.layout().lookSensitivity <= 0.6);
}

int main() {
    const std::vector<std::pair<const char*, std::function<void()>>> tests = {
        {"geo", testGeo}, {"solar", testSolar}, {"clock", testClock}, {"weather", testWeather},
        {"streaming", testStreaming}, {"quality", testQuality}, {"roadgraph", testRoadGraph}, {"gameplay", testGameplay}, {"mesh", testMesh}, {"vehicle", testVehicle}, {"touch", testTouch}};
    for (const auto& t : tests) {
        const int before = g_failed;
        std::printf("[%s]\n", t.first);
        t.second();
        std::printf("  %s\n", g_failed == before ? "ok" : "FAILED");
    }
    std::printf("%d checks, %d failed\n", g_checks, g_failed);
    return g_failed ? 1 : 0;
}
