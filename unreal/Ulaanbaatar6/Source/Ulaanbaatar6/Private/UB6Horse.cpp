#include "UB6Horse.h"
#include "UB6Character.h"
#include "UB6CityStreaming.h"
#include "UB6Geo.h"
#include "UB6Input.h"
#include "UB6LiveWorld.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "UObject/ConstructorHelpers.h"

AUB6Horse::AUB6Horse()
{
	PrimaryActorTick.bCanEverTick = true;
	// Mongolian horses stand about 1.3-1.4 m at the withers.
	GetCapsuleComponent()->InitCapsuleSize(55.f, 80.f);
	GetCapsuleComponent()->SetCollisionObjectType(ECC_Pawn);
	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = false;
	Move->MaxAcceleration = 600.f;
	Move->BrakingDecelerationWalking = 800.f;
	Move->MaxStepHeight = 55.f;
	Move->SetWalkableFloorAngle(50.f);          // hill and mountain slopes around Zaisan
	Move->JumpZVelocity = 480.f;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 520.f;
	CameraBoom->SocketOffset = FVector(0.f, 0.f, 140.f);
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->bEnableCameraLag = true;
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom);

	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(RootComponent);
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderBody->SetRelativeScale3D(FVector(1.9f, 0.6f, 1.3f));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Cube.Succeeded()) PlaceholderBody->SetStaticMesh(Cube.Object);
}

void AUB6Horse::Interact(AUB6Character* By)
{
	if (Rider || !By) return;
	AUB6PlayerController* PC = Cast<AUB6PlayerController>(By->GetController());
	if (!PC) return;
	Rider = By;
	By->SetEmbodied(false);       // replaced by a mounted-rider pose once character art exists
	By->AttachToActor(this, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
	PC->SetControlRotation(GetActorRotation());
	PC->Possess(this);
	PC->SetControlMode(ub6::ControlMode::Riding);
	Requested = ub6::HorseGait::Halt;
}

void AUB6Horse::Dismount()
{
	AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetController());
	if (!PC || !Rider || Model.speedMs() > 2.5) return;      // slow to a walk first
	AUB6Character* Who = Rider;
	Rider = nullptr;
	Requested = ub6::HorseGait::Halt;
	Who->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
	// Mongolian riders mount and dismount on the horse's left side.
	Who->SetActorLocation(GetActorLocation() - GetActorRightVector() * 130.f + FVector(0, 0, 30.f), false, nullptr, ETeleportType::TeleportPhysics);
	Who->SetEmbodied(true);
	PC->Possess(Who);
}

void AUB6Horse::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bPlaced)
	{
		const UUB6CityStreamingSubsystem* City = GetWorld()->GetSubsystem<UUB6CityStreamingSubsystem>();
		if (!City || !City->IsGroundReady(GetActorLocation()) || !UUB6GeoSubsystem::SnapToGround(this, 100.f)) { GetCharacterMovement()->SetMovementMode(MOVE_None); return; }
		GetCharacterMovement()->SetMovementMode(MOVE_Walking);
		bPlaced = true;
	}

	double Steer = 0;
	if (const AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetController()))
	{
		const FUB6Input& In = PC->GetUB6Input();
		int32 G = static_cast<int32>(Requested);
		if (In.bGaitUpPressed) G = FMath::Min(G + 1, 3);
		if (In.bGaitDownPressed) G = FMath::Max(G - 1, 0);
		Requested = static_cast<ub6::HorseGait>(G);
		Steer = FMath::Abs(In.Steer) > 0.01f ? In.Steer : In.Move.X;
		AddControllerYawInput(static_cast<float>(In.LookDeg.X));
		AddControllerPitchInput(static_cast<float>(-In.LookDeg.Y));
		if (In.bJump && Model.speedMs() > 3.0) Jump(); else StopJumping();
		if (In.bExitPressed) { Dismount(); return; }
	}
	else
	{
		Requested = ub6::HorseGait::Halt;      // riderless horses stand; grazing/roaming AI comes later
	}

	const UGameInstance* GI = GetGameInstance();
	const UUB6LiveWorldSubsystem* Live = GI ? GI->GetSubsystem<UUB6LiveWorldSubsystem>() : nullptr;
	Model.requestGait(Requested);
	const double YawDelta = Model.update(DeltaSeconds, Steer, Live ? Live->GetState().TireFriction : 1.0);
	AddActorWorldRotation(FRotator(0.0, YawDelta, 0.0));
	GetCharacterMovement()->MaxWalkSpeed = static_cast<float>(FMath::Max(Model.speedMs(), 0.0) * 100.0);
	if (Model.speedMs() > 0.05) AddMovementInput(GetActorForwardVector(), 1.f);
}
