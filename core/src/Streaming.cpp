#include "ub6/Streaming.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>

namespace ub6 {

ChunkLod ChunkStreamer::lodForDistance(int d, const StreamingConfig& cfg, bool& inRange) {
    inRange = true;
    for (int i = 0; i < 4; ++i)
        if (d <= cfg.lodRadius[i]) return static_cast<ChunkLod>(i);
    inRange = false;
    return ChunkLod::Lod3;
}

StreamingDelta ChunkStreamer::update(double east, double north, double velEast, double velNorth) {
    StreamingDelta out;
    const ChunkCoord here = chunkOf(east, north);
    const ChunkCoord ahead = chunkOf(east + velEast * cfg_.lookAheadSeconds, north + velNorth * cfg_.lookAheadSeconds);
    auto dist = [](ChunkCoord a, ChunkCoord b) { return std::max(std::abs(a.x - b.x), std::abs(a.y - b.y)); };
    auto exists = [&](ChunkCoord c) {
        return !hasBounds_ || (c.x >= min_.x && c.x <= max_.x && c.y >= min_.y && c.y <= max_.y);
    };

    // Desired set: rings around the player, plus a detail ring around the predicted position.
    std::map<ChunkCoord, ChunkLod> desired;
    const int r = cfg_.lodRadius[3];
    for (int dx = -r; dx <= r; ++dx)
        for (int dy = -r; dy <= r; ++dy) {
            const ChunkCoord c{here.x + dx, here.y + dy};
            if (!exists(c)) continue;
            bool in = false;
            ChunkLod lod = lodForDistance(dist(c, here), cfg_, in);
            if (in) desired[c] = lod;
        }
    if (!(ahead == here)) {
        const int pr = cfg_.lodRadius[1];
        for (int dx = -pr; dx <= pr; ++dx)
            for (int dy = -pr; dy <= pr; ++dy) {
                const ChunkCoord c{ahead.x + dx, ahead.y + dy};
                if (!exists(c)) continue;
                bool in = false;
                const ChunkLod lod = lodForDistance(dist(c, ahead), cfg_, in);
                auto it = desired.find(c);
                if (it == desired.end() || static_cast<int>(lod) < static_cast<int>(it->second)) desired[c] = lod;
            }
    }

    // Unload: outside the hysteresis band of both the player and the predicted position.
    const int keep = r + cfg_.unloadMargin;
    for (auto it = resident_.begin(); it != resident_.end();) {
        if (desired.count(it->first) == 0 && dist(it->first, here) > keep) {
            out.unload.push_back(it->first);
            it = resident_.erase(it);
        } else ++it;
    }

    for (const auto& [c, lod] : desired) {
        auto it = resident_.find(c);
        if (it == resident_.end()) out.load.push_back({c, lod});
        else if (it->second != lod) out.changeLod.push_back({c, lod});
    }
    // Nearest (highest detail) first, then throttle so loading never stalls a frame.
    std::sort(out.load.begin(), out.load.end(), [&](const ChunkRequest& a, const ChunkRequest& b) {
        const int da = std::min(dist(a.coord, here), dist(a.coord, ahead));
        const int db = std::min(dist(b.coord, here), dist(b.coord, ahead));
        return da != db ? da < db : a.coord < b.coord;
    });
    if (static_cast<int>(out.load.size()) > cfg_.maxLoadsPerUpdate) out.load.resize(cfg_.maxLoadsPerUpdate);
    const int room = cfg_.maxResidentChunks - static_cast<int>(resident_.size());
    if (static_cast<int>(out.load.size()) > room) out.load.resize(std::max(0, room));

    for (const auto& req : out.load) resident_[req.coord] = req.lod;
    for (const auto& req : out.changeLod) resident_[req.coord] = req.lod;
    return out;
}

SimTier simTierForDistance(double d, double fullM, double reducedM, double statisticalM) {
    if (d <= fullM) return SimTier::Full;
    if (d <= reducedM) return SimTier::Reduced;
    if (d <= statisticalM) return SimTier::Statistical;
    return SimTier::Culled;
}

} // namespace ub6
