#include "UB6CityStreaming.h"
#include "UB6Geo.h"
#include "ProceduralMeshComponent.h"
#include "Async/Async.h"
#include "Dom/JsonObject.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	const double kOriginGround = UUB6GeoSubsystem::OriginGroundM;

	bool ReadJson(const FString& Path, TSharedPtr<FJsonObject>& Out)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *Path)) return false;
		return FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Out) && Out.IsValid();
	}

	bool IsMajor(const FString& Class)
	{
		return Class == TEXT("trunk") || Class == TEXT("primary") || Class == TEXT("secondary") || Class == TEXT("motorway");
	}

	/** Core mesh (metres, x east, y north, z above sea level) -> Unreal arrays (cm, y south). */
	void AddSection(UProceduralMeshComponent* Comp, int32 Section, const ub6::MeshData& M, bool bCollision)
	{
		if (M.indices.empty()) return;
		const int32 NV = static_cast<int32>(M.vertexCount());
		TArray<FVector> V; TArray<FVector> N; TArray<int32> I; TArray<FVector2D> UV;
		V.Reserve(NV); N.Reserve(NV); UV.Reserve(NV); I.Reserve(static_cast<int32>(M.indices.size()));
		for (int32 k = 0; k < NV; ++k)
		{
			const float* P = &M.positions[k * 3]; const float* Nm = &M.normals[k * 3];
			V.Add(FVector(P[0] * 100.0, -P[1] * 100.0, (P[2] - kOriginGround) * 100.0));
			N.Add(FVector(Nm[0], -Nm[1], Nm[2]));
			UV.Add(FVector2D(P[0] * 0.25, P[1] * 0.25));          // 4 m world-space tiling
		}
		// (East, South, Up) is a faithful left-handed image of the world, so a triangle that is
		// counter-clockwise seen from outside stays counter-clockwise on screen. Unreal treats
		// clockwise as front-facing, so the index order is reversed.
		for (size_t t = 0; t + 2 < M.indices.size(); t += 3)
		{
			I.Add(static_cast<int32>(M.indices[t])); I.Add(static_cast<int32>(M.indices[t + 2])); I.Add(static_cast<int32>(M.indices[t + 1]));
		}
		Comp->CreateMeshSection(Section, V, I, N, UV, TArray<FColor>(), TArray<FProcMeshTangent>(), bCollision);
	}
}

AUB6ChunkActor::AUB6ChunkActor()
{
	Mesh = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	Mesh->bUseAsyncCooking = true;                 // collision cooking off the game thread
	Mesh->SetMobility(EComponentMobility::Static);
	PrimaryActorTick.bCanEverTick = false;
}

void AUB6ChunkActor::Apply(const FUB6ChunkBuild& Build, const TArray<UMaterialInterface*>& Materials)
{
	Lod = Build.Lod;
	Mesh->ClearAllMeshSections();
	// Collision only where the player can be: LOD0/LOD1. Far chunks are visual only.
	const bool bCollide = static_cast<int>(Build.Lod) <= 1;
	const ub6::MeshData* Sections[5] = {&Build.Terrain, &Build.Roads, &Build.Footways, &Build.Buildings, &Build.Water};
	for (int32 S = 0; S < 5; ++S)
	{
		AddSection(Mesh, S, *Sections[S], bCollide && S != 4);
		if (Materials.IsValidIndex(S) && Materials[S]) Mesh->SetMaterial(S, Materials[S]);
	}
	Mesh->SetCastShadow(static_cast<int>(Build.Lod) == 0);
}

FString UUB6CityStreamingSubsystem::TilesDir()
{
	return FPaths::Combine(FPaths::ProjectContentDir(), TEXT("UB6Data"), TEXT("tiles"));
}

