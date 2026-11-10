#include "ub6/Vehicle.h"
#include <algorithm>
#include <cmath>
#include "MathUtil.h"

namespace ub6 {

void VehicleModel::update(double dt, const VehicleInput& in, double gripMul, bool hasFuel) {
    if (dt <= 0) return;
    const double g = 9.81, rho = 1.2;
    const double mu = spec_.baseGrip * std::clamp(gripMul, 0.05, 1.5);
    const double maxAccel = mu * g;                       // friction circle radius
    const double v = s_.speedMs, av = std::fabs(v);
    const double throttle = std::clamp(in.throttle, 0.0, 1.0), brake = std::clamp(in.brake, 0.0, 1.0);

    // --- longitudinal ---------------------------------------------------
    double aLong = 0;
    const double dir = in.reverse ? -1.0 : 1.0;
    if (hasFuel && throttle > 0) {
        const bool atLimit = in.reverse ? v <= -spec_.maxReverseMs : v >= spec_.topSpeedMs;
        if (!atLimit) {
            const double force = std::min(spec_.maxDriveForceN, spec_.powerW * spec_.drivetrainEfficiency / std::max(av, 1.0)) * throttle;
            aLong += dir * force / spec_.massKg;
        }
    }
    const double resist = 0.5 * rho * spec_.dragArea * v * v / spec_.massKg + spec_.rollingResist * g
                        + (throttle <= 0 ? spec_.engineBrakeMs2 : 0.0);
    // Driving and braking both go through the tyres, so both are capped by available grip.
    // Air and rolling resistance are not.
    aLong = std::clamp(aLong, -maxAccel, maxAccel);
    const double tyreBrake = std::min(brake * spec_.brakeDecelMs2 + (in.handbrake ? 0.6 * spec_.brakeDecelMs2 : 0.0), maxAccel);
    const double decel = resist + tyreBrake;
    double nv = v + aLong * dt;
    if (nv > 0) nv = std::max(0.0, nv - decel * dt);
    else if (nv < 0) nv = std::min(0.0, nv + decel * dt);
    const double usedLong = std::fabs((nv - v) / dt);

    // --- lateral ----------------------------------------------------------
    // Less lock at speed, as a driver would use; steering rack moves at a finite rate.
    const double steerLimit = detail::rad(spec_.maxSteerDeg) / (1.0 + av * av / 150.0);
    const double targetSteer = std::clamp(in.steer, -1.0, 1.0) * steerLimit;
    const double rackRate = detail::rad(120.0) * dt;
    s_.steerAngleRad += std::clamp(targetSteer - s_.steerAngleRad, -rackRate, rackRate);
    const double vAvg = 0.5 * (v + nv);
    double yawRate = vAvg / spec_.wheelbaseM * std::tan(s_.steerAngleRad);
    const double latAvail = std::sqrt(std::max(0.0, maxAccel * maxAccel - std::min(usedLong, maxAccel) * std::min(usedLong, maxAccel)))
                          * (in.handbrake ? 0.5 : 1.0);
    const double latWanted = std::fabs(vAvg * yawRate);
    s_.sliding = latWanted > latAvail + 1e-9 || (in.handbrake && av > 3.0);
    if (latWanted > latAvail && latWanted > 1e-9) yawRate *= latAvail / latWanted;   // understeer: the car runs wide
    s_.yawRateRadS = yawRate;
    s_.lateralAccelMs2 = vAvg * yawRate;

    s_.headingRad = detail::wrap(s_.headingRad + yawRate * dt, 2 * detail::kPi);
    s_.x += std::sin(s_.headingRad) * vAvg * dt;
    s_.y += std::cos(s_.headingRad) * vAvg * dt;
    s_.speedMs = nv;
}

} // namespace ub6
