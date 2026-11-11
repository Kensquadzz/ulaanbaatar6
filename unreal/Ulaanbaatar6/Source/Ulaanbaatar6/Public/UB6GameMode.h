// Spawns the Phase 1 vertical slice: player at Sukhbaatar Square, a car beside the square,
// a horse at Zaisan, and a GPS route between them. Positions come from the pipeline's
// landmarks.json (real coordinates), not from hand-placed actors.
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "UB6GameMode.generated.h"

UCLASS()
class ULAANBAATAR6_API AUB6GameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	AUB6GameMode();
	virtual void StartPlay() override;
	virtual APawn* SpawnDefaultPawnAtTransform_Implementation(AController* NewPlayer, const FTransform& SpawnTransform) override;
};
