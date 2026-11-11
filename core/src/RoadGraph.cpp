#include "ub6/RoadGraph.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <queue>
#include <sstream>

namespace ub6 {
namespace {
const double kWalkMs = 1.4, kHorseMs = 4.0, kMaxCarMs = 80.0 / 3.6;
}

bool RoadGraph::load(std::istream& in) {
    nodes_.clear(); edges_.clear(); adj_.clear();
    std::string line;
    while (std::getline(in, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::istringstream ss(line);
        char type; ss >> type;
        if (type == 'N') {
            int32_t id; RoadNode n; ss >> id >> n.east >> n.north;
            if (!ss || id != static_cast<int32_t>(nodes_.size())) return false;
            nodes_.push_back(n);
        } else if (type == 'E') {
            RoadEdge e; int drivable = 0, npts = 0;
            ss >> e.a >> e.b >> e.lengthM >> e.roadClass >> e.oneway >> e.speedKmh >> drivable >> npts;
            if (!ss || npts < 2) return false;
            e.drivable = drivable != 0;
            e.pts.resize(static_cast<size_t>(npts) * 2);
            for (double& v : e.pts) ss >> v;
            if (!ss) return false;
            edges_.push_back(std::move(e));
        } else return false;
    }
    adj_.assign(nodes_.size(), {});
    for (int32_t i = 0; i < static_cast<int32_t>(edges_.size()); ++i) {
        const RoadEdge& e = edges_[i];
        if (e.a < 0 || e.b < 0 || e.a >= static_cast<int32_t>(nodes_.size()) || e.b >= static_cast<int32_t>(nodes_.size())) return false;
        adj_[e.a].push_back({e.b, i, true});
        adj_[e.b].push_back({e.a, i, false});
    }
    // Label the largest connected component per travel mode (one-way streets treated as
    // connected here; A* still enforces direction).
    for (int m = 0; m < 3; ++m) {
        const TravelMode mode = static_cast<TravelMode>(m);
        std::vector<int32_t> comp(nodes_.size(), -1);
        std::vector<int32_t> sizes, stack;
        for (int32_t s = 0; s < static_cast<int32_t>(nodes_.size()); ++s) {
            if (comp[s] != -1) continue;
            const int32_t id = static_cast<int32_t>(sizes.size());
            int32_t count = 0;
            comp[s] = id; stack.push_back(s);
            while (!stack.empty()) {
                const int32_t u = stack.back(); stack.pop_back(); ++count;
                for (const Arc& a : adj_[u])
                    if (comp[a.to] == -1 && usable(edges_[a.edge], mode)) { comp[a.to] = id; stack.push_back(a.to); }
            }
            sizes.push_back(count);
        }
        const int32_t best = static_cast<int32_t>(std::max_element(sizes.begin(), sizes.end()) - sizes.begin());
        inMain_[m].assign(nodes_.size(), 0);
        for (size_t i = 0; i < nodes_.size(); ++i) inMain_[m][i] = comp[i] == best ? 1 : 0;
    }
    return !nodes_.empty();
}

bool RoadGraph::usable(const RoadEdge& e, TravelMode mode) {
    if (mode == TravelMode::Car) return e.drivable;
    if (mode == TravelMode::Horse) return e.roadClass != "steps";
    return true;
}

int32_t RoadGraph::nearestNode(double east, double north, TravelMode mode) const {
    int32_t best = -1; double bestD = std::numeric_limits<double>::max();
    for (int32_t i = 0; i < static_cast<int32_t>(nodes_.size()); ++i) {
        if (!inMain_[static_cast<int>(mode)][i]) continue;
        const double dx = nodes_[i].east - east, dy = nodes_[i].north - north, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

Route RoadGraph::route(int32_t from, int32_t to, TravelMode mode) const {
    Route r;
    const int32_t n = static_cast<int32_t>(nodes_.size());
    if (from < 0 || to < 0 || from >= n || to >= n) return r;
    const double inf = std::numeric_limits<double>::max();
    const double vmax = mode == TravelMode::Car ? kMaxCarMs : (mode == TravelMode::Horse ? kHorseMs : kWalkMs);
    auto h = [&](int32_t i) {
        return std::hypot(nodes_[i].east - nodes_[to].east, nodes_[i].north - nodes_[to].north) / vmax;
    };
    std::vector<double> g(n, inf);
    std::vector<int32_t> prevEdge(n, -1), prevNode(n, -1);
    std::vector<char> prevFwd(n, 1);
    using QI = std::pair<double, int32_t>;
    std::priority_queue<QI, std::vector<QI>, std::greater<QI>> open;
    g[from] = 0; open.push({h(from), from});
    while (!open.empty()) {
        const auto [f, u] = open.top(); open.pop();
        if (u == to) break;
        if (f > g[u] + h(u) + 1e-9) continue;
        for (const Arc& a : adj_[u]) {
            const RoadEdge& e = edges_[a.edge];
            if (!usable(e, mode)) continue;
            // One-way rules bind cars and horses on the carriageway; pedestrians ignore them.
            if (mode != TravelMode::Foot && e.oneway != 0 && (e.oneway == 1) != a.forward) continue;
            const double v = mode == TravelMode::Car ? std::min(kMaxCarMs, std::max(5.0, static_cast<double>(e.speedKmh)) / 3.6)
                     : (mode == TravelMode::Horse ? kHorseMs : kWalkMs);
            const double cost = g[u] + e.lengthM / v;
            if (cost < g[a.to]) {
                g[a.to] = cost; prevEdge[a.to] = a.edge; prevNode[a.to] = u; prevFwd[a.to] = a.forward;
                open.push({cost + h(a.to), a.to});
            }
        }
    }
    if (g[to] == inf) return r;
    r.found = true; r.durationS = g[to];
    std::vector<std::pair<int32_t, bool>> rev;
    for (int32_t v = to; v != from; v = prevNode[v]) rev.push_back({prevEdge[v], prevFwd[v] != 0});
    std::reverse(rev.begin(), rev.end());
    for (const auto& [ei, fwd] : rev) {
        const RoadEdge& e = edges_[ei];
        r.edges.push_back(ei); r.lengthM += e.lengthM;
        const size_t np = e.pts.size() / 2;
        for (size_t k = 0; k < np; ++k) {
            const size_t idx = fwd ? k : np - 1 - k;
            r.polyline.push_back(e.pts[idx * 2]); r.polyline.push_back(e.pts[idx * 2 + 1]);
        }
    }
    return r;
}

} // namespace ub6