FUB6ChunkBuild UUB6CityStreamingSubsystem::BuildChunk(const FString& Dir, ub6::ChunkCoord Coord, ub6::ChunkLod Lod)
{
	FUB6ChunkBuild Out;
	Out.Coord = Coord; Out.Lod = Lod;
	TSharedPtr<FJsonObject> Root;
	if (!ReadJson(FPaths::Combine(Dir, TEXT("chunks"), FString::Printf(TEXT("%d_%d.json"), Coord.x, Coord.y)), Root)) return Out;
	const int LodI = static_cast<int>(Lod);

	// Terrain (always; coarser at distance).
	const int32 GridN = Root->GetIntegerField(TEXT("grid_n"));
	std::vector<float> H;
	const double Cell = GridN > 1 ? ub6::kChunkSizeM / (GridN - 1) : ub6::kChunkSizeM;
	const double OriginX = Coord.x * ub6::kChunkSizeM, OriginY = Coord.y * ub6::kChunkSizeM;
	const TArray<TSharedPtr<FJsonValue>>* Grid = nullptr;
	if (Root->TryGetArrayField(TEXT("height_grid_dm"), Grid) && Grid && Grid->Num() == GridN * GridN)
	{
		H.resize(static_cast<size_t>(GridN) * GridN);
		for (int32 k = 0; k < Grid->Num(); ++k) H[k] = static_cast<float>((*Grid)[k]->AsNumber() / 10.0);
		const int Step = LodI == 0 ? 1 : LodI == 1 ? 2 : LodI == 2 ? 4 : 8;
		ub6::appendTerrain(Out.Terrain, H, GridN, OriginX, OriginY, Cell, (GridN - 1) % Step == 0 ? Step : 1);
	}

	// Roads: everything up close, major roads at LOD2, none on the far skyline.
	const TArray<TSharedPtr<FJsonValue>>* Roads = nullptr;
	if (LodI <= 2 && Root->TryGetArrayField(TEXT("roads"), Roads) && Roads)
	{
		for (const TSharedPtr<FJsonValue>& RV : *Roads)
		{
			const TSharedPtr<FJsonObject> R = RV->AsObject();
			if (!R.IsValid()) continue;
			const bool bDrivable = R->GetBoolField(TEXT("drivable"));
			if (LodI == 2 && !IsMajor(R->GetStringField(TEXT("class")))) continue;
			if (LodI >= 1 && !bDrivable) continue;
			std::vector<double> Pts;
			for (const TSharedPtr<FJsonValue>& PV : R->GetArrayField(TEXT("pts")))
			{
				const TArray<TSharedPtr<FJsonValue>>& P = PV->AsArray();
				if (P.Num() >= 3) { Pts.push_back(P[0]->AsNumber()); Pts.push_back(P[1]->AsNumber()); Pts.push_back(P[2]->AsNumber()); }
			}
			ub6::appendRoad(bDrivable ? Out.Roads : Out.Footways, Pts, R->GetNumberField(TEXT("width")), bDrivable ? 0.05 : 0.08);
		}
	}

	// Buildings: all at LOD0-2; only tall ones form the LOD3 skyline.
	const TArray<TSharedPtr<FJsonValue>>* Buildings = nullptr;
	if (Root->TryGetArrayField(TEXT("buildings"), Buildings) && Buildings)
	{
		for (const TSharedPtr<FJsonValue>& BV : *Buildings)
		{
			const TSharedPtr<FJsonObject> B = BV->AsObject();
			if (!B.IsValid()) continue;
			const double Height = B->GetNumberField(TEXT("height"));
			if (LodI == 3 && Height < 25.0) continue;
			if (LodI == 2 && Height < 6.0) continue;
			const double Base = B->GetNumberField(TEXT("base_z"));
			for (const TSharedPtr<FJsonValue>& RingV : B->GetArrayField(TEXT("rings")))
			{
				std::vector<double> Ring;
				for (const TSharedPtr<FJsonValue>& PV : RingV->AsArray())
				{
					const TArray<TSharedPtr<FJsonValue>>& P = PV->AsArray();
					if (P.Num() >= 2) { Ring.push_back(P[0]->AsNumber()); Ring.push_back(P[1]->AsNumber()); }
				}
				// Sink the base 1 m so walls meet sloping ground without gaps.
				ub6::appendBuilding(Out.Buildings, Ring, Base - 1.0, Height + 1.0);
			}
		}
	}

	// Water polygons (Tuul, Selbe, Dund rivers) as flat surfaces at their lowest bank height.
	const TArray<TSharedPtr<FJsonValue>>* Water = nullptr;
	if (LodI <= 2 && !H.empty() && Root->TryGetArrayField(TEXT("water"), Water) && Water)
	{
		for (const TSharedPtr<FJsonValue>& WV : *Water)
		{
			const TSharedPtr<FJsonObject> W = WV->AsObject();
			const TArray<TSharedPtr<FJsonValue>>* RingV = nullptr;
			if (!W.IsValid() || !W->TryGetArrayField(TEXT("ring"), RingV) || !RingV) continue;
			std::vector<double> Ring;
			for (const TSharedPtr<FJsonValue>& PV : *RingV)
			{
				const TArray<TSharedPtr<FJsonValue>>& P = PV->AsArray();
				if (P.Num() >= 2) { Ring.push_back(P[0]->AsNumber()); Ring.push_back(P[1]->AsNumber()); }
			}
			std::vector<uint32_t> Tri;
			if (!ub6::triangulate(Ring, Tri)) continue;
			const uint32 Base = static_cast<uint32>(Out.Water.vertexCount());
			// A flat surface at the lowest terrain height under the outline (the bank line).
			double Z = TNumericLimits<double>::Max();
			for (size_t k = 0; k + 1 < Ring.size(); k += 2) Z = FMath::Min(Z, ub6::sampleTerrain(H, GridN, OriginX, OriginY, Cell, Ring[k], Ring[k + 1]));
			for (size_t k = 0; k + 1 < Ring.size(); k += 2)
			{
				Out.Water.positions.insert(Out.Water.positions.end(), {static_cast<float>(Ring[k]), static_cast<float>(Ring[k + 1]), static_cast<float>(Z + 0.1)});
				Out.Water.normals.insert(Out.Water.normals.end(), {0.f, 0.f, 1.f});
			}
			for (uint32_t T : Tri) Out.Water.indices.push_back(Base + T);
		}
	}
	Out.bOk = true;
	return Out;
}

