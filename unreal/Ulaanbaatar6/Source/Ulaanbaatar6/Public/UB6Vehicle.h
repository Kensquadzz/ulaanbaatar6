// VehicleSystem: drivable car using the unit-tested core VehicleModel (bicycle model with
// friction circle). Cheap enough for phones and for AI traffic. The body is a placeholder
// box until the original Prius-class model from the asset pipeline is imported; a Chaos
// wheeled-vehicle variant can replace this class once a rigged vehicle mesh exists.
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "UB6Interactable.h"
#include "ub6/Gameplay.h"
#include "ub6/Vehicle.h"
#include "UB6Vehicle.generated.h"

class UBoxComponent;
class USpringArmComponent;
class UCameraComponent;

UCLASS()
class ULAANBAATAR6_API AUB6Vehicle : public APawn, public IUB6Interactable
{
	GENERATED_BODY()
public:
	AUB6Vehicle();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual FString GetPromptKey() const override { return TEXT("prompt.enter_car"); }
	virtual void Interact(AUB6Character* By) override;

	UFUNCTION(BlueprintPure, Category = "UB6|Vehicle") float GetSpeedKmh() const { return static_cast<float>(FMath::Abs(Model.state().speedMs) * 3.6); }
	UFUNCTION(BlueprintPure, Category = "UB6|Vehicle") float GetFuelFraction() const { return static_cast<float>(Fuel.fraction()); }
	UFUNCTION(BlueprintPure, Category = "UB6|Vehicle") bool IsReversing() const { return bReverse; }
	UFUNCTION(BlueprintPure, Category = "UB6|Vehicle") float GetDamage() const { return Damage; }

	// State for lights, wipers and audio; meshes and effects bind to these in Blueprint.
	UPROPERTY(BlueprintReadOnly, Category = "UB6|Vehicle") bool bHeadlightsOn = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6|Vehicle") bool bBrakeLightsOn = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6|Vehicle") bool bWipersOn = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6|Vehicle") bool bSliding = false;
	UPROPERTY(BlueprintReadOnly, Category = "UB6|Vehicle") bool bInteriorCamera = false;

	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UBoxComponent> Body;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UStaticMeshComponent> PlaceholderMesh;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<USpringArmComponent> CameraBoom;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UCameraComponent> Camera;
private:
	void ExitVehicle();
	void FollowGround(float DeltaSeconds);

	ub6::VehicleModel Model;
	ub6::FuelTank Fuel;
	UPROPERTY() TObjectPtr<AUB6Character> Driver;
	bool bReverse = false;
	float Damage = 0.f;          // 0 new .. 1 wrecked
	bool bPlaced = false;
};
