#include "UB6Vehicle.h"
#include "UB6Character.h"
#include "UB6CityStreaming.h"
#include "UB6Geo.h"
#include "UB6Input.h"
#include "UB6LiveWorld.h"
#include "Camera/CameraComponent.h"
#include "Components/BoxComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/GameInstance.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/SpringArmComponent.h"
#include "UObject/ConstructorHelpers.h"

AUB6Vehicle::AUB6Vehicle()
{
	PrimaryActorTick.bCanEverTick = true;
	// 4.5 x 1.75 x 1.45 m hatchback envelope.
	Body = CreateDefaultSubobject<UBoxComponent>(TEXT("Body"));
	Body->SetBoxExtent(FVector(225.f, 87.f, 60.f));
	Body->SetCollisionProfileName(TEXT("Vehicle"));
	RootComponent = Body;

	PlaceholderMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderMesh"));
	PlaceholderMesh->SetupAttachment(RootComponent);
	PlaceholderMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderMesh->SetRelativeScale3D(FVector(4.5f, 1.75f, 1.2f));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Cube.Succeeded()) PlaceholderMesh->SetStaticMesh(Cube.Object);

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 650.f;
	CameraBoom->SetRelativeRotation(FRotator(-12.f, 0.f, 0.f));
	CameraBoom->SocketOffset = FVector(0.f, 0.f, 120.f);
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraRotationLagSpeed = 6.f;
	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(CameraBoom);
}

void AUB6Vehicle::BeginPlay()
{
	Super::BeginPlay();
	double E, N, U;
	UUB6GeoSubsystem::WorldToEnu(GetActorLocation(), E, N, U);
	Model.state().x = E; Model.state().y = N;
	// Unreal yaw 0 faces +X (east); compass heading 0 faces north.
	Model.state().headingRad = FMath::DegreesToRadians(GetActorRotation().Yaw + 90.0);
}

void AUB6Vehicle::Interact(AUB6Character* By)
{
	if (Driver || !By) return;
	AUB6PlayerController* PC = Cast<AUB6PlayerController>(By->GetController());
	if (!PC) return;
	Driver = By;
	By->SetEmbodied(false);
	By->AttachToActor(this, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
	PC->Possess(this);
	PC->SetControlMode(ub6::ControlMode::Driving);
}

void AUB6Vehicle::ExitVehicle()
{
	AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetController());
	if (!PC || !Driver || FMath::Abs(Model.state().speedMs) > 1.5) return;   // must be nearly stopped
	AUB6Character* Who = Driver;
	Driver = nullptr;
	Who->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
	// Step out on the left side of the car.
	Who->SetActorLocation(GetActorLocation() - GetActorRightVector() * 190.f + FVector(0, 0, 60.f), false, nullptr, ETeleportType::TeleportPhysics);
	Who->SetEmbodied(true);
	PC->Possess(Who);
}

void AUB6Vehicle::FollowGround(float DeltaSeconds)
{
	// Three cheap line traces give height, pitch and roll: no per-wheel rigid bodies.
	const FVector F = GetActorForwardVector(), R = GetActorRightVector(), P = GetActorLocation();
	auto Ground = [this](const FVector& At, double& Z) -> bool
	{
		FHitResult Hit;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(UB6VehicleGround), false, this);
		if (!GetWorld()->LineTraceSingleByChannel(Hit, At + FVector(0, 0, 300.f), At - FVector(0, 0, 2000.f), ECC_WorldStatic, Params)) return false;
		Z = Hit.Location.Z;
		return true;
	};
	double ZF, ZBL, ZBR;
	if (!Ground(P + F * 135.f, ZF) || !Ground(P - F * 135.f - R * 75.f, ZBL) || !Ground(P - F * 135.f + R * 75.f, ZBR)) return;
	const double ZB = 0.5 * (ZBL + ZBR);
	const double TargetZ = 0.5 * (ZF + ZB) + 75.0;      // box centre above ground (wheel radius + half body)
	const double Pitch = FMath::RadiansToDegrees(FMath::Atan2(ZF - ZB, 270.0));
	const double Roll = FMath::RadiansToDegrees(FMath::Atan2(ZBL - ZBR, 150.0));
	FVector NewLoc = P; NewLoc.Z = FMath::FInterpTo(P.Z, TargetZ, DeltaSeconds, 12.f);
	FRotator Rot = GetActorRotation();
	Rot.Pitch = FMath::FInterpTo(Rot.Pitch, Pitch, DeltaSeconds, 8.f);
	Rot.Roll = FMath::FInterpTo(Rot.Roll, Roll, DeltaSeconds, 8.f);
	SetActorLocationAndRotation(NewLoc, Rot, false, nullptr, ETeleportType::TeleportPhysics);
}

