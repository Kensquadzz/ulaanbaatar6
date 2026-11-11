#include "UB6HUD.h"
#include "UB6Character.h"
#include "UB6CityStreaming.h"
#include "UB6Geo.h"
#include "UB6Horse.h"
#include "UB6Input.h"
#include "UB6Interactable.h"
#include "UB6LiveWorld.h"
#include "UB6Nav.h"
#include "UB6Text.h"
#include "UB6Vehicle.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "HAL/PlatformMisc.h"

namespace
{
	const FLinearColor kPanel(0.02f, 0.03f, 0.05f, 0.55f);
	const FLinearColor kWhite(1.f, 1.f, 1.f, 0.95f);
	const FLinearColor kDim(1.f, 1.f, 1.f, 0.6f);
	const FLinearColor kLive(0.95f, 0.15f, 0.15f, 1.f);
	const FLinearColor kWarn(1.f, 0.72f, 0.2f, 1.f);
	const FLinearColor kRoute(0.2f, 0.7f, 1.f, 1.f);

	const TCHAR* ButtonKey(ub6::TouchButton B)
	{
		using TB = ub6::TouchButton;
		switch (B)
		{
			case TB::Jump: return TEXT("btn.jump"); case TB::Sprint: return TEXT("btn.sprint"); case TB::Interact: return TEXT("btn.interact");
			case TB::Crouch: return TEXT("btn.crouch"); case TB::Phone: return TEXT("btn.phone"); case TB::Gas: return TEXT("btn.gas");
			case TB::Brake: return TEXT("btn.brake"); case TB::Handbrake: return TEXT("btn.handbrake"); case TB::Reverse: return TEXT("btn.reverse");
			case TB::Camera: return TEXT("btn.camera"); case TB::ExitVehicle: return TEXT("btn.exit"); case TB::SteerLeft: return TEXT("btn.left");
			case TB::SteerRight: return TEXT("btn.right"); case TB::GaitUp: return TEXT("btn.gait_up"); case TB::GaitDown: return TEXT("btn.gait_down");
			case TB::Dismount: return TEXT("btn.dismount"); default: return TEXT("");
		}
	}
}

FString AUB6HUD::T(const TCHAR* Key) const { return UUB6Text::Get(Key, bMongolian); }

void AUB6HUD::Outline(float X, float Y, float W, float H, const FLinearColor& Color, float Thickness)
{
	DrawLine(X, Y, X + W, Y, Color, Thickness); DrawLine(X + W, Y, X + W, Y + H, Color, Thickness);
	DrawLine(X + W, Y + H, X, Y + H, Color, Thickness); DrawLine(X, Y + H, X, Y, Color, Thickness);
}

void AUB6HUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas) return;
	const AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetOwningPlayerController());
	if (!PC) return;
	// All sizes scale with screen height so the HUD reads the same on every phone.
	const float Scale = Canvas->SizeY / 1080.f;
	// Keep panels clear of the notch / Dynamic Island / gesture bar.
	const ub6::SafeInsets& Safe = PC->GetTouch().insets();
	const float Left = static_cast<float>(Safe.left) + 24.f * Scale, Top = static_cast<float>(Safe.top) + 24.f * Scale;
	DrawLivePanel(Scale, Left, Top);
	DrawMinimap(Scale, Canvas->SizeX - static_cast<float>(Safe.right) - 24.f * Scale, Top);
	DrawStatus(Scale, Left, Canvas->SizeY * 0.44f);
	DrawTouchControls(Scale);
}

