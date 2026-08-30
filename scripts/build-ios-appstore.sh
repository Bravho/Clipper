#!/bin/bash
#
# Archive + export + upload the RClipper iOS shell to App Store Connect.
#
#   bash scripts/build-ios-appstore.sh            # uses CURRENT_PROJECT_VERSION from the pbxproj
#   bash scripts/build-ios-appstore.sh 13         # bumps CURRENT_PROJECT_VERSION to 13 first
#   NO_UPLOAD=1 bash scripts/build-ios-appstore.sh   # archive + export only, no upload
#
# macOS + Xcode only. Must be run from the repo root on a machine signed in to
# the Apple Developer account for team F47AYL2ZMB.
#
# Note: RClipper's iOS app is a WebView shell that loads https://app.rclipper.com.
# Web/UI changes ship by deploying the Next.js server, NOT by this script. Only
# native changes (Capacitor plugins, Info.plist, entitlements, icons) need a new
# binary — plus a build-number bump whenever App Store Connect needs a fresh one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
OUT="artifacts/app-store"

if [ "${1:-}" != "" ]; then
  echo "==> Setting CURRENT_PROJECT_VERSION to $1"
  /usr/bin/sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $1;/g" "$PBXPROJ"
fi

BUILD="$(grep -m1 -o 'CURRENT_PROJECT_VERSION = [0-9]*;' "$PBXPROJ" | grep -o '[0-9][0-9]*')"
VERSION="$(grep -m1 -o 'MARKETING_VERSION = [0-9.]*;' "$PBXPROJ" | grep -o '[0-9][0-9.]*' | sed 's/\.$//')"
ARCHIVE="$OUT/RClipper-$VERSION-$BUILD.xcarchive"

echo "==> RClipper $VERSION (build $BUILD)"

echo "==> Capacitor sync"
npx cap sync ios

echo "==> pod install"
( cd ios/App && pod install )

echo "==> Archiving -> $ARCHIVE"
rm -rf "$ARCHIVE"
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates

ARCHIVED_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleVersion' "$ARCHIVE/Info.plist")"
ARCHIVED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :ApplicationProperties:CFBundleShortVersionString' "$ARCHIVE/Info.plist")"
echo "==> Archive reports $ARCHIVED_VERSION ($ARCHIVED_BUILD)"
if [ "$ARCHIVED_BUILD" != "$BUILD" ]; then
  echo "!! Archive build number ($ARCHIVED_BUILD) does not match the pbxproj ($BUILD). Stopping." >&2
  exit 1
fi

echo "==> Exporting .ipa -> $OUT/build$BUILD-export"
rm -rf "$OUT/build$BUILD-export"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OUT/ExportOptions-build11.plist" \
  -exportPath "$OUT/build$BUILD-export" \
  -allowProvisioningUpdates

if [ "${NO_UPLOAD:-}" = "1" ]; then
  echo "==> NO_UPLOAD=1 set — skipping upload. IPA: $OUT/build$BUILD-export/App.ipa"
  exit 0
fi

echo "==> Uploading to App Store Connect"
rm -rf "$OUT/build$BUILD-upload"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OUT/build12-upload-options.plist" \
  -exportPath "$OUT/build$BUILD-upload" \
  -allowProvisioningUpdates

echo "==> Done. RClipper $VERSION ($BUILD) uploaded."
echo "    It takes ~5-15 min to finish processing in App Store Connect."
