// Mobile graphics presets and the runtime governor that protects frame rate and heat.
#pragma once
#include "ub6/Streaming.h"

namespace ub6 {

enum class QualityPreset { Low = 0, Medium = 1, High = 2 };
enum class ThermalState { Nominal, Fair, Serious, Critical };   // mirrors iOS/Android thermal APIs

struct QualitySettings {
    QualityPreset preset = QualityPreset::Medium;
    int targetFps = 30;
    double resolutionScaleMin = 0.6, resolutionScaleMax = 1.0;
    int maxTextureSize = 1024;
    int shadowQuality = 1;            // 0 off/blob, 1 single cascade, 2 two cascades
    double drawDistanceM = 1200;
    int maxFullNpcs = 12, maxTrafficVehicles = 10;
    double npcFullM = 40, npcReducedM = 120, npcStatisticalM = 400;
    double particleScale = 0.6;
    StreamingConfig streaming;
};

QualitySettings settingsFor(QualityPreset p);

struct DeviceInfo { int ramMb = 0; int cpuCores = 0; bool supportsVulkanOrMetal = true; int gpuTier = 1; }; // gpuTier 0..2
QualityPreset recommendPreset(const DeviceInfo& d);

struct PerfSample { double fps = 0; double gpuFrameMs = 0; double memoryUsedFraction = 0; ThermalState thermal = ThermalState::Nominal; };

// Adjusts resolution scale first, then steps the preset down. Never raises quality while hot.
class QualityGovernor {
public:
    explicit QualityGovernor(QualityPreset userPreset);
    void setUserPreset(QualityPreset p);
    // Call about once per second with averaged samples.
    void update(const PerfSample& s);
    const QualitySettings& active() const { return active_; }
    double resolutionScale() const { return resScale_; }
    QualityPreset userPreset() const { return user_; }
private:
    void apply(QualityPreset p);
    QualityPreset user_;
    QualitySettings active_;
    double resScale_ = 1.0;
    int lowFpsStreak_ = 0, goodFpsStreak_ = 0;
    int upgradeCooldown_ = 0, nextCooldown_ = 120;   // updates; doubles after each failed upgrade
};

} // namespace ub6
