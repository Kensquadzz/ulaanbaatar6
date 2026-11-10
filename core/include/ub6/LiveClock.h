// Live Ulaanbaatar clock. LIVE mode reads real time; FREE PLAY uses a player-set time.
#pragma once
#include <cstdint>
#include <string>
#include "ub6/Solar.h"

namespace ub6 {

// Mongolia abolished daylight saving time in 2017; Asia/Ulaanbaatar is UTC+08:00 all year.
// On device the UE layer should still prefer the OS tz database and use this as fallback.
constexpr int kUlaanbaatarUtcOffsetS = 8 * 3600;

enum class DayPhase { Night, Dawn, Day, Dusk };
enum class WorldMode { Live, FreePlay };

struct LocalDateTime { int year, month, day, hour, minute, second, weekday; }; // weekday 0=Sunday

LocalDateTime toLocal(int64_t unixUtc, int utcOffsetSeconds = kUlaanbaatarUtcOffsetS);
std::string formatTime(const LocalDateTime& t);   // "16:00"
std::string formatDate(const LocalDateTime& t);   // "2026-11-10"

struct ClockState {
    WorldMode mode = WorldMode::Live;
    int64_t unixUtc = 0;            // the instant the world is rendered at
    LocalDateTime local{};
    SunPosition sun{};
    SunTimes sunTimes{};
    DayPhase phase = DayPhase::Day;
    bool streetLightsOn = false;
    bool buildingLightsOn = false;
    double daylight = 0;            // 0 night .. 1 full day, smooth through twilight
};

class LiveClock {
public:
    LiveClock(double latDeg, double lonDeg, int utcOffsetSeconds = kUlaanbaatarUtcOffsetS);
    void setMode(WorldMode m) { mode_ = m; }
    WorldMode mode() const { return mode_; }
    // FREE PLAY only: world time and speed (1 = real time, 60 = one game minute per second).
    void setFreePlayTime(int64_t unixUtc, double timeScale);
    void tickFreePlay(double realDeltaSeconds);
    // realNowUnixUtc is the trusted real time (server-synced where available).
    ClockState evaluate(int64_t realNowUnixUtc) const;
private:
    double lat_, lon_;
    int offset_;
    WorldMode mode_ = WorldMode::Live;
    double freeUnix_ = 0;
    double freeScale_ = 1;
};

} // namespace ub6
