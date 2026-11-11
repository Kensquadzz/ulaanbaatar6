#include "UB6LiveWorld.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	FString ToF(const std::string& S) { return FString(UTF8_TO_TCHAR(S.c_str())); }

	double Num(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, double Default)
	{
		double V = Default;
		return O.IsValid() && O->TryGetNumberField(Key, V) ? V : Default;
	}
}

void UUB6LiveWorldSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	FreePlaySnapshot.valid = true;
	FreePlaySnapshot.temperatureC = 15; FreePlaySnapshot.feelsLikeC = 15; FreePlaySnapshot.humidityPct = 40;
	FreePlaySnapshot.condition = ub6::WeatherCondition::Clear;
	Rebuild();
}

int64 UUB6LiveWorldSubsystem::TrustedNowUnix() const
{
	return static_cast<int64>(FDateTime::UtcNow().ToUnixTimestamp() + ServerClockOffsetS);
}

void UUB6LiveWorldSubsystem::SetMode(EUB6WorldMode NewMode)
{
	if (NewMode == EUB6WorldMode::FreePlay && Clock.mode() == ub6::WorldMode::Live)
	{
		// Start free play from the current real moment and weather so the switch is seamless.
		Clock.setFreePlayTime(TrustedNowUnix(), 1.0);
		if (LiveSnapshot.valid) FreePlaySnapshot = LiveSnapshot;
	}
	Clock.setMode(NewMode == EUB6WorldMode::Live ? ub6::WorldMode::Live : ub6::WorldMode::FreePlay);
	bFirstWeather = true;       // snap the simulation to the new source instead of blending for minutes
	Rebuild();
	OnStateChanged.Broadcast(State);
}

void UUB6LiveWorldSubsystem::SetFreePlayTime(int32 Month, int32 Day, int32 Hour, int32 Minute, float TimeScale)
{
	const int32 Year = FDateTime::UtcNow().GetYear();
	if (!FDateTime::Validate(Year, Month, Day, Hour, Minute, 0, 0)) return;
	const FDateTime Local(Year, Month, Day, Hour, Minute);
	Clock.setFreePlayTime(Local.ToUnixTimestamp() - ub6::kUlaanbaatarUtcOffsetS, FMath::Clamp(TimeScale, 0.f, 3600.f));
}

void UUB6LiveWorldSubsystem::SetFreePlayWeather(float TemperatureC, float RainMmPerHour, float SnowCmPerHour, float SnowDepthM, float VisibilityM, float CloudCoverPct, float WindMs)
{
	ub6::WeatherSnapshot& S = FreePlaySnapshot;
	S.valid = true;
	S.temperatureC = TemperatureC; S.feelsLikeC = TemperatureC - WindMs * 0.7;
	S.rainMmH = FMath::Max(0.f, RainMmPerHour); S.snowfallCmH = FMath::Max(0.f, SnowCmPerHour);
	S.snowDepthM = FMath::Max(0.f, SnowDepthM); S.visibilityM = FMath::Max(50.f, VisibilityM);
	S.cloudCoverPct = FMath::Clamp(CloudCoverPct, 0.f, 100.f); S.windSpeedMs = FMath::Max(0.f, WindMs);
	S.condition = S.snowfallCmH > 0 ? ub6::WeatherCondition::Snow : S.rainMmH > 0 ? ub6::WeatherCondition::Rain
		: S.visibilityM < 1000 ? ub6::WeatherCondition::Fog : S.cloudCoverPct > 80 ? ub6::WeatherCondition::Overcast
		: S.cloudCoverPct > 30 ? ub6::WeatherCondition::PartlyCloudy : ub6::WeatherCondition::Clear;
}

void UUB6LiveWorldSubsystem::RefreshNow()
{
	if (bRequestInFlight || ServerBaseUrl.IsEmpty()) return;
	bRequestInFlight = true;
	SincePoll = 0;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(ServerBaseUrl + TEXT("/v1/world"));
	Req->SetVerb(TEXT("GET"));
	Req->SetTimeout(10.f);
	Req->OnProcessRequestComplete().BindUObject(this, &UUB6LiveWorldSubsystem::HandleResponse);
	Req->ProcessRequest();
}

