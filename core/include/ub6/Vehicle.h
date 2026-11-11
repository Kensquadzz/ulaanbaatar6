// Mobile-optimised car model: a bicycle model with a power-limited engine and a friction
// circle. A few dozen arithmetic operations per step, no per-wheel rigid bodies, so many AI
// cars can run it on a phone. Weather grip feeds straight in.
#pragma once

namespace ub6 {

struct VehicleSpec {
    double massKg = 1450;            // compact hybrid hatchback class
    double wheelbaseM = 2.70;
    double maxSteerDeg = 35;         // at parking speed
    double powerW = 90000;           // combined system output
    double drivetrainEfficiency = 0.88;
    double maxDriveForceN = 5200;    // low-speed tractive limit
    double topSpeedMs = 50.0;        // electronic limiter, 180 km/h
    double dragArea = 0.62;          // Cd * A, m^2
    double rollingResist = 0.012;
    double brakeDecelMs2 = 9.5;      // on dry asphalt, before grip scaling
    double baseGrip = 0.95;          // tyre-road friction on dry asphalt
    double maxReverseMs = 8.0;
    double engineBrakeMs2 = 0.6;
};

struct VehicleInput {
    double throttle = 0;   // 0..1
    double brake = 0;      // 0..1
    double steer = 0;      // -1 (left) .. 1 (right)
    bool reverse = false;  // gear selector
    bool handbrake = false;
};

struct VehicleState {
    double x = 0, y = 0;             // metres, east/north
    double headingRad = 0;           // 0 = north, clockwise positive (compass)
    double speedMs = 0;              // signed along heading
    double steerAngleRad = 0;
    double yawRateRadS = 0;
    double lateralAccelMs2 = 0;
    bool sliding = false;            // demanded more grip than available
};

class VehicleModel {
public:
    explicit VehicleModel(VehicleSpec s = {}) : spec_(s) {}
    // gripMultiplier: WeatherSimParams::tireFriction (1 dry .. 0.2 ice). hasFuel=false cuts drive.
    void update(double dt, const VehicleInput& in, double gripMultiplier = 1.0, bool hasFuel = true);
    const VehicleState& state() const { return s_; }
    VehicleState& state() { return s_; }
    const VehicleSpec& spec() const { return spec_; }
    // Called by the engine layer after a collision sweep stopped the car.
    void onImpact(double restitution = 0.2) { s_.speedMs *= -restitution; }
private:
    VehicleSpec spec_;
    VehicleState s_;
};

} // namespace ub6