void UUB6CityStreamingSubsystem::OnWorldBeginPlay(UWorld& InWorld)
{
	Super::OnWorldBeginPlay(InWorld);
	TSharedPtr<FJsonObject> Manifest;
	if (!ReadJson(FPaths::Combine(TilesDir(), TEXT("manifest.json")), Manifest))
	{
		UE_LOG(LogTemp, Error, TEXT("UB6: tiles manifest not found in %s. Run the data pipeline and copy data/tiles there."), *TilesDir());
		return;
	}
	int32 MinX = MAX_int32, MinY = MAX_int32, MaxX = MIN_int32, MaxY = MIN_int32;
	for (const TSharedPtr<FJsonValue>& CV : Manifest->GetArrayField(TEXT("chunks")))
	{
		const TSharedPtr<FJsonObject> C = CV->AsObject();
		const int32 X = C->GetIntegerField(TEXT("x")), Y = C->GetIntegerField(TEXT("y"));
		MinX = FMath::Min(MinX, X); MaxX = FMath::Max(MaxX, X); MinY = FMath::Min(MinY, Y); MaxY = FMath::Max(MaxY, Y);
	}
	Streamer.setWorldBounds({MinX, MinY}, {MaxX, MaxY});
	for (const FSoftObjectPath& Path : SectionMaterials) LoadedMaterials.Add(Cast<UMaterialInterface>(Path.TryLoad()));
	bHasManifest = true;
}

