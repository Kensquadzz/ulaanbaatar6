// Small engine-independent gameplay models: horse gaits, fuel, touch input shaping.
#pragma once
#include <string>

namespace ub6 {

// ---- Mongolian horse ---------------------------------------------------
enum class HorseGait { Halt, Walk, Trot, Gallop };

struct HorseTuning {
    double walkMs = 1.8, trotMs = 4.0, gallopMs = 11.0;   // Mongolian horses are small and hardy
    double accelMs2 = 3.0, decelMs2 = 5.0;
    double gallopDrainPerS = 1.0 / 45.0;                  // full stamina lasts ~45 s at gallop
    double trotDrainPerS = 0.0, recoverPerS = 1.0 / 30.0;
    double minStaminaToGallop = 0.15;
    double turnRateDegS[4] = {120, 90, 60, 35};           // by gait
};

class HorseModel {
public:
    explicit HorseModel(HorseTuning t = {}) : t_(t) {}
    void requestGait(HorseGait g) { requested_ = g; }
    void feed(double amount);                              // restores stamina 0..1
    // steer -1..1. Returns yaw change in degrees for this step.
    double update(double dt, double steer, double surfaceGrip = 1.0);
    HorseGait gait() const { return gait_; }
    double speedMs() const { return speed_; }
    double stamina() const { return stamina_; }
private:
    HorseTuning t_;
    HorseGait requested_ = HorseGait::Halt, gait_ = HorseGait::Halt;
    double speed_ = 0, stamina_ = 1.0;
};

// ---- Fuel ---------------------------------------------------------------
struct FuelTank {
    double capacityL = 45.0, levelL = 45.0;
    double litresPer100Km = 4.5;                           // hybrid city figure; tune per vehicle
    // Consumes fuel for a travelled distance; idle burn while running. Returns false when empty.
    bool consume(double distanceM, double throttle01, double dtSeconds);
    double fraction() const { return capacityL > 0 ? levelL / capacityL : 0; }
};

// ---- Touch input --------------------------------------------------------
struct StickOutput { double x = 0, y = 0, magnitude = 0; };
// Virtual joystick: radial dead zone, clamp to radius, response curve for fine control.
StickOutput shapeVirtualStick(double dxPx, double dyPx, double radiusPx, double deadZone01 = 0.12, double curve = 1.5);

struct ScreenRect { double x = 0, y = 0, w = 0, h = 0; };
struct SafeInsets { double left = 0, top = 0, right = 0, bottom = 0; };   // notch / Dynamic Island / gesture bar
// Places a control given as fractions of the safe area, so layouts adapt to any aspect ratio.
ScreenRect placeInSafeArea(double screenW, double screenH, const SafeInsets& insets,
                           double anchorX01, double anchorY01, double sizeFracOfHeight);

} // namespace ub6
