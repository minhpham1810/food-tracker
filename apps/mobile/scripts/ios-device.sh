#!/usr/bin/env bash
# Build the Release app and install it on a physical iPhone.
#
# Why not `expo run:ios`: it hardcodes COCOAPODS_PARALLEL_CODE_SIGN=true
# (expo/node_modules/@expo/cli/build/src/run/ios/XcodeBuild.js), and concurrent
# codesign calls fail with errSecInternalComponent here, leaving most embedded
# frameworks unsigned. CocoaPods backgrounds those codesign jobs and never checks
# their exit codes, so the build reports "Build Succeeded" and the install then
# fails with ApplicationVerificationFailed. Command-line build settings win over
# the project, so this cannot be fixed from app.json.
set -euo pipefail
cd "$(dirname "$0")/.."

# ponytail: defaults to the one phone this prototype is demoed on.
# export IOS_DEVICE=<udid> for another; `xcrun devicectl list devices` lists them.
DEVICE="${IOS_DEVICE:-00008130-000E683638C1401C}"
APP=ios/build/Build/Products/Release-iphoneos/FreshnessTracker.app

# -destination-timeout: xcodebuild gives up enumerating devices after 30s, and
# the wired CoreDevice tunnel to the phone often takes longer -- it then fails
# with "Unable to find a destination" while devicectl lists the phone connected.
xcodebuild \
  -workspace ios/FreshnessTracker.xcworkspace \
  -scheme FreshnessTracker \
  -configuration Release \
  -destination "id=$DEVICE" \
  -destination-timeout 120 \
  -derivedDataPath ios/build \
  -allowProvisioningUpdates \
  COCOAPODS_PARALLEL_CODE_SIGN=false \
  COMPILER_INDEX_STORE_ENABLE=NO

# Fail here rather than at install time if a framework slipped through unsigned.
for framework in "$APP"/Frameworks/*.framework; do
  codesign -dv "$framework" >/dev/null 2>&1 || {
    echo "unsigned framework: $framework" >&2
    exit 1
  }
done

xcrun devicectl device install app --device "$DEVICE" "$APP"
