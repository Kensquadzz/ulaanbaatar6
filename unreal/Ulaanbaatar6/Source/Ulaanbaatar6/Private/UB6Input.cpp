#include "UB6Input.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "Engine/LocalPlayer.h"
#include "GenericPlatform/GenericApplication.h"

AUB6PlayerController::AUB6PlayerController()
{
	bShowMouseCursor = false;
}

UInputAction* AUB6PlayerController::MakeAction(const TCHAR* Name, EInputActionValueType Type)
{
	UInputAction* A = NewObject<UInputAction>(this, FName(Name));
	A->ValueType = Type;
	return A;
}

void AUB6PlayerController::BeginPlay()
{
	Super::BeginPlay();
	if (const ULocalPlayer* LP = GetLocalPlayer())
	{
		if (UEnhancedInputLocalPlayerSubsystem* Sub = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
		{
			if (Mapping) Sub->AddMappingContext(Mapping, 0);
		}
	}
}

void AUB6PlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	MoveAction = MakeAction(TEXT("UB6Move"), EInputActionValueType::Axis2D);
	LookAction = MakeAction(TEXT("UB6Look"), EInputActionValueType::Axis2D);
	JumpAction = MakeAction(TEXT("UB6Jump"), EInputActionValueType::Boolean);
	SprintAction = MakeAction(TEXT("UB6Sprint"), EInputActionValueType::Boolean);
	InteractAction = MakeAction(TEXT("UB6Interact"), EInputActionValueType::Boolean);
	CameraAction = MakeAction(TEXT("UB6Camera"), EInputActionValueType::Boolean);
	ReverseAction = MakeAction(TEXT("UB6Reverse"), EInputActionValueType::Boolean);
	CrouchAction = MakeAction(TEXT("UB6Crouch"), EInputActionValueType::Boolean);

	Mapping = NewObject<UInputMappingContext>(this, TEXT("UB6Mapping"));
	auto MapAxis = [this](UInputAction* Action, FKey Key, bool bToY, bool bNegate)
	{
		FEnhancedActionKeyMapping& M = Mapping->MapKey(Action, Key);
		if (bToY)
		{
			UInputModifierSwizzleAxis* Swizzle = NewObject<UInputModifierSwizzleAxis>(this);
			Swizzle->Order = EInputAxisSwizzle::YXZ;
			M.Modifiers.Add(Swizzle);
		}
		if (bNegate) M.Modifiers.Add(NewObject<UInputModifierNegate>(this));
	};
	MapAxis(MoveAction, EKeys::W, true, false);
	MapAxis(MoveAction, EKeys::S, true, true);
	MapAxis(MoveAction, EKeys::D, false, false);
	MapAxis(MoveAction, EKeys::A, false, true);
	Mapping->MapKey(MoveAction, EKeys::Gamepad_Left2D);
	Mapping->MapKey(LookAction, EKeys::Mouse2D);
	Mapping->MapKey(LookAction, EKeys::Gamepad_Right2D);
	Mapping->MapKey(JumpAction, EKeys::SpaceBar);
	Mapping->MapKey(JumpAction, EKeys::Gamepad_FaceButton_Bottom);
	Mapping->MapKey(SprintAction, EKeys::LeftShift);
	Mapping->MapKey(SprintAction, EKeys::Gamepad_LeftThumbstick);
	Mapping->MapKey(InteractAction, EKeys::E);
	Mapping->MapKey(InteractAction, EKeys::Gamepad_FaceButton_Top);
	Mapping->MapKey(CameraAction, EKeys::C);
	Mapping->MapKey(ReverseAction, EKeys::R);
	Mapping->MapKey(CrouchAction, EKeys::LeftControl);

	if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent))
	{
		EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AUB6PlayerController::OnMove);
		EIC->BindAction(MoveAction, ETriggerEvent::Completed, this, &AUB6PlayerController::OnMoveEnd);
		EIC->BindAction(LookAction, ETriggerEvent::Triggered, this, &AUB6PlayerController::OnLook);
		EIC->BindAction(JumpAction, ETriggerEvent::Triggered, this, &AUB6PlayerController::OnJump);
		EIC->BindAction(JumpAction, ETriggerEvent::Completed, this, &AUB6PlayerController::OnJump);
		EIC->BindAction(SprintAction, ETriggerEvent::Triggered, this, &AUB6PlayerController::OnSprint);
		EIC->BindAction(SprintAction, ETriggerEvent::Completed, this, &AUB6PlayerController::OnSprint);
		EIC->BindAction(InteractAction, ETriggerEvent::Started, this, &AUB6PlayerController::OnInteract);
		EIC->BindAction(CameraAction, ETriggerEvent::Started, this, &AUB6PlayerController::OnCamera);
		EIC->BindAction(ReverseAction, ETriggerEvent::Started, this, &AUB6PlayerController::OnReverse);
		EIC->BindAction(CrouchAction, ETriggerEvent::Started, this, &AUB6PlayerController::OnCrouch);
	}
}

