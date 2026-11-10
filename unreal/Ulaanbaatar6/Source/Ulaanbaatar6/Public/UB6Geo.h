// GeographicWorldSystem: WGS84 <-> Unreal world space.
// Convention: Unreal X = East, Unreal Y = South (so North is -Y), Z = Up, 1 uu = 1 cm.
// The world origin is the centre of Sukhbaatar Square. All conversion maths runs in doubles
// in the tested core; Unreal 5 Large World Coordinates keep precision city-wide.
#pragma once
#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "ub6/Geo.h"
#include "UB6Geo.generated.h"

UCLASS()
class ULAANBAATAR6_API UUB6GeoSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()
public:
	UFUNCTION(BlueprintPure, Category = "UB6|Geo")
	FVector GeoToWorld(double LatitudeDeg, double LongitudeDeg, double HeightM) const;

	/** Returns X = latitude, Y = longitude, Z = height in metres. */
	UFUNCTION(BlueprintPure, Category = "UB6|Geo")
	FVector WorldToGeo(const FVector& World) const;

	static FVector EnuToWorld(double East, double North, double Up) { return FVector(East * 100.0, -North * 100.0, Up * 100.0); }
	static void WorldToEnu(const FVector& W, double& East, double& North, double& Up) { East = W.X / 100.0; North = -W.Y / 100.0; Up = W.Z / 100.0; }

	/** Drops an actor onto the streamed ground below/above it. False if no ground was hit yet. */
	static bool SnapToGround(AActor* Actor, float HeightAboveGroundCm);

	/** Ground height of the origin in metres above sea level (terrain is stored absolute). */
	static constexpr double OriginGroundM = 1298.0;
private:
	ub6::LocalFrame Frame;
};