void AUB6HUD::DrawLivePanel(float Scale, float Left, float Top)
{
	const UGameInstance* GI = GetGameInstance();
	const UUB6LiveWorldSubsystem* Live = GI ? GI->GetSubsystem<UUB6LiveWorldSubsystem>() : nullptr;
	if (!Live) return;
	const FUB6WorldState& S = Live->GetState();
	UFont* Font = GEngine->GetMediumFont();
	const float W = 430.f * Scale, Line = 30.f * Scale;
	DrawRect(kPanel, Left, Top, W, Line * 6.6f);
	float Y = Top + 8.f * Scale;
	const float X = Left + 14.f * Scale;

	DrawText(T(TEXT("hud.title")), kWhite, X, Y, Font, 1.5f * Scale); Y += Line * 1.3f;
	const bool bLive = S.Mode == EUB6WorldMode::Live;
	// The red LIVE dot is shown only while the weather really is fresh.
	if (bLive && S.WeatherFreshness == EUB6Freshness::Live) DrawRect(kLive, X, Y + 6.f * Scale, 12.f * Scale, 12.f * Scale);
	DrawText(T(bLive ? TEXT("hud.live") : TEXT("hud.free_play")), bLive ? kWhite : kWarn, X + 20.f * Scale, Y, Font, 1.f * Scale); Y += Line;
	DrawText(FString::Printf(TEXT("%s   %s"), *S.TimeText, *S.DateText), kWhite, X, Y, Font, 1.25f * Scale); Y += Line * 1.15f;

	if (S.WeatherFreshness == EUB6Freshness::Unavailable && bLive)
	{
		DrawText(T(TEXT("hud.unavailable")), kWarn, X, Y, Font, Scale); Y += Line;
	}
	else
	{
		DrawText(FString::Printf(TEXT("%+.0f°C  %s"), S.TemperatureC, *UUB6Text::Get(S.WeatherKey, bMongolian)), kWhite, X, Y, Font, 1.25f * Scale); Y += Line * 1.1f;
		DrawText(FString::Printf(TEXT("%s %+.0f°  %s %.0f m/s  %s %.0f%%"), *T(TEXT("hud.feels_like")), S.FeelsLikeC,
			*T(TEXT("hud.wind")), S.WindSpeedMs, *T(TEXT("hud.humidity")), S.HumidityPct), kDim, X, Y, Font, 0.85f * Scale); Y += Line * 0.9f;
		if (bLive)
		{
			const bool bStale = S.WeatherFreshness == EUB6Freshness::Stale;
			DrawText(FString::Printf(TEXT("%s %s  (%s)"), *T(bStale ? TEXT("hud.stale") : TEXT("hud.last_sync")), *S.LastSyncText, *S.WeatherProvider),
				bStale ? kWarn : kDim, X, Y, Font, 0.8f * Scale);
		}
	}
}