void AUB6PlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);

	// --- touch ---------------------------------------------------------------
	int32 SizeX = 0, SizeY = 0;
	GetViewportSize(SizeX, SizeY);
	ub6::SafeInsets Insets;
	FDisplayMetrics Metrics;
	FDisplayMetrics::RebuildDisplayMetrics(Metrics);
	// TitleSafePaddingSize: X left, Y top, Z right, W bottom, in pixels (notch, Dynamic Island, gesture bar).
	Insets.left = Metrics.TitleSafePaddingSize.X; Insets.top = Metrics.TitleSafePaddingSize.Y;
	Insets.right = Metrics.TitleSafePaddingSize.Z; Insets.bottom = Metrics.TitleSafePaddingSize.W;
	Touch.setScreen(FMath::Max(SizeX, 1), FMath::Max(SizeY, 1), Insets);

	std::vector<ub6::Finger> Fingers;
	for (int32 F = 0; F < 5; ++F)
	{
		float X = 0, Y = 0; bool bDown = false;
		GetInputTouchState(static_cast<ETouchIndex::Type>(F), X, Y, bDown);
		if (bDown) { Fingers.push_back({F, X, Y, true}); bTouchSeen = true; }
	}
	const ub6::TouchOutput T = Touch.update(Fingers);
	using B = ub6::TouchButton;

	// --- merge ---------------------------------------------------------------
	FUB6Input In;
	In.Move = FVector2D(FMath::Clamp(T.moveX + PadMove.X, -1.0, 1.0), FMath::Clamp(T.moveY + PadMove.Y, -1.0, 1.0));
	In.LookDeg = FVector2D(T.lookYawDeg + PadLook.X * 0.5, T.lookPitchDeg + PadLook.Y * 0.5);
	In.Steer = static_cast<float>(FMath::Clamp(T.steer + PadMove.X, -1.0, 1.0));
	In.Throttle = FMath::Max(T.isHeld(B::Gas) ? 1.f : 0.f, static_cast<float>(FMath::Max(PadMove.Y, 0.0)));
	In.Brake = FMath::Max(T.isHeld(B::Brake) ? 1.f : 0.f, static_cast<float>(FMath::Max(-PadMove.Y, 0.0)));
	In.bJump = T.isHeld(B::Jump) || bPadJump;
	In.bSprint = T.isHeld(B::Sprint) || bPadSprint;
	In.bHandbrake = T.isHeld(B::Handbrake) || bPadJump;
	In.bInteractPressed = T.wasPressed(B::Interact) || bPadInteract;
	In.bExitPressed = T.wasPressed(B::ExitVehicle) || T.wasPressed(B::Dismount) || bPadInteract;
	In.bCrouchPressed = T.wasPressed(B::Crouch) || bPadCrouch;
	In.bPhonePressed = T.wasPressed(B::Phone);
	In.bCameraPressed = T.wasPressed(B::Camera) || bPadCamera;
	In.bReversePressed = T.wasPressed(B::Reverse) || bPadReverse;
	In.bGaitUpPressed = T.wasPressed(B::GaitUp) || (bPadSprint && !Input.bSprint);
	In.bGaitDownPressed = T.wasPressed(B::GaitDown) || bPadCrouch;
	Input = In;
	PadLook = FVector2D::ZeroVector;
	bPadInteract = bPadCamera = bPadReverse = bPadCrouch = false;
}