void UUB6LiveWorldSubsystem::HandleResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bOk)
{
	bRequestInFlight = false;
	if (!bOk || !Response.IsValid() || Response->GetResponseCode() != 200) return;   // keep last good data
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response->GetContentAsString());
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid()) return;

	double ServerNow = 0;
	if (Root->TryGetNumberField(TEXT("server_time_utc"), ServerNow) && ServerNow > 0)
	{
		ServerClockOffsetS = ServerNow - static_cast<double>(FDateTime::UtcNow().ToUnixTimestamp());
	}
	const TSharedPtr<FJsonObject>* W = nullptr;
	double Fetched = 0;
	if (!Root->TryGetObjectField(TEXT("weather"), W) || !W || !W->IsValid() || !Root->TryGetNumberField(TEXT("fetched_at"), Fetched)) return;

	ub6::WeatherSnapshot S;
	S.valid = true;
	S.fetchedUnixUtc = static_cast<int64>(Fetched);
	S.observedUnixUtc = static_cast<int64>(Num(*W, TEXT("observed_at"), Fetched));
	S.provider = TCHAR_TO_UTF8(*Root->GetStringField(TEXT("provider")));
	S.condition = ub6::conditionFromWmoCode(static_cast<int>(Num(*W, TEXT("wmo_code"), -1)));
	S.temperatureC = Num(*W, TEXT("temperature_c"), 0);
	S.feelsLikeC = Num(*W, TEXT("feels_like_c"), S.temperatureC);
	S.humidityPct = Num(*W, TEXT("humidity_pct"), 0);
	S.windSpeedMs = Num(*W, TEXT("wind_speed_ms"), 0);
	S.windDirectionDeg = Num(*W, TEXT("wind_direction_deg"), 0);
	S.windGustMs = Num(*W, TEXT("wind_gust_ms"), S.windSpeedMs);
	S.cloudCoverPct = Num(*W, TEXT("cloud_cover_pct"), 0);
	S.rainMmH = Num(*W, TEXT("rain_mm_h"), 0);
	S.snowfallCmH = Num(*W, TEXT("snowfall_cm_h"), 0);
	S.snowDepthM = Num(*W, TEXT("snow_depth_m"), 0);
	S.visibilityM = Num(*W, TEXT("visibility_m"), 20000);
	S.pressureHpa = Num(*W, TEXT("pressure_hpa"), 1013);
	LiveSnapshot = S;
}

void UUB6LiveWorldSubsystem::Tick(float DeltaTime)
{
	SincePoll += DeltaTime;
	if (SincePoll >= PollSeconds) RefreshNow();

	Clock.tickFreePlay(DeltaTime);
	const bool bLive = Clock.mode() == ub6::WorldMode::Live;
	const ub6::WeatherSnapshot& Src = bLive ? LiveSnapshot : FreePlaySnapshot;
	if (Src.valid && bFirstWeather) { Simulation.reset(Src); bFirstWeather = false; }
	else Simulation.update(Src, DeltaTime);

	Rebuild();
	SinceBroadcast += DeltaTime;
	if (SinceBroadcast >= 1.0) { SinceBroadcast = 0; OnStateChanged.Broadcast(State); }
}

void UUB6LiveWorldSubsystem::Rebuild()
{
	const int64 Now = TrustedNowUnix();
	const ub6::ClockState C = Clock.evaluate(Now);
	const bool bLive = C.mode == ub6::WorldMode::Live;
	State.Mode = bLive ? EUB6WorldMode::Live : EUB6WorldMode::FreePlay;
	State.TimeText = ToF(ub6::formatTime(C.local));
	State.DateText = ToF(ub6::formatDate(C.local));
	State.SunElevationDeg = static_cast<float>(C.sun.elevationDeg); State.SunAzimuthDeg = static_cast<float>(C.sun.azimuthDeg);
	State.Daylight = static_cast<float>(C.daylight);
	State.bStreetLightsOn = C.streetLightsOn; State.bBuildingLightsOn = C.buildingLightsOn;
	if (C.sunTimes.valid)
	{
		State.SunriseText = ToF(ub6::formatTime(ub6::toLocal(C.sunTimes.sunrise)));
		State.SunsetText = ToF(ub6::formatTime(ub6::toLocal(C.sunTimes.sunset)));
	}

	const ub6::WeatherSnapshot& Src = bLive ? LiveSnapshot : FreePlaySnapshot;
	const ub6::DataFreshness F = bLive ? ub6::freshness(Src, Now) : ub6::DataFreshness::Live;
	State.WeatherFreshness = F == ub6::DataFreshness::Live ? EUB6Freshness::Live : F == ub6::DataFreshness::Stale ? EUB6Freshness::Stale : EUB6Freshness::Unavailable;
	if (Src.valid)
	{
		State.WeatherKey = ToF(ub6::conditionKey(Src.condition));
		State.WeatherProvider = bLive ? ToF(Src.provider) : FString(TEXT("free-play"));
		State.LastSyncText = bLive ? ToF(ub6::formatTime(ub6::toLocal(Src.fetchedUnixUtc))) : FString();
		State.TemperatureC = static_cast<float>(Src.temperatureC); State.FeelsLikeC = static_cast<float>(Src.feelsLikeC); State.HumidityPct = static_cast<float>(Src.humidityPct);
		State.WindSpeedMs = static_cast<float>(Src.windSpeedMs); State.WindDirectionDeg = static_cast<float>(Src.windDirectionDeg);
	}
	const ub6::WeatherSimParams& P = Simulation.params();
	State.SnowfallIntensity = static_cast<float>(P.snowfallIntensity); State.RainIntensity = static_cast<float>(P.rainIntensity); State.SnowCover = static_cast<float>(P.snowCover);
	State.RoadWetness = static_cast<float>(P.roadWetness); State.Ice = static_cast<float>(P.ice); State.FogDensity = static_cast<float>(P.fogDensity); State.CloudCover = static_cast<float>(P.cloudCover);
	State.WindStrength = static_cast<float>(P.windStrength); State.TireFriction = static_cast<float>(P.tireFriction);
	State.bBreathVisible = P.breathVisible; State.bWipersNeeded = P.wipersNeeded; State.bWinterClothing = P.winterClothing;
}
