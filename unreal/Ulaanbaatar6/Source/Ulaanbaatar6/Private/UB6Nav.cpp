#include "UB6Nav.h"
#include "UB6CityStreaming.h"
#include "UB6Geo.h"
#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include <sstream>

void UUB6NavSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	const FString Dir = UUB6CityStreamingSubsystem::TilesDir();
	// Read through Unreal's file layer (works inside an APK/IPA), then parse with the core.
	FString Text;
	if (FFileHelper::LoadFileToString(Text, *FPaths::Combine(Dir, TEXT("nav"), TEXT("roadgraph.txt"))))
	{
		std::istringstream In{std::string(TCHAR_TO_UTF8(*Text))};
		bLoaded = Graph.load(In);
	}
	if (!bLoaded) { UE_LOG(LogTemp, Error, TEXT("UB6: road graph missing or invalid in %s"), *Dir); return; }
	for (int32 E = 0; E < static_cast<int32>(Graph.edgeCount()); ++E)
	{
		const ub6::RoadEdge& Edge = Graph.edge(E);
		if (!Edge.drivable) continue;
		const ub6::ChunkCoord A = ub6::chunkOf(Edge.pts[0], Edge.pts[1]);
		const ub6::ChunkCoord B = ub6::chunkOf(Edge.pts[Edge.pts.size() - 2], Edge.pts[Edge.pts.size() - 1]);
		EdgesByChunk.FindOrAdd(FIntPoint(A.x, A.y)).Add(E);
		if (!(A == B)) EdgesByChunk.FindOrAdd(FIntPoint(B.x, B.y)).Add(E);
	}

	FString LmText;
	TSharedPtr<FJsonObject> Root;
	if (FFileHelper::LoadFileToString(LmText, *FPaths::Combine(Dir, TEXT("landmarks.json")))
		&& FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(LmText), Root) && Root.IsValid())
	{
		const TSharedPtr<FJsonObject>* Found = nullptr;
		if (Root->TryGetObjectField(TEXT("found"), Found) && Found)
		{
			for (const auto& Pair : (*Found)->Values)
			{
				const TSharedPtr<FJsonObject> L = Pair.Value->AsObject();
				if (!L.IsValid()) continue;
				FUB6Landmark Lm;
				Lm.Key = Pair.Key; Lm.Name = L->GetStringField(TEXT("name"));
				Lm.World = UUB6GeoSubsystem::EnuToWorld(L->GetNumberField(TEXT("east")), L->GetNumberField(TEXT("north")),
					L->GetNumberField(TEXT("ground_m")) - UUB6GeoSubsystem::OriginGroundM);
				Landmarks.Add(Lm);
			}
		}
	}
}

bool UUB6NavSubsystem::NavigateTo(const FVector& From, const FVector& To, EUB6TravelMode Mode)
{
	ClearRoute();
	if (!bLoaded) return false;
	const ub6::TravelMode M = Mode == EUB6TravelMode::Car ? ub6::TravelMode::Car : Mode == EUB6TravelMode::Horse ? ub6::TravelMode::Horse : ub6::TravelMode::Foot;
	double E0, N0, U0, E1, N1, U1;
	UUB6GeoSubsystem::WorldToEnu(From, E0, N0, U0);
	UUB6GeoSubsystem::WorldToEnu(To, E1, N1, U1);
	const ub6::Route R = Graph.route(Graph.nearestNode(E0, N0, M), Graph.nearestNode(E1, N1, M), M);
	if (!R.found) return false;
	RoutePoints.Reserve(static_cast<int32>(R.polyline.size() / 2));
	for (size_t K = 0; K + 1 < R.polyline.size(); K += 2) RoutePoints.Add(UUB6GeoSubsystem::EnuToWorld(R.polyline[K], R.polyline[K + 1], 0.0));
	RouteLengthM = static_cast<float>(R.lengthM);
	return true;
}

bool UUB6NavSubsystem::NavigateToLandmark(const FVector& From, const FString& LandmarkKey, EUB6TravelMode Mode)
{
	for (const FUB6Landmark& L : Landmarks) if (L.Key == LandmarkKey) return NavigateTo(From, L.World, Mode);
	return false;
}

void UUB6NavSubsystem::GetMinimapRoads(double East, double North, int32 ChunkRadius, TArray<FVector2D>& OutSegments, TArray<uint8>& OutMajor) const
{
	const ub6::ChunkCoord C = ub6::chunkOf(East, North);
	TSet<int32> Seen;
	for (int32 DX = -ChunkRadius; DX <= ChunkRadius; ++DX)
		for (int32 DY = -ChunkRadius; DY <= ChunkRadius; ++DY)
		{
			const TArray<int32>* List = EdgesByChunk.Find(FIntPoint(C.x + DX, C.y + DY));
			if (!List) continue;
			for (int32 E : *List)
			{
				if (Seen.Contains(E)) continue;
				Seen.Add(E);
				const ub6::RoadEdge& Edge = Graph.edge(E);
				const bool bMajor = Edge.roadClass == "trunk" || Edge.roadClass == "primary" || Edge.roadClass == "secondary";
				for (size_t K = 0; K + 3 < Edge.pts.size(); K += 2)
				{
					OutSegments.Add(FVector2D(Edge.pts[K], Edge.pts[K + 1]));
					OutSegments.Add(FVector2D(Edge.pts[K + 2], Edge.pts[K + 3]));
					OutMajor.Add(bMajor ? 1 : 0);
				}
			}
		}
}