void AUB6HUD::DrawMinimap(float Scale, float Right, float Top)
{
	const APawn* Pawn = GetOwningPawn();
	const UGameInstance* GI = GetGameInstance();
	const UUB6NavSubsystem* Nav = GI ? GI->GetSubsystem<UUB6NavSubsystem>() : nullptr;
	const UUB6GeoSubsystem* Geo = GI ? GI->GetSubsystem<UUB6GeoSubsystem>() : nullptr;
	if (!Pawn || !Nav || !Nav->IsLoaded()) return;
	const float Size = 260.f * Scale, X0 = Right - Size, Y0 = Top, Half = Size * 0.5f;
	DrawRect(kPanel, X0, Y0, Size, Size);
	double E, N, U;
	UUB6GeoSubsystem::WorldToEnu(Pawn->GetActorLocation(), E, N, U);
	const double PxPerM = static_cast<double>(Half) / MinimapRangeM;
	// North-up map: east to the right, north up. Lines are clipped to the square.
	auto Plot = [&](double AE, double AN, double BE, double BN, const FLinearColor& Color, float Thick)
	{
		double AX = (AE - E) * PxPerM, AY = -(AN - N) * PxPerM, BX = (BE - E) * PxPerM, BY = -(BN - N) * PxPerM;
		if (FMath::Max(FMath::Abs(AX), FMath::Abs(AY)) > Half && FMath::Max(FMath::Abs(BX), FMath::Abs(BY)) > Half) return;
		AX = FMath::Clamp(AX, -Half, Half); AY = FMath::Clamp(AY, -Half, Half); BX = FMath::Clamp(BX, -Half, Half); BY = FMath::Clamp(BY, -Half, Half);
		DrawLine(X0 + Half + static_cast<float>(AX), Y0 + Half + static_cast<float>(AY), X0 + Half + static_cast<float>(BX), Y0 + Half + static_cast<float>(BY), Color, Thick);
	};
	TArray<FVector2D> Seg; TArray<uint8> Major;
	Nav->GetMinimapRoads(E, N, FMath::CeilToInt32(MinimapRangeM / 256.f), Seg, Major);
	for (int32 K = 0; K + 1 < Seg.Num(); K += 2)
	{
		const bool bMajor = Major[K / 2] != 0;
		Plot(Seg[K].X, Seg[K].Y, Seg[K + 1].X, Seg[K + 1].Y, bMajor ? kWhite : kDim, (bMajor ? 3.f : 1.5f) * Scale);
	}
	const TArray<FVector>& Route = Nav->GetRoute();
	for (int32 K = 0; K + 1 < Route.Num(); ++K)
	{
		double AE, AN, AU, BE, BN, BU;
		UUB6GeoSubsystem::WorldToEnu(Route[K], AE, AN, AU); UUB6GeoSubsystem::WorldToEnu(Route[K + 1], BE, BN, BU);
		Plot(AE, AN, BE, BN, kRoute, 4.f * Scale);
	}
	// Player arrow (Unreal yaw 0 = east).
	const float Yaw = FMath::DegreesToRadians(Pawn->GetActorRotation().Yaw);
	const FVector2D C(X0 + Half, Y0 + Half), Dir(FMath::Cos(Yaw), FMath::Sin(Yaw)), Side(-Dir.Y, Dir.X);
	const float A = 12.f * Scale;
	DrawLine(C.X + Dir.X * A, C.Y + Dir.Y * A, C.X - Dir.X * A * 0.7f + Side.X * A * 0.6f, C.Y - Dir.Y * A * 0.7f + Side.Y * A * 0.6f, kLive, 3.f * Scale);
	DrawLine(C.X + Dir.X * A, C.Y + Dir.Y * A, C.X - Dir.X * A * 0.7f - Side.X * A * 0.6f, C.Y - Dir.Y * A * 0.7f - Side.Y * A * 0.6f, kLive, 3.f * Scale);
	Outline(X0, Y0, Size, Size, kDim, 1.f * Scale);

	UFont* Font = GEngine->GetMediumFont();
	if (Geo)
	{
		const FVector G = Geo->WorldToGeo(Pawn->GetActorLocation());
		DrawText(FString::Printf(TEXT("%.5f°N  %.5f°E"), G.X, G.Y), kDim, X0, Y0 + Size + 6.f * Scale, Font, 0.8f * Scale);
	}
	if (Route.Num() > 1) DrawText(FString::Printf(TEXT("%s %.1f km"), *T(TEXT("hud.route")), Nav->GetRouteLengthM() / 1000.f), kRoute, X0, Y0 + Size + 30.f * Scale, Font, 0.9f * Scale);
}

