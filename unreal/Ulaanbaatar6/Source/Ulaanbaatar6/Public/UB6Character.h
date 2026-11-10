// CharacterController: the playable third-person character.
// Visuals are a placeholder until the Mongolian character meshes from the asset pipeline are
// imported; assign the skeletal mesh and animation blueprint on a Blueprint subclass.
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "UB6Character.generated.h"

class USpringArmComponent;
class UCameraComponent;
class IUB6Interactable;

UCLASS()
class ULAANBAATAR6_API AUB6Character : public ACharacter
{
	GENERATED_BODY()
public:
	AUB6Character();
	virtual void Tick(float DeltaSeconds) override;
	virtual void PossessedBy(AController* NewController) override;

	/** Nearest usable object in reach, or null. The HUD shows its prompt. */
	IUB6Interactable* FindInteractable() const;
	/** Hide/show and enable/disable when entering or leaving a vehicle or mounting a horse. */
	void SetEmbodied(bool bEmbodied);

	UPROPERTY(EditAnywhere, Category = "UB6") float WalkSpeed = 180.f;     // cm/s
	UPROPERTY(EditAnywhere, Category = "UB6") float RunSpeed = 380.f;
	UPROPERTY(EditAnywhere, Category = "UB6") float SprintSpeed = 620.f;
	UPROPERTY(EditAnywhere, Category = "UB6") float InteractReach = 350.f;

	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<USpringArmComponent> CameraBoom;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UCameraComponent> Camera;
	UPROPERTY(VisibleAnywhere, Category = "UB6") TObjectPtr<UStaticMeshComponent> PlaceholderBody;
private:
	bool bGrounded = false;
};
