#!/usr/bin/env bash
# Android APK + AAB build. Run on a machine with Unreal Engine 5.5, Android Studio SDK/NDK
# and JDK set up as in Epic's "Android development requirements" for your engine version.
#   UE_ROOT=/path/to/UE_5.5 ./scripts/build_android.sh [Development|Shipping]
# NOT yet run: this script has never produced a build. Report the first failure back.
set -euo pipefail
: "${UE_ROOT:?Set UE_ROOT to your Unreal Engine folder}"
CONFIG="${1:-Development}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/sync_data.sh"
"$UE_ROOT/Engine/Build/BatchFiles/RunUAT.sh" BuildCookRun \
  -project="$ROOT/unreal/Ulaanbaatar6/Ulaanbaatar6.uproject" \
  -platform=Android -cookflavor=ASTC -clientconfig="$CONFIG" \
  -build -cook -stage -pak -iostore -package -archive \
  -archivedirectory="$ROOT/build/Android/$CONFIG" -nop4 -utf8output
echo "Output: $ROOT/build/Android/$CONFIG (APK and AAB)"
