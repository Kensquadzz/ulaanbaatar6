using UnrealBuildTool;

public class Ulaanbaatar6Target : TargetRules
{
	public Ulaanbaatar6Target(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "UB6Core", "Ulaanbaatar6" });
	}
}
