#include "UB6Geo.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

FVector UUB6GeoSubsystem::GeoToWorld(double LatitudeDeg, double LongitudeDeg, double HeightM) const
{
	// Horizontal position from the exact ENU projection; vertical is height above sea level
	// relative to the origin ground, matching how the pipeline stores terrain.
	const ub6::Enu E = Frame.toEnu({LatitudeDeg, LongitudeDeg, 0.0});
	return EnuToWorld(E.east, E.north, HeightM - OriginGroundM);
}

FVector UUB6GeoSubsystem::WorldToGeo(const FVector& World) const
{
	double East, North, Up;
	WorldToEnu(World, East, North, Up);
	const ub6::GeoPoint G = Frame.toGeo({East, North, 0.0});
	return FVector(G.latDeg, G.lonDeg, Up + OriginGroundM);
}

bool UUB6GeoSubsystem::SnapToGround(AActor* Actor, float HeightAboveGroundCm)
{
	if (!Actor || !Actor->GetWorld()) return false;
	const FVector P = Actor->GetActorLocation();
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(UB6SnapToGround), false, Actor);
	// The slice spans roughly 1280-1750 m above sea level: trace the whole column.
	if (!Actor->GetWorld()->LineTraceSingleByChannel(Hit, FVector(P.X, P.Y, 100000.0), FVector(P.X, P.Y, -20000.0), ECC_WorldStatic, Params)) return false;
	Actor->SetActorLocation(Hit.Location + FVector(0.0, 0.0, HeightAboveGroundCm), false, nullptr, ETeleportType::TeleportPhysics);
	return true;
}
