// MobileRenderingSystem: LOW / MEDIUM / HIGH presets, automatic device profiling, and a
// runtime governor (core QualityGovernor) that lowers resolution and then the preset when
// the frame rate drops, memory runs short or the device overheats.
#pragma once
#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Tickable.h"
#include "Misc/CoreDelegates.h"
#include "ub6/Quality.h"
#include "UB6Quality.generated.h"

UENUM(BlueprintType)
enum class EUB6Quality : uint8 { Low, Medium, High };

UCLASS()
class ULAANBAATAR6_API UUB6QualitySubsystem : public UGameInstanceSubsystem, public FTickableGameObject
{
	GENERATED_BODY()
public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UUB6QualitySubsystem, STATGROUP_Tickables); }
	virtual bool IsTickable() const override { return !IsTemplate(); }

	/** The player's choice from the settings menu. The governor never goes above it. */
	UFUNCTION(BlueprintCallable, Category = "UB6|Quality") void SetUserPreset(EUB6Quality Preset);
	UFUNCTION(BlueprintPure, Category = "UB6|Quality") EUB6Quality GetActivePreset() const { return static_cast<EUB6Quality>(Governor.active().preset); }
	UFUNCTION(BlueprintPure, Category = "UB6|Quality") float GetResolutionScale() const { return static_cast<float>(Governor.resolutionScale()); }
	UFUNCTION(BlueprintPure, Category = "UB6|Quality") float GetAverageFps() const { return LastFps; }
	const ub6::QualitySettings& GetSettings() const { return Governor.active(); }
private:
	void Apply();
	void OnTemperature(FCoreDelegates::ETemperatureSeverity Severity);

	ub6::QualityGovernor Governor{ub6::QualityPreset::Medium};
	ub6::ThermalState Thermal = ub6::ThermalState::Nominal;
	FDelegateHandle TemperatureHandle;
	double Accum = 0;
	int32 Frames = 0;
	float LastFps = 0;
	int AppliedPreset = -1;
	double AppliedScale = -1;
};
