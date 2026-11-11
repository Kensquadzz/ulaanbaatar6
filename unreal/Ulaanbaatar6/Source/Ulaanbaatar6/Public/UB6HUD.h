// UIManager (first pass): a code-drawn HUD so the game is fully usable on a phone before any
// UI art exists. It draws the LIVE panel, minimap with GPS route, vehicle/horse status and
// the touch controls from the same layout data that performs the hit tests.
// The premium UMG interface and smartphone menu replace this class later.
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "UB6HUD.generated.h"

UCLASS()
class ULAANBAATAR6_API AUB6HUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UB6") bool bMongolian = true;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "UB6") float MinimapRangeM = 300.f;
private:
	void DrawLivePanel(float Scale, float Left, float Top);
	void DrawMinimap(float Scale, float Right, float Top);
	void DrawTouchControls(float Scale);
	void DrawStatus(float Scale, float Left, float Bottom);
	void Outline(float X, float Y, float W, float H, const FLinearColor& Color, float Thickness);
	FString T(const TCHAR* Key) const;
};
