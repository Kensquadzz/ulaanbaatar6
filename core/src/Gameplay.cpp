#include "ub6/Gameplay.h"
#include <algorithm>
#include <cmath>

namespace ub6 {

void HorseModel::feed(double amount) { stamina_ = std::clamp(stamina_ + amount, 0.0, 1.0); }

double HorseModel::update(double dt, double steer, double surfaceGrip) {
    HorseGait want = requested_;
    if (want == HorseGait::Gallop) {
        // Entering a gallop needs a reserve; an exhausted horse drops back to a trot.
        if (gait_ != HorseGait::Gallop && stamina_ < t_.minStaminaToGallop) want = HorseGait::Trot;
        if (stamina_ <= 0.0) want = HorseGait::Trot;
    }
    gait_ = want;
    double target = 0;
    switch (gait_) {
        case HorseGait::Walk: target = t_.walkMs; break;
        case HorseGait::Trot: target = t_.trotMs; break;
        case HorseGait::Gallop: target = t_.gallopMs; break;
        default: target = 0; break;
    }
    // Horses slow down on ice and deep snow rather than sliding like a car.
    target *= std::clamp(0.5 + 0.5 * surfaceGrip, 0.5, 1.0);
    if (speed_ < target) speed_ = std::min(target, speed_ + t_.accelMs2 * dt);
    else speed_ = std::max(target, speed_ - t_.decelMs2 * dt);
    if (gait_ == HorseGait::Gallop) stamina_ -= t_.gallopDrainPerS * dt;
    else if (gait_ == HorseGait::Trot) stamina_ -= t_.trotDrainPerS * dt;
    else stamina_ += t_.recoverPerS * dt;
    stamina_ = std::clamp(stamina_, 0.0, 1.0);
    const double rate = t_.turnRateDegS[static_cast<int>(gait_)];
    return speed_ > 0.05 || gait_ == HorseGait::Halt ? std::clamp(steer, -1.0, 1.0) * rate * dt : 0.0;
}

bool FuelTank::consume(double distanceM, double throttle01, double dt) {
    if (levelL <= 0) { levelL = 0; return false; }
    const double load = 0.7 + 0.6 * std::clamp(throttle01, 0.0, 1.0);     // hard throttle burns more
    const double burn = distanceM / 100000.0 * litresPer100Km * load + 0.6 / 3600.0 * dt;   // + idle 0.6 L/h
    levelL = std::max(0.0, levelL - burn);
    return levelL > 0;
}

StickOutput shapeVirtualStick(double dx, double dy, double radius, double deadZone, double curve) {
    StickOutput o;
    if (radius <= 0) return o;
    double m = std::hypot(dx, dy) / radius;
    if (m <= deadZone) return o;
    const double ux = dx / (m * radius), uy = dy / (m * radius);
    m = std::min(m, 1.0);
    m = std::pow((m - deadZone) / (1.0 - deadZone), curve);
    o.x = ux * m; o.y = uy * m; o.magnitude = m;
    return o;
}

ScreenRect placeInSafeArea(double sw, double sh, const SafeInsets& in, double ax, double ay, double sizeFrac) {
    const double x0 = in.left, y0 = in.top, w = sw - in.left - in.right, h = sh - in.top - in.bottom;
    const double size = sizeFrac * h;
    ScreenRect r;
    r.w = r.h = size;
    r.x = x0 + std::clamp(ax, 0.0, 1.0) * (w - size);
    r.y = y0 + std::clamp(ay, 0.0, 1.0) * (h - size);
    return r;
}

} // namespace ub6
