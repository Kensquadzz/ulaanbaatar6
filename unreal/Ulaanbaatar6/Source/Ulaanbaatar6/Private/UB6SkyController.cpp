#include "UB6SkyController.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/GameInstance.h"

AUB6SkyController::AUB6SkyController()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.25f;     // the sun moves slowly; do not pay for it every frame
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));

	Sun = CreateDefaultSubobject<UDirectionalLightComponent>(TEXT("Sun"));
	Sun->SetupAttachment(RootComponent);
	Sun->SetMobility(EComponentMobility::Movable);
	Sun->bAtmosphereSunLight = true;           // SkyAtmosphere follows this light
	Sun->DynamicShadowDistanceMovableLight = 12000.f;
	Sun->DynamicShadowCascades = 2;

	SkyLight = CreateDefaultSubobject<USkyLightComponent>(TEXT("SkyLight"));
	SkyLight->SetupAttachment(RootComponent);
	SkyLight->SetMobility(EComponentMobility::Movable);
	SkyLight->bRealTimeCapture = true;         // ambient follows the sky; verify cost per device tier
	SkyLight->bLowerHemisphereIsBlack = false;

	Atmosphere = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Atmosphere"));
	Atmosphere->SetupAttachment(RootComponent);

	Fog = CreateDefaultSubobject<UExponentialHeightFogComponent>(TEXT("Fog"));
	Fog->SetupAttachment(RootComponent);
	Fog->SetFogDensity(0.005f);
}

FRotator AUB6SkyController::SunRotation(float AzimuthDeg, float ElevationDeg)
{
	// Direction TO the sun in world space: azimuth clockwise from north (-Y), east is +X.
	const float Az = FMath::DegreesToRadians(AzimuthDeg), El = FMath::DegreesToRadians(ElevationDeg);
	const FVector ToSun(FMath::Sin(Az) * FMath::Cos(El), -FMath::Cos(Az) * FMath::Cos(El), FMath::Sin(El));
	return (-ToSun).Rotation();                // light travels from the sun towards the ground
}

void AUB6SkyController::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const UGameInstance* GI = GetGameInstance();
	const UUB6LiveWorldSubsystem* World = GI ? GI->GetSubsystem<UUB6LiveWorldSubsystem>() : nullptr;
	if (!World) return;
	const FUB6WorldState& S = World->GetState();

	// The true sun angle drives the atmosphere (so twilight colours are right); direct light
	// fades out as the sun reaches the horizon.
	const float Overcast = 1.f - 0.75f * S.CloudCover;
	const float Height = FMath::Clamp(FMath::Sin(FMath::DegreesToRadians(FMath::Max(S.SunElevationDeg, 0.f))) * 1.6f, 0.f, 1.f);
	Sun->SetWorldRotation(SunRotation(S.SunAzimuthDeg, S.SunElevationDeg));
	Sun->SetIntensity(SunIntensityAtNoon * Height * Overcast);
	Sun->SetLightColor(FMath::Lerp(FLinearColor(1.f, 0.55f, 0.3f), FLinearColor(1.f, 0.97f, 0.92f), Height));
	Sun->SetCastShadows(S.SunElevationDeg > 3.f && S.CloudCover < 0.9f);

	SkyLight->SetIntensity(FMath::Lerp(NightSkyIntensity, 1.f, S.Daylight) * FMath::Lerp(1.f, 0.7f, S.CloudCover));
	// Base haze plus weather fog; winter inversion smog can be layered on from air-quality data.
	Fog->SetFogDensity(0.005f + 0.2f * S.FogDensity);

	if (bFirst || S.bStreetLightsOn != bStreetOn) { bStreetOn = S.bStreetLightsOn; OnStreetLights.Broadcast(bStreetOn); }
	if (bFirst || S.bBuildingLightsOn != bBuildingOn) { bBuildingOn = S.bBuildingLightsOn; OnBuildingLights.Broadcast(bBuildingOn); }
	bFirst = false;
}
