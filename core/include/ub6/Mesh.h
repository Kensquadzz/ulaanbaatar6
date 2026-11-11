// Geometry builders that turn chunk data (footprints, road centre lines, height grids)
// into triangle meshes. Engine independent so they can be unit tested.
#pragma once
#include <cstdint>
#include <vector>

namespace ub6 {

struct MeshData {
    std::vector<float> positions;   // x,y,z triples, metres (x east, y north, z up)
    std::vector<float> normals;     // x,y,z triples
    std::vector<uint32_t> indices;  // counter-clockwise triangles seen from outside/above
    size_t vertexCount() const { return positions.size() / 3; }
    size_t triangleCount() const { return indices.size() / 3; }
};

// Signed area of a ring given as x,y pairs (positive = counter-clockwise).
double ringArea(const std::vector<double>& ring);

// Ear-clipping triangulation of a simple polygon (no holes). Returns indices into the ring.
// Robust to either winding and to duplicate/collinear points; returns false if degenerate.
bool triangulate(const std::vector<double>& ring, std::vector<uint32_t>& outIndices);

// Extruded building: flat roof at baseZ+height plus walls down to baseZ. Appends to mesh.
bool appendBuilding(MeshData& mesh, const std::vector<double>& ring, double baseZ, double height);

// Road ribbon of the given width following a polyline of x,y,z triples. Mitred joints.
void appendRoad(MeshData& mesh, const std::vector<double>& xyz, double width, double zOffset = 0.05);

// Terrain patch from an n*n height grid (row-major from the south-west corner, metres).
// step > 1 skips samples for lower LODs (n-1 must be divisible by step).
void appendTerrain(MeshData& mesh, const std::vector<float>& heights, int n, double originX, double originY,
                   double cellSize, int step = 1);

// Bilinear height lookup on the same grid (for placing objects and simple ground queries).
double sampleTerrain(const std::vector<float>& heights, int n, double originX, double originY, double cellSize,
                     double x, double y);

} // namespace ub6
