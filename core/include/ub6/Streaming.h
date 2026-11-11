// Geographic chunk streaming for mobile: only the area around the player is in memory.
#pragma once
#include <map>
#include <vector>
#include "ub6/Geo.h"

namespace ub6 {

// LOD0 close detail, LOD1 medium, LOD2 simplified, LOD3 far skyline boxes.
enum class ChunkLod : int { Lod0 = 0, Lod1 = 1, Lod2 = 2, Lod3 = 3 };

struct StreamingConfig {
    int lodRadius[4] = {1, 2, 4, 8};  // Chebyshev ring radius (chunks) per LOD
    int unloadMargin = 1;             // hysteresis: keep chunks this far past the last ring
    double lookAheadSeconds = 4.0;    // preload ahead of travel direction
    int maxLoadsPerUpdate = 2;        // async loads started per update (spreads hitches)
    int maxResidentChunks = 320;      // hard memory cap
};

struct ChunkRequest { ChunkCoord coord; ChunkLod lod; };

struct StreamingDelta {
    std::vector<ChunkRequest> load;      // not resident yet, nearest first
    std::vector<ChunkRequest> changeLod; // resident at a different LOD
    std::vector<ChunkCoord> unload;
};

class ChunkStreamer {
public:
    explicit ChunkStreamer(StreamingConfig cfg = {}) : cfg_(cfg) {}
    void setConfig(const StreamingConfig& c) { cfg_ = c; }
    const StreamingConfig& config() const { return cfg_; }
    // Restrict to chunks that exist in the manifest (min/max inclusive).
    void setWorldBounds(ChunkCoord mn, ChunkCoord mx) { hasBounds_ = true; min_ = mn; max_ = mx; }
    // Computes work for this frame and commits it to the resident set.
    StreamingDelta update(double east, double north, double velEast, double velNorth);
    const std::map<ChunkCoord, ChunkLod>& resident() const { return resident_; }
    static ChunkLod lodForDistance(int chebyshev, const StreamingConfig& cfg, bool& inRange);
private:
    StreamingConfig cfg_;
    std::map<ChunkCoord, ChunkLod> resident_;
    bool hasBounds_ = false;
    ChunkCoord min_{}, max_{};
};

// Distance-based NPC/traffic simulation tier.
enum class SimTier { Full, Reduced, Statistical, Culled };
SimTier simTierForDistance(double distanceM, double fullM, double reducedM, double statisticalM);

} // namespace ub6
