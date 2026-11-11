// Mongolian and English UI strings. A small built-in table keeps the HUD bilingual without
// any localisation assets; move to Unreal's localisation dashboard before release.
#pragma once
#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "UB6Text.generated.h"

UCLASS()
class ULAANBAATAR6_API UUB6Text : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()
public:
	UFUNCTION(BlueprintPure, Category = "UB6|Text") static FString Get(const FString& Key, bool bMongolian);
};
