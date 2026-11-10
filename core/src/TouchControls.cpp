#include "ub6/TouchControls.h"
#include <algorithm>
#include <cmath>

namespace ub6 {
namespace {
inline int bi(TouchButton b) { return static_cast<int>(b); }
inline bool inside(const ScreenRect& r, double x, double y, double pad) {
    return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
}
}

TouchLayout TouchLayout::defaults() {
    TouchLayout l;
    auto set = [&](TouchButton b, bool right, double dx, double dy, double size) { l.buttons[bi(b)] = {right, dx, dy, size, true}; };
    // On foot: right thumb cluster.
    set(TouchButton::Jump, true, 0.03, 0.05, 0.19);
    set(TouchButton::Sprint, true, 0.25, 0.03, 0.15);
    set(TouchButton::Interact, true, 0.03, 0.28, 0.16);
    set(TouchButton::Crouch, true, 0.23, 0.22, 0.13);
    set(TouchButton::Phone, true, 0.03, 0.49, 0.12);
    // Driving: pedals under the right thumb, secondary actions above them.
    set(TouchButton::Gas, true, 0.03, 0.05, 0.24);
    set(TouchButton::Brake, true, 0.30, 0.03, 0.20);
    set(TouchButton::Handbrake, true, 0.03, 0.33, 0.14);
    set(TouchButton::Reverse, true, 0.20, 0.33, 0.13);
    set(TouchButton::Camera, true, 0.03, 0.49, 0.12);
    set(TouchButton::ExitVehicle, true, 0.18, 0.49, 0.12);
    set(TouchButton::SteerLeft, false, 0.03, 0.05, 0.24);
    set(TouchButton::SteerRight, false, 0.30, 0.05, 0.24);
    // Riding.
    set(TouchButton::GaitUp, true, 0.03, 0.05, 0.22);
    set(TouchButton::GaitDown, true, 0.28, 0.03, 0.18);
    set(TouchButton::Dismount, true, 0.03, 0.31, 0.14);
    return l;
}

void TouchLayout::clampToSafeLimits() {
    auto fix = [](ControlPlacement& p, double minSize, double maxSize) {
        p.size = std::clamp(p.size, minSize, maxSize);
        p.dx = std::clamp(p.dx, 0.0, 1.2); p.dy = std::clamp(p.dy, 0.0, 1.0 - p.size);
    };
    for (auto& b : buttons) fix(b, 0.09, 0.32);          // never smaller than a fingertip
    fix(stick, 0.22, 0.5);
    stickZoneRight = std::clamp(stickZoneRight, 0.25, 0.5);
    lookSensitivity = std::clamp(lookSensitivity, 0.03, 0.6);
}

void TouchControls::setScreen(double width, double height, const SafeInsets& insets) { w_ = width; h_ = height; insets_ = insets; }

void TouchControls::setMode(ControlMode m) {
    if (m == mode_) return;
    mode_ = m;
    // Fingers held across a mode change are ignored until lifted, so the tap that exits a
    // car cannot also press whatever button appears under it.
    for (Track& t : tracks_) { t.role = Role::None; t.button = -1; }
    stickActive_ = false; knobDx_ = knobDy_ = 0;
}

bool TouchControls::buttonInMode(TouchButton b, ControlMode m, const TouchLayout& l) {
    if (!l.buttons[bi(b)].visible) return false;
    switch (b) {
        case TouchButton::Jump: case TouchButton::Sprint: case TouchButton::Interact: case TouchButton::Crouch:
            return m == ControlMode::OnFoot;
        case TouchButton::Phone: return m == ControlMode::OnFoot;
        case TouchButton::Gas: case TouchButton::Brake: case TouchButton::Handbrake: case TouchButton::Reverse:
        case TouchButton::Camera: case TouchButton::ExitVehicle:
            return m == ControlMode::Driving;
        case TouchButton::SteerLeft: case TouchButton::SteerRight:
            return m == ControlMode::Driving && l.steerWithButtons;
        case TouchButton::GaitUp: case TouchButton::GaitDown: case TouchButton::Dismount:
            return m == ControlMode::Riding;
        default: return false;
    }
}

ScreenRect TouchControls::rectFor(const ControlPlacement& p) const {
    const double sw = w_ - insets_.left - insets_.right, sh = h_ - insets_.top - insets_.bottom;
    ScreenRect r;
    r.w = r.h = p.size * sh;
    r.x = p.rightSide ? w_ - insets_.right - (p.dx * sh + r.w) : insets_.left + p.dx * sh;
    r.y = h_ - insets_.bottom - (p.dy * sh + r.h);
    r.x = std::clamp(r.x, insets_.left, std::max(insets_.left, insets_.left + sw - r.w));   // never off screen
    r.y = std::clamp(r.y, insets_.top, std::max(insets_.top, insets_.top + sh - r.h));
    return r;
}

ScreenRect TouchControls::buttonRect(TouchButton b) const { return rectFor(layout_.buttons[bi(b)]); }

ScreenRect TouchControls::stickRect() const { return rectFor(layout_.stick); }

void TouchControls::stickVisual(double& bx, double& by, double& kx, double& ky, double& radius) const {
    const ScreenRect r = stickRect();
    radius = r.w / 2;
    if (stickActive_) { bx = stickBaseX_; by = stickBaseY_; kx = knobDx_; ky = knobDy_; }
    else { bx = r.x + radius; by = r.y + radius; kx = ky = 0; }
}

TouchOutput TouchControls::update(const std::vector<Finger>& fingers) {
    TouchOutput out;
    const bool stickUsed = !(mode_ == ControlMode::Driving && layout_.steerWithButtons);
    const double radius = stickRect().w / 2;
    const double safeW = w_ - insets_.left - insets_.right;

    // Drop tracks whose finger lifted.
    tracks_.erase(std::remove_if(tracks_.begin(), tracks_.end(), [&](const Track& t) {
        for (const Finger& f : fingers) if (f.down && f.id == t.id) return false;
        return true;
    }), tracks_.end());

    bool lookTaken = false, stickTaken = false;
    for (const Track& t : tracks_) { lookTaken = lookTaken || t.role == Role::Look; stickTaken = stickTaken || t.role == Role::Stick; }

    for (const Finger& f : fingers) {
        if (!f.down) continue;
        auto it = std::find_if(tracks_.begin(), tracks_.end(), [&](const Track& t) { return t.id == f.id; });
        if (it == tracks_.end()) {
            // New touch: buttons win, then the stick zone, then camera look.
            Track t; t.id = f.id; t.startX = t.lastX = f.x; t.startY = t.lastY = f.y;
            for (int b = 0; b < kTouchButtonCount && t.role == Role::None; ++b) {
                const TouchButton tb = static_cast<TouchButton>(b);
                if (buttonInMode(tb, mode_, layout_) && inside(buttonRect(tb), f.x, f.y, h_ * 0.012)) { t.role = Role::Button; t.button = b; }
            }
            if (t.role == Role::None && stickUsed && !stickTaken && f.x < insets_.left + safeW * layout_.stickZoneRight) {
                t.role = Role::Stick; stickTaken = true;
                stickBaseX_ = f.x; stickBaseY_ = f.y; stickActive_ = true;
            }
            if (t.role == Role::None && !lookTaken) { t.role = Role::Look; lookTaken = true; }
            tracks_.push_back(t);
            it = tracks_.end() - 1;
        }
        Track& t = *it;
        if (t.role == Role::Stick) {
            double dx = f.x - stickBaseX_, dy = f.y - stickBaseY_;
            const double d = std::hypot(dx, dy);
            if (d > radius) {            // base follows the thumb so it never runs off the pad
                stickBaseX_ += dx * (d - radius) / d; stickBaseY_ += dy * (d - radius) / d;
                dx = f.x - stickBaseX_; dy = f.y - stickBaseY_;
            }
            knobDx_ = dx; knobDy_ = dy;
            const StickOutput s = shapeVirtualStick(dx, dy, radius);
            if (mode_ == ControlMode::OnFoot) { out.moveX = s.x; out.moveY = -s.y; }   // screen y is down
            else out.steer = s.x;
        } else if (t.role == Role::Look) {
            const double scale = layout_.lookSensitivity * 1080.0 / h_;
            out.lookYawDeg += (f.x - t.lastX) * scale;
            out.lookPitchDeg += -(f.y - t.lastY) * scale;
        } else if (t.role == Role::Button) {
            // Sliding well off a button releases it (prevents a stuck accelerator).
            if (inside(buttonRect(static_cast<TouchButton>(t.button)), f.x, f.y, h_ * 0.06)) out.held[t.button] = true;
        }
        t.lastX = f.x; t.lastY = f.y;
    }
    if (!stickTaken) { stickActive_ = false; knobDx_ = knobDy_ = 0; }
    if (mode_ == ControlMode::Driving && layout_.steerWithButtons)
        out.steer = (out.isHeld(TouchButton::SteerRight) ? 1.0 : 0.0) - (out.isHeld(TouchButton::SteerLeft) ? 1.0 : 0.0);
    for (int b = 0; b < kTouchButtonCount; ++b) out.pressed[b] = out.held[b] && !prevHeld_[b];
    prevHeld_ = out.held;
    return out;
}

} // namespace ub6
