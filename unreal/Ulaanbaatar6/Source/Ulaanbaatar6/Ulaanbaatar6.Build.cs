using UnrealBuildTool;

public class Ulaanbaatar6 : ModuleRules
{
	public Ulaanbaatar6(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] {
			"Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput", "UMG", "Slate", "SlateCore",
			"HTTP", "Json", "ChaosVehicles", "PhysicsCore", "ProceduralMeshComponent", "UB6Core"
		});
	}
}
