#include "UB6Character.h"
#include "UB6CityStreaming.h"
#include "UB6Geo.h"
#include "UB6Input.h"
#include "UB6Interactable.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/OverlapResult.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "UObject/ConstructorHelpers.h"

AUB6Character::AUB6Character()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(34.f, 88.f);
	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 540.f, 0.f);
	Move->JumpZVelocity = 420.f;
	Move->AirControl = 0.25f;
	Move->MaxWalkSpeed = RunSpeed;
	Move->GetNavAgentPropertiesRef().bCanCrouch = true;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 380.f;
	CameraBoom->SocketOffset = FVector(0.f, 50.f, 70.f);
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->bEnableCameraLag = true;
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom);

	// Engine capsule-ish stand-in so the project runs before character art exists.
	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(RootComponent);
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderBody->SetRelativeScale3D(FVector(0.6f, 0.6f, 1.76f));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	if (Cylinder.Succeeded()) PlaceholderBody->SetStaticMesh(Cylinder.Object);
}

void AUB6Character::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);
	if (AUB6PlayerController* PC = Cast<AUB6PlayerController>(NewController)) PC->SetControlMode(ub6::ControlMode::OnFoot);
}

void AUB6Character::SetEmbodied(bool bEmbodied)
{
	SetActorHiddenInGame(!bEmbodied);
	SetActorEnableCollision(bEmbodied);
	GetCharacterMovement()->SetMovementMode(bEmbodied ? MOVE_Walking : MOVE_None);
}

IUB6Interactable* AUB6Character::FindInteractable() const
{
	TArray<FOverlapResult> Hits;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(UB6Interact), false, this);
	GetWorld()->OverlapMultiByObjectType(Hits, GetActorLocation(), FQuat::Identity,
		FCollisionObjectQueryParams(FCollisionObjectQueryParams::AllDynamicObjects), FCollisionShape::MakeSphere(InteractReach), Params);
	IUB6Interactable* Best = nullptr;
	double BestDist = TNumericLimits<double>::Max();
	for (const FOverlapResult& H : Hits)
	{
		AActor* A = H.GetActor();
		IUB6Interactable* I = Cast<IUB6Interactable>(A);
		if (!I) continue;
		const double D = FVector::DistSquared(A->GetActorLocation(), GetActorLocation());
		if (D < BestDist) { BestDist = D; Best = I; }
	}
	return Best;
}

void AUB6Character::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetController());
	if (!PC) return;

	// Wait for the streamed ground before letting gravity act, then drop onto it.
	if (!bGrounded)
	{
		const UUB6CityStreamingSubsystem* City = GetWorld()->GetSubsystem<UUB6CityStreamingSubsystem>();
		if (!City || !City->IsGroundReady(GetActorLocation())) { GetCharacterMovement()->SetMovementMode(MOVE_None); return; }
		if (UUB6GeoSubsystem::SnapToGround(this, 120.f))
		{
			GetCharacterMovement()->SetMovementMode(MOVE_Walking);
			bGrounded = true;
		}
		return;
	}

	const FUB6Input& In = PC->GetUB6Input();
	AddControllerYawInput(static_cast<float>(In.LookDeg.X));
	AddControllerPitchInput(static_cast<float>(-In.LookDeg.Y));

	const FRotator YawRot(0.f, GetControlRotation().Yaw, 0.f);
	const FVector Forward = FRotationMatrix(YawRot).GetUnitAxis(EAxis::X), Right = FRotationMatrix(YawRot).GetUnitAxis(EAxis::Y);
	AddMovementInput(Forward, static_cast<float>(In.Move.Y));
	AddMovementInput(Right, static_cast<float>(In.Move.X));
	// Stick deflection selects walk or run; the sprint button adds the top tier.
	const double Deflection = In.Move.Size();
	GetCharacterMovement()->MaxWalkSpeed = In.bSprint ? SprintSpeed : (Deflection < 0.5 ? WalkSpeed : RunSpeed);

	if (In.bJump) Jump(); else StopJumping();
	if (In.bCrouchPressed) { if (bIsCrouched) UnCrouch(); else Crouch(); }
	if (In.bInteractPressed)
	{
		if (IUB6Interactable* Target = FindInteractable()) Target->Interact(this);
	}
}
