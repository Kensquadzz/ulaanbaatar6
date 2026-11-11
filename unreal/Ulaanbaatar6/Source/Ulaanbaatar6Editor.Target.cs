using UnrealBuildTool;

public class Ulaanbaatar6EditorTarget : TargetRules
{
	public Ulaanbaatar6EditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.AddRange(new string[] { "UB6Core", "Ulaanbaatar6" });
	}
}
