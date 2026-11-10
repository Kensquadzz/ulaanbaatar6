#include "UB6GameMode.h"
#include "UB6Character.h"
#include "UB6Geo.h"
#include "UB6Horse.h"
#include "UB6HUD.h"
#include "UB6Input.h"
#include "UB6Nav.h"
#include "UB6SkyController.h"
#include "UB6Vehicle.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"

namespace
{
	// Actors start high above the terrain and are dropped onto it once the chunk has streamed in.
	const double kSpawnHeightCm = 30000.0;
}

AUB6GameMode::AUB6GameMode()
{
	DefaultPawnClass = AUB6Character::StaticClass();
	PlayerControllerClass = AUB6PlayerController::StaticClass();
	HUDClass = AUB6HUD::StaticClass();
}

APawn* AUB6GameMode::SpawnDefaultPawnAtTransform_Implementation(AController* NewPlayer, const FTransform&)
{
	// Sukhbaatar Square is the world origin; start a few metres south of its centre.
	const FTransform Start(FRotator(0.f, 90.f, 0.f), UUB6GeoSubsystem::EnuToWorld(0.0, -20.0, 0.0) + FVector(0, 0, kSpawnHeightCm));
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	return GetWorld()->SpawnActor<AUB6Character>(AUB6Character::StaticClass(), Start, Params);
}

void AUB6GameMode::StartPlay()
{
	Super::StartPlay();
	UUB6NavSubsystem* Nav = GetGameInstance() ? GetGameInstance()->GetSubsystem<UUB6NavSubsystem>() : nullptr;
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	// Sun, sky, atmosphere and fog driven by the live clock and weather.
	GetWorld()->SpawnActor<AUB6SkyController>(AUB6SkyController::StaticClass(), FTransform::Identity, Params);

	// Car: parked 12 m east of the player, facing south towards Peace Avenue.
	GetWorld()->SpawnActor<AUB6Vehicle>(AUB6Vehicle::StaticClass(),
		FTransform(FRotator(0.f, 90.f, 0.f), UUB6GeoSubsystem::EnuToWorld(12.0, -20.0, 0.0) + FVector(0, 0, kSpawnHeightCm)), Params);

	if (!Nav) return;
	const FVector PlayerStart = UUB6GeoSubsystem::EnuToWorld(0.0, -20.0, 0.0);
	for (const FUB6Landmark& L : Nav->GetLandmarks())
	{
		if (L.Key != TEXT("zaisan_square")) continue;
		// Horse waits at Zaisan Square, at the foot of the hill.
		FVector At = L.World + FVector(600.f, 0.f, 0.f);
		At.Z = kSpawnHeightCm + L.World.Z;
		GetWorld()->SpawnActor<AUB6Horse>(AUB6Horse::StaticClass(), FTransform(FRotator::ZeroRotator, At), Params);
		Nav->NavigateTo(PlayerStart, L.World, EUB6TravelMode::Car);
	}
}
