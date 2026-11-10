// GPS navigation over the real road graph produced by the pipeline (nav/roadgraph.txt).
#pragma once
#include <cstdint>
#include <istream>
#include <string>
#include <vector>

namespace ub6 {

enum class TravelMode { Car, Foot, Horse };

struct RoadNode { double east = 0, north = 0; };
struct RoadEdge {
    int32_t a = 0, b = 0;
    double lengthM = 0;
    std::string roadClass;
    int oneway = 0;                 // 1: a->b only, -1: b->a only, 0: both
    int speedKmh = 0;
    bool drivable = false;
    std::vector<double> pts;        // e,n pairs along the real geometry from a to b
};

struct Route {
    bool found = false;
    double lengthM = 0, durationS = 0;
    std::vector<int32_t> edges;     // edge indices in travel order
    std::vector<double> polyline;   // e,n pairs for the minimap/GPS line
};

class RoadGraph {
public:
    bool load(std::istream& in);
    size_t nodeCount() const { return nodes_.size(); }
    size_t edgeCount() const { return edges_.size(); }
    const RoadNode& node(int32_t i) const { return nodes_[i]; }
    const RoadEdge& edge(int32_t i) const { return edges_[i]; }
    // Nearest node on the mode's main connected network, so GPS never snaps to an
    // isolated stub (for example a footway a horse can only leave by stairs). -1 if none.
    int32_t nearestNode(double east, double north, TravelMode mode) const;
    Route route(int32_t from, int32_t to, TravelMode mode) const;   // A*, fastest path
    static bool usable(const RoadEdge& e, TravelMode mode);
private:
    struct Arc { int32_t to, edge; bool forward; };
    std::vector<RoadNode> nodes_;
    std::vector<RoadEdge> edges_;
    std::vector<std::vector<Arc>> adj_;
    std::vector<char> inMain_[3];   // per TravelMode: node belongs to the largest component
};

} // namespace ub6
