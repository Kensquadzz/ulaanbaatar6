#pragma once
#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "UB6Interactable.generated.h"

class AUB6Character;

UINTERFACE()
class UUB6Interactable : public UInterface { GENERATED_BODY() };

/** Anything the player can use with the Interact button: cars, horses, doors, shop counters. */
class ULAANBAATAR6_API IUB6Interactable
{
	GENERATED_BODY()
public:
	/** Localisation key shown on the Interact button, e.g. "prompt.enter_car". */
	virtual FString GetPromptKey() const = 0;
	virtual void Interact(AUB6Character* By) = 0;
};
