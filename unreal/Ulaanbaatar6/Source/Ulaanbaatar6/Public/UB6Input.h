// MobileInputSystem (engine side). One input state for every pawn, filled from:
//  - touch, through the unit-tested core TouchControls (phones and tablets), and
//  - Enhanced Input actions created at runtime for keyboard/mouse/gamepad (editor testing,
//    controllers). No input assets are required to run the project.
#pragma once
#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "InputActionValue.h"
#include "ub6/TouchControls.h"
#include "UB6Input.generated.h"

class UInputAction;
class UInputMappingContext;

/** Per-frame game input, already merged across devices. */
struct FUB6Input
{
	FVector2D Move = FVector2D::ZeroVector;     // x right, y forward, -1..1
	FVector2D LookDeg = FVector2D::ZeroVector;  // yaw, pitch for this frame
	float Steer = 0, Throttle = 0, Brake = 0;
	bool bJump = false, bSprint = false, bCrouchPressed = false, bInteractPressed = false, bPhonePressed = false;
	bool bHandbrake = false, bReversePressed = false, bCameraPressed = false, bExitPressed = false;
	bool bGaitUpPressed = false, bGaitDownPressed = false;
};

UCLASS()
class ULAANBAATAR6_API AUB6PlayerController : public APlayerController
{
	GENERATED_BODY()
public:
	AUB6PlayerController();
	virtual void BeginPlay() override;
	virtual void SetupInputComponent() override;
	virtual void PlayerTick(float DeltaTime) override;

	const FUB6Input& GetUB6Input() const { return Input; }
	void SetControlMode(ub6::ControlMode Mode) { Touch.setMode(Mode); }
	const ub6::TouchControls& GetTouch() const { return Touch; }
	/** Customised layout (saved by the settings screen). */
	void SetTouchLayout(const ub6::TouchLayout& Layout) { Touch.setLayout(Layout); }
	bool IsTouchActive() const { return bTouchSeen; }

private:
	void OnMove(const FInputActionValue& V) { PadMove = V.Get<FVector2D>(); }
	void OnMoveEnd(const FInputActionValue&) { PadMove = FVector2D::ZeroVector; }
	void OnLook(const FInputActionValue& V) { PadLook += V.Get<FVector2D>(); }
	void OnJump(const FInputActionValue& V) { bPadJump = V.Get<bool>(); }
	void OnSprint(const FInputActionValue& V) { bPadSprint = V.Get<bool>(); }
	void OnInteract(const FInputActionValue&) { bPadInteract = true; }
	void OnCamera(const FInputActionValue&) { bPadCamera = true; }
	void OnReverse(const FInputActionValue&) { bPadReverse = true; }
	void OnCrouch(const FInputActionValue&) { bPadCrouch = true; }
	UInputAction* MakeAction(const TCHAR* Name, EInputActionValueType Type);

	UPROPERTY() TObjectPtr<UInputMappingContext> Mapping;
	UPROPERTY() TObjectPtr<UInputAction> MoveAction;
	UPROPERTY() TObjectPtr<UInputAction> LookAction;
	UPROPERTY() TObjectPtr<UInputAction> JumpAction;
	UPROPERTY() TObjectPtr<UInputAction> SprintAction;
	UPROPERTY() TObjectPtr<UInputAction> InteractAction;
	UPROPERTY() TObjectPtr<UInputAction> CameraAction;
	UPROPERTY() TObjectPtr<UInputAction> ReverseAction;
	UPROPERTY() TObjectPtr<UInputAction> CrouchAction;

	ub6::TouchControls Touch;
	FUB6Input Input;
	FVector2D PadMove = FVector2D::ZeroVector, PadLook = FVector2D::ZeroVector;
	bool bPadJump = false, bPadSprint = false, bPadInteract = false, bPadCamera = false, bPadReverse = false, bPadCrouch = false;
	bool bTouchSeen = false;
};