void AUB6HUD::DrawStatus(float Scale, float Left, float Bottom)
{
	UFont* Font = GEngine->GetMediumFont();
	APawn* Pawn = GetOwningPawn();
	const UUB6CityStreamingSubsystem* City = GetWorld()->GetSubsystem<UUB6CityStreamingSubsystem>();
	if (Pawn && City && !City->IsGroundReady(Pawn->GetActorLocation()))
	{
		DrawText(T(TEXT("hud.loading")), kWhite, Left, Bottom, Font, 1.2f * Scale);
		return;
	}
	if (const AUB6Vehicle* Car = Cast<AUB6Vehicle>(Pawn))
	{
		DrawText(FString::Printf(TEXT("%.0f km/h %s"), Car->GetSpeedKmh(), Car->IsReversing() ? TEXT("R") : TEXT("D")), kWhite, Left, Bottom, Font, 1.8f * Scale);
		DrawText(FString::Printf(TEXT("%s %.0f%%"), *T(TEXT("hud.fuel")), Car->GetFuelFraction() * 100.f), Car->GetFuelFraction() < 0.1f ? kWarn : kDim, Left, Bottom + 44.f * Scale, Font, Scale);
	}
	else if (const AUB6Horse* Horse = Cast<AUB6Horse>(Pawn))
	{
		const FString GaitKey = FString::Printf(TEXT("gait.%d"), Horse->GetGait());
		DrawText(FString::Printf(TEXT("%s  %.0f km/h"), *UUB6Text::Get(GaitKey, bMongolian), Horse->GetSpeedKmh()), kWhite, Left, Bottom, Font, 1.5f * Scale);
		DrawText(FString::Printf(TEXT("%s %.0f%%"), *T(TEXT("hud.stamina")), Horse->GetStamina() * 100.f), Horse->GetStamina() < 0.15f ? kWarn : kDim, Left, Bottom + 40.f * Scale, Font, Scale);
	}
	else if (const AUB6Character* Me = Cast<AUB6Character>(Pawn))
	{
		if (const IUB6Interactable* Target = Me->FindInteractable())
		{
			const FString Prompt = UUB6Text::Get(Target->GetPromptKey(), bMongolian);
			float TW = 0, TH = 0;
			GetTextSize(Prompt, TW, TH, Font, 1.3f * Scale);
			DrawText(Prompt, kWhite, (Canvas->SizeX - TW) * 0.5f, Canvas->SizeY * 0.68f, Font, 1.3f * Scale);
		}
	}
}

void AUB6HUD::DrawTouchControls(float Scale)
{
	const AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetOwningPlayerController());
	// Shown on touch devices, and on desktop once a touch has been seen (touch emulation).
	if (!PC || !(FPlatformMisc::SupportsTouchInput() || PC->IsTouchActive())) return;
	const ub6::TouchControls& Touch = PC->GetTouch();
	UFont* Font = GEngine->GetMediumFont();
	const FUB6Input& In = PC->GetUB6Input();

	const bool bStick = !(Touch.mode() == ub6::ControlMode::Driving && Touch.layout().steerWithButtons);
	if (bStick)
	{
		double BX, BY, KX, KY, Radius;
		Touch.stickVisual(BX, BY, KX, KY, Radius);
		const float R = static_cast<float>(Radius);
		Outline(static_cast<float>(BX) - R, static_cast<float>(BY) - R, R * 2, R * 2, kDim, 2.f * Scale);
		const float Knob = R * 0.45f;
		DrawRect(FLinearColor(1.f, 1.f, 1.f, 0.35f), static_cast<float>(BX + KX) - Knob * 0.5f, static_cast<float>(BY + KY) - Knob * 0.5f, Knob, Knob);
	}
	for (int32 B = 0; B < ub6::kTouchButtonCount; ++B)
	{
		const ub6::TouchButton Button = static_cast<ub6::TouchButton>(B);
		if (!ub6::TouchControls::buttonInMode(Button, Touch.mode(), Touch.layout())) continue;
		const ub6::ScreenRect R = Touch.buttonRect(Button);
		const float X = static_cast<float>(R.x), Y = static_cast<float>(R.y), W = static_cast<float>(R.w), H = static_cast<float>(R.h);
		bool bHeld = false;
		if (Button == ub6::TouchButton::Gas) bHeld = In.Throttle > 0.f; else if (Button == ub6::TouchButton::Brake) bHeld = In.Brake > 0.f;
		else if (Button == ub6::TouchButton::Jump) bHeld = In.bJump; else if (Button == ub6::TouchButton::Sprint) bHeld = In.bSprint;
		else if (Button == ub6::TouchButton::Handbrake) bHeld = In.bHandbrake;
		DrawRect(bHeld ? FLinearColor(1.f, 1.f, 1.f, 0.35f) : kPanel, X, Y, W, H);
		Outline(X, Y, W, H, kDim, 2.f * Scale);
		const FString Label = T(ButtonKey(Button));
		float TW = 0, TH = 0;
		const float TextScale = 0.85f * Scale;
		GetTextSize(Label, TW, TH, Font, TextScale);
		DrawText(Label, kWhite, X + (W - TW) * 0.5f, Y + (H - TH) * 0.5f, Font, TextScale);
	}
}
