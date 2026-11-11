// Drives the sun, sky light, atmosphere, fog and city lights from the live world state.
// Self-contained: it owns its light components, so the game mode can spawn it into an empty
// map and no level art is needed for correct real-time lighting.
// Mobile-safe: one movable directional light, no Lumen, exponential height fog only.
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "UB6LiveWorld.h"
#include "UB6SkyController.generated.h"

class UDirectionalLightComponent;
class USkyLightComponent;
class USkyAtmosphereComponent;
class UExponentialHeightFogComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FUB6LightsSwitched, bool, bOn);

UCLASS()
class ULAANBAATAR6_API AUB6SkyController : public AActor
{
	GENERATED_BODY()
public:
	AUB6SkyController();
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UDirectionalLightComponent> Sun;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<USkyLightComponent> SkyLight;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<USkyAtmosphereComponent> Atmosphere;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UExponentialHeightFogComponent> Fog;
	UPROPERTY(EditAnywhere, Category = "UB6") float SunIntensityAtNoon = 6.0f;   // mobile-friendly intensity
	UPROPERTY(EditAnywhere, Category = "UB6") float NightSkyIntensity = 0.08f;

	/** Street lamps and window emissives listen to these (fired only on change). */
	UPROPERTY(BlueprintAssignable, Category = "UB6") FUB6LightsSwitched OnStreetLights;
	UPROPERTY(BlueprintAssignable, Category = "UB6") FUB6LightsSwitched OnBuildingLights;

	/** Unreal rotation for a sun at the given compass azimuth and elevation (X east, -Y north). */
	static FRotator SunRotation(float AzimuthDeg, float ElevationDeg);
private:
	bool bStreetOn = false, bBuildingOn = false, bFirst = true;
};
