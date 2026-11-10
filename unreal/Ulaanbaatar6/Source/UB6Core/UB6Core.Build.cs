using System.IO;
using UnrealBuildTool;

// Wraps the engine-independent core (repo /core) so the exact code that is unit-tested
// on desktop CI is what ships in the game. No Unreal types are used inside it.
public class UB6Core : ModuleRules
{
	public UB6Core(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.NoPCHs;
		bUseUnity = false;
		CppStandard = CppStandardVersion.Cpp20;
		PublicDependencyModuleNames.Add("Core");
		string CoreRoot = Path.GetFullPath(Path.Combine(ModuleDirectory, "..", "..", "..", "..", "core"));
		PublicIncludePaths.Add(Path.Combine(CoreRoot, "include"));
		PrivateIncludePaths.Add(Path.Combine(CoreRoot, "src"));
	}
}
