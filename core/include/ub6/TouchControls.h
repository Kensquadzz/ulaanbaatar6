// MobileInputSystem: touch layout and multi-finger state machine, engine independent.
// The engine layer feeds raw finger positions each frame and reads back game input.
#pragma once
#include <array>
#include <vector>
#include "ub6/Gameplay.h"

namespace ub6 {

enum class ControlMode { OnFoot, Driving, Riding };

enum class TouchButton : int {
    Jump, Sprint, Interact, Crouch, Phone,                 // on foot
    Gas, Brake, Handbrake, Reverse, Camera, ExitVehicle,   // driving
    SteerLeft, SteerRight,
    GaitUp, GaitDown, Dismount,                            // riding
    Count
};
constexpr int kTouchButtonCount = static_cast<int>(TouchButton::Count);

// Position of one control, measured from a bottom corner of the safe area in units of the
// safe-area height, so the thumb clusters keep their shape on every aspect ratio.
// Players can move and resize these.
struct ControlPlacement { bool rightSide = true; double dx = 0, dy = 0, size = 0.16; bool visible = true; };

struct TouchLayout {
    std::array<ControlPlacement, kTouchButtonCount> buttons{};
    ControlPlacement stick{false, 0.04, 0.06, 0.36, true};   // movement stick base (left thumb)
    double stickZoneRight = 0.42;                     // floating stick may start anywhere left of this
    double lookSensitivity = 0.18;                    // degrees per pixel at 1080p height
    bool steerWithButtons = false;                    // driving: buttons instead of the stick
    static TouchLayout defaults();
    void clampToSafeLimits();                         // keeps customised controls usable
};

struct Finger { int id = 0; double x = 0, y = 0; bool down = false; };

struct TouchOutput {
    double moveX = 0, moveY = 0;       // -1..1, y forward
    double lookYawDeg = 0, lookPitchDeg = 0;   // this frame
    double steer = 0;                  // -1..1 (driving and riding)
    std::array<bool, kTouchButtonCount> held{};
    std::array<bool, kTouchButtonCount> pressed{};   // went down this frame
    bool isHeld(TouchButton b) const { return held[static_cast<int>(b)]; }
    bool wasPressed(TouchButton b) const { return pressed[static_cast<int>(b)]; }
};

class TouchControls {
public:
    void setLayout(const TouchLayout& l) { layout_ = l; layout_.clampToSafeLimits(); }
    const TouchLayout& layout() const { return layout_; }
    void setScreen(double width, double height, const SafeInsets& insets);
    const SafeInsets& insets() const { return insets_; }
    void setMode(ControlMode m);
    ControlMode mode() const { return mode_; }
    static bool buttonInMode(TouchButton b, ControlMode m, const TouchLayout& l);
    // Screen rectangle of a control, for drawing the HUD with the same data used for hit tests.
    ScreenRect buttonRect(TouchButton b) const;
    ScreenRect stickRect() const;
    ScreenRect rectFor(const ControlPlacement& p) const;
    // Where the stick base currently is (follows the thumb while held) and knob offset in px.
    void stickVisual(double& baseX, double& baseY, double& knobDx, double& knobDy, double& radius) const;
    TouchOutput update(const std::vector<Finger>& fingers);
private:
    enum class Role { None, Stick, Look, Button };
    struct Track { int id = -1; Role role = Role::None; int button = -1; double startX = 0, startY = 0, lastX = 0, lastY = 0; };
    TouchLayout layout_ = TouchLayout::defaults();
    ControlMode mode_ = ControlMode::OnFoot;
    double w_ = 1920, h_ = 1080;
    SafeInsets insets_{};
    std::vector<Track> tracks_;
    std::array<bool, kTouchButtonCount> prevHeld_{};
    double stickBaseX_ = 0, stickBaseY_ = 0, knobDx_ = 0, knobDy_ = 0;
    bool stickActive_ = false;
};

} // namespace ub6
