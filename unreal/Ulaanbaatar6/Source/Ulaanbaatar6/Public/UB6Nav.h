// GPSNavigationSystem: routes over the real road graph (core RoadGraph, A*), plus a
// per-chunk index of road geometry for the minimap.
#pragma once
#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "ub6/RoadGraph.h"
#include "UB6Nav.generated.h"

UENUM(BlueprintType)
enum class EUB6TravelMode : uint8 { Car, Foot, Horse };

USTRUCT(BlueprintType)
struct FUB6Landmark
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString Key;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString Name;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FVector World = FVector::ZeroVector;
};

UCLASS()
class ULAANBAATAR6_API UUB6NavSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()
public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/** Sets the active GPS destination; returns false when no route exists. */
	UFUNCTION(BlueprintCallable, Category = "UB6|GPS") bool NavigateTo(const FVector& From, const FVector& To, EUB6TravelMode Mode);
	UFUNCTION(BlueprintCallable, Category = "UB6|GPS") bool NavigateToLandmark(const FVector& From, const FString& LandmarkKey, EUB6TravelMode Mode);
	UFUNCTION(BlueprintCallable, Category = "UB6|GPS") void ClearRoute() { RoutePoints.Reset(); RouteLengthM = 0; }
	UFUNCTION(BlueprintPure, Category = "UB6|GPS") const TArray<FVector>& GetRoute() const { return RoutePoints; }
	UFUNCTION(BlueprintPure, Category = "UB6|GPS") float GetRouteLengthM() const { return RouteLengthM; }
	UFUNCTION(BlueprintPure, Category = "UB6|GPS") const TArray<FUB6Landmark>& GetLandmarks() const { return Landmarks; }

	/** Road centre lines (pairs of points, metres east/north) for chunks around a position. */
	void GetMinimapRoads(double East, double North, int32 ChunkRadius, TArray<FVector2D>& OutSegments, TArray<uint8>& OutMajor) const;
	bool IsLoaded() const { return bLoaded; }
private:
	ub6::RoadGraph Graph;
	TMap<FIntPoint, TArray<int32>> EdgesByChunk;
	TArray<FVector> RoutePoints;
	TArray<FUB6Landmark> Landmarks;
	float RouteLengthM = 0;
	bool bLoaded = false;
};
