#include "ub6/Quality.h"
#include <algorithm>

namespace ub6 {

QualitySettings settingsFor(QualityPreset p) {
    QualitySettings q;
    q.preset = p;
    switch (p) {
        case QualityPreset::Low:
            q.targetFps = 30; q.resolutionScaleMin = 0.5; q.resolutionScaleMax = 0.75;
            q.maxTextureSize = 512; q.shadowQuality = 0; q.drawDistanceM = 700;
            q.maxFullNpcs = 6; q.maxTrafficVehicles = 6;
            q.npcFullM = 30; q.npcReducedM = 80; q.npcStatisticalM = 250; q.particleScale = 0.3;
            q.streaming.lodRadius[0] = 1; q.streaming.lodRadius[1] = 2; q.streaming.lodRadius[2] = 3; q.streaming.lodRadius[3] = 5;
            q.streaming.maxLoadsPerUpdate = 1; q.streaming.maxResidentChunks = 140;
            break;
        case QualityPreset::Medium:
            q.targetFps = 30; q.resolutionScaleMin = 0.6; q.resolutionScaleMax = 0.9;
            q.maxTextureSize = 1024; q.shadowQuality = 1; q.drawDistanceM = 1200;
            q.maxFullNpcs = 12; q.maxTrafficVehicles = 10;
            q.npcFullM = 40; q.npcReducedM = 120; q.npcStatisticalM = 400; q.particleScale = 0.6;
            q.streaming.lodRadius[0] = 1; q.streaming.lodRadius[1] = 2; q.streaming.lodRadius[2] = 4; q.streaming.lodRadius[3] = 7;
            q.streaming.maxLoadsPerUpdate = 2; q.streaming.maxResidentChunks = 260;
            break;
        case QualityPreset::High:
            q.targetFps = 60; q.resolutionScaleMin = 0.7; q.resolutionScaleMax = 1.0;
            q.maxTextureSize = 2048; q.shadowQuality = 2; q.drawDistanceM = 2000;
            q.maxFullNpcs = 24; q.maxTrafficVehicles = 18;
            q.npcFullM = 60; q.npcReducedM = 180; q.npcStatisticalM = 600; q.particleScale = 1.0;
            q.streaming.lodRadius[0] = 2; q.streaming.lodRadius[1] = 3; q.streaming.lodRadius[2] = 5; q.streaming.lodRadius[3] = 9;
            q.streaming.maxLoadsPerUpdate = 3; q.streaming.maxResidentChunks = 400;
            break;
    }
    return q;
}

QualityPreset recommendPreset(const DeviceInfo& d) {
    if (d.ramMb < 4000 || d.cpuCores < 6 || d.gpuTier <= 0 || !d.supportsVulkanOrMetal) return QualityPreset::Low;
    if (d.ramMb >= 7500 && d.gpuTier >= 2) return QualityPreset::High;
    return QualityPreset::Medium;
}

QualityGovernor::QualityGovernor(QualityPreset userPreset) : user_(userPreset) { apply(userPreset); }

void QualityGovernor::setUserPreset(QualityPreset p) {
    user_ = p; apply(p);
    lowFpsStreak_ = goodFpsStreak_ = 0; upgradeCooldown_ = 0; nextCooldown_ = 120;
}

void QualityGovernor::apply(QualityPreset p) {
    active_ = settingsFor(p);
    resScale_ = active_.resolutionScaleMax;
}

void QualityGovernor::update(const PerfSample& s) {
    const int cur = static_cast<int>(active_.preset);
    if (upgradeCooldown_ > 0) --upgradeCooldown_;
    // Heat and memory pressure override everything: step down immediately.
    if (s.thermal == ThermalState::Critical) {
        apply(QualityPreset::Low); resScale_ = active_.resolutionScaleMin; upgradeCooldown_ = 60; return;
    }
    if ((s.thermal == ThermalState::Serious || s.memoryUsedFraction > 0.9) && cur > 0) {
        apply(static_cast<QualityPreset>(cur - 1));
        lowFpsStreak_ = goodFpsStreak_ = 0; upgradeCooldown_ = 60;
        return;
    }
    const double target = active_.targetFps;
    if (s.fps < target * 0.9) { ++lowFpsStreak_; goodFpsStreak_ = 0; }
    else if (s.fps >= target * 0.98) { ++goodFpsStreak_; lowFpsStreak_ = 0; }
    else { lowFpsStreak_ = goodFpsStreak_ = 0; }

    if (lowFpsStreak_ >= 2) {                                   // dynamic resolution first
        if (resScale_ > active_.resolutionScaleMin + 1e-9) resScale_ = std::max(active_.resolutionScaleMin, resScale_ - 0.05);
        else if (lowFpsStreak_ >= 6 && cur > 0) {
            // The device could not hold this preset: wait before trying it again, longer each time,
            // so quality does not oscillate.
            apply(static_cast<QualityPreset>(cur - 1)); lowFpsStreak_ = 0;
            upgradeCooldown_ = nextCooldown_; nextCooldown_ = std::min(nextCooldown_ * 2, 1920);
        }
    } else if (goodFpsStreak_ >= 10 && s.thermal == ThermalState::Nominal) {
        if (resScale_ < active_.resolutionScaleMax - 1e-9) { resScale_ = std::min(active_.resolutionScaleMax, resScale_ + 0.05); goodFpsStreak_ = 5; }
        else if (goodFpsStreak_ >= 30 && upgradeCooldown_ == 0 && cur < static_cast<int>(user_)) { apply(static_cast<QualityPreset>(cur + 1)); goodFpsStreak_ = 0; }
    }
}

} // namespace ub6