void AUB6Vehicle::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bPlaced)
	{
		const UUB6CityStreamingSubsystem* City = GetWorld()->GetSubsystem<UUB6CityStreamingSubsystem>();
		if (!City || !City->IsGroundReady(GetActorLocation()) || !UUB6GeoSubsystem::SnapToGround(this, 80.f)) return;
		bPlaced = true;
	}

	const UGameInstance* GI = GetGameInstance();
	const UUB6LiveWorldSubsystem* Live = GI ? GI->GetSubsystem<UUB6LiveWorldSubsystem>() : nullptr;
	const double Grip = Live ? Live->GetState().TireFriction : 1.0;

	ub6::VehicleInput In;
	In.reverse = bReverse;
	if (const AUB6PlayerController* PC = Cast<AUB6PlayerController>(GetController()))
	{
		const FUB6Input& I = PC->GetUB6Input();
		if (I.bReversePressed && FMath::Abs(Model.state().speedMs) < 1.0) bReverse = !bReverse;
		if (I.bCameraPressed)
		{
			bInteriorCamera = !bInteriorCamera;
			CameraBoom->TargetArmLength = bInteriorCamera ? 0.f : 650.f;
			CameraBoom->SocketOffset = bInteriorCamera ? FVector(20.f, -35.f, 55.f) : FVector(0.f, 0.f, 120.f);
		}
		In.throttle = I.Throttle; In.brake = I.Brake; In.steer = I.Steer; In.handbrake = I.bHandbrake; In.reverse = bReverse;
		if (I.bExitPressed) { ExitVehicle(); return; }
	}
	else
	{
		In.handbrake = true;        // parked
	}

	// Damage reduces drive; the model keeps running so a parked car still settles on slopes.
	In.throttle *= 1.0 - 0.6 * Damage;
	const double PrevX = Model.state().x, PrevY = Model.state().y;
	Model.update(DeltaSeconds, In, Grip, Fuel.levelL > 0);
	const double DX = Model.state().x - PrevX, DY = Model.state().y - PrevY;
	if (Driver) Fuel.consume(FMath::Sqrt(DX * DX + DY * DY), In.throttle, DeltaSeconds);

	// Move with a sweep so buildings and other cars stop us.
	FRotator Rot = GetActorRotation();
	Rot.Yaw = FMath::RadiansToDegrees(Model.state().headingRad) - 90.0;
	FHitResult Hit;
	SetActorRotation(Rot, ETeleportType::TeleportPhysics);
	AddActorWorldOffset(FVector(DX * 100.0, -DY * 100.0, 0.0), true, &Hit, ETeleportType::None);
	if (Hit.bBlockingHit && FMath::Abs(Hit.ImpactNormal.Z) < 0.6)
	{
		const double Impact = FMath::Abs(Model.state().speedMs);
		if (Impact > 3.0) Damage = FMath::Min(1.f, Damage + static_cast<float>(Impact / 120.0));
		Model.onImpact();
	}
	// Keep the model's position in step with what the sweep allowed.
	double E, N, U;
	UUB6GeoSubsystem::WorldToEnu(GetActorLocation(), E, N, U);
	Model.state().x = E; Model.state().y = N;
	FollowGround(DeltaSeconds);

	bSliding = Model.state().sliding;
	bBrakeLightsOn = In.brake > 0.05 || In.handbrake;
	if (Live)
	{
		bHeadlightsOn = Driver != nullptr && Live->GetState().bStreetLightsOn;
		bWipersOn = Driver != nullptr && Live->GetState().bWipersNeeded;
	}
}
