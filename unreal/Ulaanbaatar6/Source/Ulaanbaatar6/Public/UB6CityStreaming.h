// CityStreamingSystem: loads only the geographic chunks around the player.
// Chunk files come from the data pipeline (Content/UB6Data/tiles, staged as loose files).
// File reading, JSON parsing and mesh building run on worker threads; only the final mesh
// upload touches the game thread, and at most a few chunks start loading per update.
#pragma once
#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "GameFramework/Actor.h"
#include "ub6/Streaming.h"
#include "ub6/Mesh.h"
#include "UB6CityStreaming.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;

/** Plain data produced off the game thread for one chunk at one LOD. */
struct FUB6ChunkBuild
{
	ub6::ChunkCoord Coord;
	ub6::ChunkLod Lod = ub6::ChunkLod::Lod3;
	ub6::MeshData Terrain, Roads, Footways, Buildings, Water;
	bool bOk = false;
};

UCLASS()
class ULAANBAATAR6_API AUB6ChunkActor : public AActor
{
	GENERATED_BODY()
public:
	AUB6ChunkActor();
	void Apply(const FUB6ChunkBuild& Build, const TArray<UMaterialInterface*>& Materials);
	ub6::ChunkLod Lod = ub6::ChunkLod::Lod3;
private:
	UPROPERTY() TObjectPtr<UProceduralMeshComponent> Mesh;
};

UCLASS(Config = Game)
class ULAANBAATAR6_API UUB6CityStreamingSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual void OnWorldBeginPlay(UWorld& InWorld) override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UUB6CityStreamingSubsystem, STATGROUP_Tickables); }
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override { return WorldType == EWorldType::Game || WorldType == EWorldType::PIE; }

	void SetConfig(const ub6::StreamingConfig& Config) { Streamer.setConfig(Config); }
	UFUNCTION(BlueprintPure, Category = "UB6|Streaming") int32 GetResidentChunkCount() const { return Actors.Num(); }
	UFUNCTION(BlueprintPure, Category = "UB6|Streaming") int32 GetPendingLoadCount() const { return Pending.Num(); }
	/** True once the chunk under the given world position has collision (safe to spawn the player). */
	UFUNCTION(BlueprintPure, Category = "UB6|Streaming") bool IsGroundReady(const FVector& WorldPosition) const;

	/** Materials by section: 0 terrain, 1 road, 2 footway, 3 building, 4 water. Set in DefaultGame.ini. */
	UPROPERTY(Config) TArray<FSoftObjectPath> SectionMaterials;

	static FString TilesDir();
	static FUB6ChunkBuild BuildChunk(const FString& Dir, ub6::ChunkCoord Coord, ub6::ChunkLod Lod);
private:
	void StartLoad(ub6::ChunkCoord Coord, ub6::ChunkLod Lod);
	void Finish(TSharedPtr<FUB6ChunkBuild, ESPMode::ThreadSafe> Build);

	ub6::ChunkStreamer Streamer;
	UPROPERTY() TMap<FIntPoint, TObjectPtr<AUB6ChunkActor>> Actors;
	TMap<FIntPoint, ub6::ChunkLod> Pending;       // requested LOD of loads in flight
	UPROPERTY() TArray<TObjectPtr<UMaterialInterface>> LoadedMaterials;
	double SinceUpdate = 1e9;
	FVector LastPos = FVector::ZeroVector;
	bool bHasLast = false, bHasManifest = false;
};
