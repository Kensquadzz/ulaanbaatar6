// LiveClockSystem + LiveWeatherSystem + WeatherSimulationSystem (game side).
// Talks only to our own server (see /server); provider API keys never ship in the client.
#pragma once
#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Tickable.h"
#include "Interfaces/IHttpRequest.h"
#include "ub6/LiveClock.h"
#include "ub6/Weather.h"
#include "UB6LiveWorld.generated.h"

UENUM(BlueprintType)
enum class EUB6WorldMode : uint8 { Live, FreePlay };

UENUM(BlueprintType)
enum class EUB6Freshness : uint8 { Live, Stale, Unavailable };

/** Everything the HUD, sky and gameplay need each frame. */
USTRUCT(BlueprintType)
struct FUB6WorldState
{
	GENERATED_BODY()
	UPROPERTY(BlueprintReadOnly, Category = "UB6") EUB6WorldMode Mode = EUB6WorldMode::Live;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString TimeText;          // "16:00"
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString DateText;          // "2026-11-10"
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float SunElevationDeg = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float SunAzimuthDeg = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float Daylight = 1;        // 0 night .. 1 day
	UPROPERTY(BlueprintReadOnly, Category = "UB6") bool bStreetLightsOn = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") bool bBuildingLightsOn = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString SunriseText;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString SunsetText;

	UPROPERTY(BlueprintReadOnly, Category = "UB6") EUB6Freshness WeatherFreshness = EUB6Freshness::Unavailable;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString WeatherKey;        // localisation key
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString WeatherProvider;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") FString LastSyncText;      // local time of last successful fetch
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float TemperatureC = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float FeelsLikeC = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float HumidityPct = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float WindSpeedMs = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float WindDirectionDeg = 0;

	// Simulation outputs, 0..1.
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float SnowfallIntensity = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float RainIntensity = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float SnowCover = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float RoadWetness = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float Ice = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float FogDensity = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float CloudCover = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float WindStrength = 0;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") float TireFriction = 1;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") bool bBreathVisible = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") bool bWipersNeeded = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6") bool bWinterClothing = false;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FUB6WorldStateChanged, const FUB6WorldState&, State);

UCLASS(Config = Game)
class ULAANBAATAR6_API UUB6LiveWorldSubsystem : public UGameInstanceSubsystem, public FTickableGameObject
{
	GENERATED_BODY()
public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UUB6LiveWorldSubsystem, STATGROUP_Tickables); }
	virtual bool IsTickable() const override { return !IsTemplate(); }

	UFUNCTION(BlueprintPure, Category = "UB6|World") const FUB6WorldState& GetState() const { return State; }
	UFUNCTION(BlueprintCallable, Category = "UB6|World") void SetMode(EUB6WorldMode NewMode);

	/** FREE PLAY controls. Ignored in LIVE mode. */
	UFUNCTION(BlueprintCallable, Category = "UB6|World") void SetFreePlayTime(int32 Month, int32 Day, int32 Hour, int32 Minute, float TimeScale);
	UFUNCTION(BlueprintCallable, Category = "UB6|World") void SetFreePlayWeather(float TemperatureC, float RainMmPerHour, float SnowCmPerHour, float SnowDepthM, float VisibilityM, float CloudCoverPct, float WindMs);

	UFUNCTION(BlueprintCallable, Category = "UB6|World") void RefreshNow();

	UPROPERTY(BlueprintAssignable, Category = "UB6|World") FUB6WorldStateChanged OnStateChanged;

	/** e.g. https://api.example.mn  (set in DefaultGame.ini, no trailing slash). */
	UPROPERTY(Config) FString ServerBaseUrl;
	UPROPERTY(Config) float PollSeconds = 60.f;

private:
	void HandleResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bOk);
	int64 TrustedNowUnix() const;
	void Rebuild();

	ub6::LiveClock Clock{ub6::kOriginLatDeg, ub6::kOriginLonDeg};
	ub6::WeatherSnapshot LiveSnapshot;        // last successful server data; never invented
	ub6::WeatherSnapshot FreePlaySnapshot;
	ub6::WeatherSimulation Simulation;
	FUB6WorldState State;
	double ServerClockOffsetS = 0;            // server time - device time (device clocks can be wrong)
	double SincePoll = 1e9;
	double SinceBroadcast = 0;
	bool bFirstWeather = true;
	bool bRequestInFlight = false;
};
