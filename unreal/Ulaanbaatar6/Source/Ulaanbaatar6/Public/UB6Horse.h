// HorseRidingSystem: rideable Mongolian horse driven by the unit-tested core HorseModel
// (walk / trot / gallop, stamina, feeding, slower on ice and snow).
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "UB6Interactable.h"
#include "ub6/Gameplay.h"
#include "UB6Horse.generated.h"

class USpringArmComponent;
class UCameraComponent;

UCLASS()
class ULAANBAATAR6_API AUB6Horse : public ACharacter, public IUB6Interactable
{
	GENERATED_BODY()
public:
	AUB6Horse();
	virtual void Tick(float DeltaSeconds) override;
	virtual FString GetPromptKey() const override { return TEXT("prompt.mount_horse"); }
	virtual void Interact(AUB6Character* By) override;

	UFUNCTION(BlueprintCallable, Category = "UB6|Horse") void Feed(float Amount) { Model.feed(Amount); }
	UFUNCTION(BlueprintPure, Category = "UB6|Horse") float GetStamina() const { return static_cast<float>(Model.stamina()); }
	UFUNCTION(BlueprintPure, Category = "UB6|Horse") float GetSpeedKmh() const { return static_cast<float>(Model.speedMs() * 3.6); }
	/** 0 halt, 1 walk, 2 trot, 3 gallop: drives the animation blend and hoof sounds. */
	UFUNCTION(BlueprintPure, Category = "UB6|Horse") int32 GetGait() const { return static_cast<int32>(Model.gait()); }

	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<USpringArmComponent> CameraBoom;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UCameraComponent> Camera;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UStaticMeshComponent> PlaceholderBody;
private:
	void Dismount();
	ub6::HorseModel Model;
	ub6::HorseGait Requested = ub6::HorseGait::Halt;
	UPROPERTY() TObjectPtr<AUB6Character> Rider;
	bool bPlaced = false;
};