void UUB6CityStreamingSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!bHasManifest) return;
	SinceUpdate += DeltaTime;
	if (SinceUpdate < 0.2) return;                 // five streaming decisions per second is plenty
	const APlayerController* PC = GetWorld()->GetFirstPlayerController();
	const APawn* Pawn = PC ? PC->GetPawn() : nullptr;
	const FVector Pos = Pawn ? Pawn->GetActorLocation() : FVector::ZeroVector;
	const FVector Vel = bHasLast && SinceUpdate < 2.0 ? (Pos - LastPos) / SinceUpdate : FVector::ZeroVector;
	LastPos = Pos; bHasLast = true; SinceUpdate = 0;

	double E, N, U, VE, VN, VU;
	UUB6GeoSubsystem::WorldToEnu(Pos, E, N, U);
	UUB6GeoSubsystem::WorldToEnu(Vel, VE, VN, VU);
	const ub6::StreamingDelta Delta = Streamer.update(E, N, VE, VN);

	for (const ub6::ChunkCoord& C : Delta.unload)
	{
		const FIntPoint Key(C.x, C.y);
		Pending.Remove(Key);
		if (TObjectPtr<AUB6ChunkActor>* A = Actors.Find(Key)) { if (*A) (*A)->Destroy(); Actors.Remove(Key); }
	}
	for (const ub6::ChunkRequest& R : Delta.load) StartLoad(R.coord, R.lod);
	// LOD changes are rebuilt nearest-first, a couple per update, to avoid hitches while driving.
	int32 Budget = Streamer.config().maxLoadsPerUpdate;
	for (const ub6::ChunkRequest& R : Delta.changeLod)
	{
		if (Budget-- <= 0) break;
		StartLoad(R.coord, R.lod);
	}
}

void UUB6CityStreamingSubsystem::StartLoad(ub6::ChunkCoord Coord, ub6::ChunkLod Lod)
{
	const FIntPoint Key(Coord.x, Coord.y);
	if (const ub6::ChunkLod* InFlight = Pending.Find(Key)) { if (*InFlight == Lod) return; }
	Pending.Add(Key, Lod);
	const FString Dir = TilesDir();
	TWeakObjectPtr<UUB6CityStreamingSubsystem> Weak(this);
	Async(EAsyncExecution::ThreadPool, [Weak, Dir, Coord, Lod]()
	{
		TSharedPtr<FUB6ChunkBuild, ESPMode::ThreadSafe> Build = MakeShared<FUB6ChunkBuild, ESPMode::ThreadSafe>(BuildChunk(Dir, Coord, Lod));
		AsyncTask(ENamedThreads::GameThread, [Weak, Build]() { if (Weak.IsValid()) Weak->Finish(Build); });
	});
}

void UUB6CityStreamingSubsystem::Finish(TSharedPtr<FUB6ChunkBuild, ESPMode::ThreadSafe> Build)
{
	const FIntPoint Key(Build->Coord.x, Build->Coord.y);
	const ub6::ChunkLod* Wanted = Pending.Find(Key);
	if (!Wanted || *Wanted != Build->Lod) return;  // unloaded or superseded while loading
	Pending.Remove(Key);
	if (!Build->bOk) return;
	TObjectPtr<AUB6ChunkActor>& Actor = Actors.FindOrAdd(Key);
	if (!Actor) Actor = GetWorld()->SpawnActor<AUB6ChunkActor>();
	if (!Actor) return;
	TArray<UMaterialInterface*> Mats;
	for (const TObjectPtr<UMaterialInterface>& M : LoadedMaterials) Mats.Add(M.Get());
	Actor->Apply(*Build, Mats);
}

bool UUB6CityStreamingSubsystem::IsGroundReady(const FVector& WorldPosition) const
{
	double E, N, U;
	UUB6GeoSubsystem::WorldToEnu(WorldPosition, E, N, U);
	const ub6::ChunkCoord C = ub6::chunkOf(E, N);
	const TObjectPtr<AUB6ChunkActor>* A = Actors.Find(FIntPoint(C.x, C.y));
	return A && *A && static_cast<int>((*A)->Lod) <= 1;
}
