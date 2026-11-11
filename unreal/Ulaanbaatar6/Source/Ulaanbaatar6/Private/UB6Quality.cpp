#include "UB6Quality.h"
#include "UB6CityStreaming.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformMemory.h"
#include "HAL/PlatformMisc.h"

namespace
{
	void SetCVar(const TCHAR* Name, float Value)
	{
		if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name)) V->Set(Value, ECVF_SetByGameSetting);
	}
}

void UUB6QualitySubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	// Automatic device profiling from what the OS reports. GPU tier is refined by the
	// device profiles in Config/DefaultDeviceProfiles.ini (they set r.UB6.GpuTier).
	ub6::DeviceInfo Device;
	Device.ramMb = static_cast<int>(FPlatformMemory::GetStats().TotalPhysical / (1024ull * 1024ull));
	Device.cpuCores = FPlatformMisc::NumberOfCores();
	Device.gpuTier = 1;
	if (const IConsoleVariable* Tier = IConsoleManager::Get().FindConsoleVariable(TEXT("r.UB6.GpuTier"))) Device.gpuTier = Tier->GetInt();
	Governor.setUserPreset(ub6::recommendPreset(Device));
	TemperatureHandle = FCoreDelegates::OnTemperatureChange.AddUObject(this, &UUB6QualitySubsystem::OnTemperature);
	Apply();
}

void UUB6QualitySubsystem::Deinitialize()
{
	FCoreDelegates::OnTemperatureChange.Remove(TemperatureHandle);
	Super::Deinitialize();
}

void UUB6QualitySubsystem::OnTemperature(FCoreDelegates::ETemperatureSeverity Severity)
{
	switch (Severity)
	{
		case FCoreDelegates::ETemperatureSeverity::Bad: Thermal = ub6::ThermalState::Fair; break;
		case FCoreDelegates::ETemperatureSeverity::Serious: Thermal = ub6::ThermalState::Serious; break;
		case FCoreDelegates::ETemperatureSeverity::Critical: Thermal = ub6::ThermalState::Critical; break;
		default: Thermal = ub6::ThermalState::Nominal; break;
	}
}

void UUB6QualitySubsystem::SetUserPreset(EUB6Quality Preset)
{
	Governor.setUserPreset(static_cast<ub6::QualityPreset>(Preset));
	Apply();
}

void UUB6QualitySubsystem::Tick(float DeltaTime)
{
	Accum += DeltaTime; ++Frames;
	if (Accum < 1.0) return;                       // one governor step per second
	ub6::PerfSample S;
	S.fps = Frames / Accum;
	const FPlatformMemoryStats Mem = FPlatformMemory::GetStats();
	S.memoryUsedFraction = Mem.TotalPhysical > 0 ? static_cast<double>(Mem.UsedPhysical) / static_cast<double>(Mem.TotalPhysical) : 0.0;
	S.thermal = Thermal;
	LastFps = static_cast<float>(S.fps);
	Accum = 0; Frames = 0;
	Governor.update(S);
	Apply();
}

void UUB6QualitySubsystem::Apply()
{
	const ub6::QualitySettings& Q = Governor.active();
	const double Scale = Governor.resolutionScale();
	if (FMath::Abs(Scale - AppliedScale) > 1e-6)
	{
		SetCVar(TEXT("r.ScreenPercentage"), static_cast<float>(Scale * 100.0));
		AppliedScale = Scale;
	}
	if (static_cast<int>(Q.preset) == AppliedPreset) return;
	AppliedPreset = static_cast<int>(Q.preset);
	SetCVar(TEXT("t.MaxFPS"), static_cast<float>(Q.targetFps));
	SetCVar(TEXT("r.ViewDistanceScale"), static_cast<float>(Q.drawDistanceM / 2000.0));
	SetCVar(TEXT("r.ShadowQuality"), Q.shadowQuality == 0 ? 0.f : Q.shadowQuality == 1 ? 2.f : 3.f);
	SetCVar(TEXT("r.Shadow.CSM.MaxMobileCascades"), static_cast<float>(FMath::Max(Q.shadowQuality, 1)));
	SetCVar(TEXT("r.Streaming.PoolSize"), Q.preset == ub6::QualityPreset::Low ? 200.f : Q.preset == ub6::QualityPreset::Medium ? 400.f : 800.f);
	SetCVar(TEXT("r.MaxAnisotropy"), Q.preset == ub6::QualityPreset::High ? 4.f : Q.preset == ub6::QualityPreset::Medium ? 2.f : 1.f);
	SetCVar(TEXT("r.Streaming.MipBias"), Q.preset == ub6::QualityPreset::Low ? 1.f : 0.f);
	if (const UGameInstance* GI = GetGameInstance())
	{
		if (UWorld* World = GI->GetWorld())
		{
			if (UUB6CityStreamingSubsystem* City = World->GetSubsystem<UUB6CityStreamingSubsystem>()) City->SetConfig(Q.streaming);
		}
	}
}
