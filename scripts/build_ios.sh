#!/usr/bin/env bash
# iOS IPA build. Requires macOS, Xcode, Unreal Engine 5.5 and an Apple Developer account.
#   UE_ROOT=/Users/Shared/Epic\ Games/UE_5.5 IOS_TEAM_ID=XXXXXXXXXX ./scripts/build_ios.sh [Development|Shipping]
# Signing uses Xcode automatic signing with your team id; no certificates live in the repo.
# NOT yet run: this script has never produced a build. Report the first failure back.
set -euo pipefail
: "${UE_ROOT:?Set UE_ROOT to your Unreal Engine folder}"
: "${IOS_TEAM_ID:?Set IOS_TEAM_ID to your Apple Developer team id}"
[ "$(uname)" = "Darwin" ] || { echo "iOS builds need macOS with Xcode"; exit 1; }
CONFIG="${1:-Development}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/sync_data.sh"
"$UE_ROOT/Engine/Build/BatchFiles/RunUAT.sh" BuildCookRun \
  -project="$ROOT/unreal/Ulaanbaatar6/Ulaanbaatar6.uproject" \
  -platform=IOS -clientconfig="$CONFIG" \
  -build -cook -stage -pak -iostore -package -archive \
  -archivedirectory="$ROOT/build/IOS/$CONFIG" -nop4 -utf8output \
  -ini:Engine:[/Script/IOSRuntimeSettings.IOSRuntimeSettings]:IOSTeamID="$IOS_TEAM_ID" \
  -ini:Engine:[/Script/IOSRuntimeSettings.IOSRuntimeSettings]:bAutomaticSigning=True
echo "Output: $ROOT/build/IOS/$CONFIG (IPA). The Xcode workspace is generated under unreal/Ulaanbaatar6/Intermediate/ProjectFilesIOS."
