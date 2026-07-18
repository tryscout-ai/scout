#!/bin/bash

set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

APP_NAME="Scout Bridge"
APP_DIR="$ROOT/installer/mac/$APP_NAME.app"
DMG_NAME="ScoutBridge.dmg"

echo "Cleaning..."
rm -rf "$APP_DIR"
rm -f "$ROOT/apps/web/public/downloads/$DMG_NAME"

echo "Creating app bundle..."
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

cp -R "$ROOT/deploy/node" "$APP_DIR/Contents/Resources/"
cp -R "$ROOT/deploy/bridge" "$APP_DIR/Contents/Resources/"

cp "$ROOT/installer/mac/launch.sh" "$APP_DIR/Contents/MacOS/$APP_NAME"
chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

cat > "$APP_DIR/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
"http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<<<<<<< HEAD
    <key>CFBundleExecutable</key>
    <string>Scout Bridge</string>

    <key>CFBundleIdentifier</key>
    <string>ai.scout.bridge</string>

    <key>CFBundleName</key>
    <string>Scout Bridge</string>

    <key>CFBundlePackageType</key>
    <string>APPL</string>

    <key>CFBundleVersion</key>
    <string>1.0</string>
=======
  <key>CFBundleExecutable</key>
  <string>Scout Bridge</string>
  <key>CFBundleIdentifier</key>
  <string>ai.scout.bridge</string>
  <key>CFBundleName</key>
  <string>Scout Bridge</string>
  <key>CFBundleDisplayName</key>
  <string>Scout Bridge</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.8</string>
  <key>CFBundleVersion</key>
  <string>0.2.8</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
>>>>>>> a8a7a71f1c3cefd70e00920e9b1ad769e0e84a08
</dict>
</plist>
EOF

<<<<<<< HEAD
echo "Installing LaunchAgent..."

mkdir -p "$APP_DIR/Contents/Library/LaunchAgents"
cp "$ROOT/installer/mac/scout-bridge.plist" \
   "$APP_DIR/Contents/Library/LaunchAgents/"

echo "Creating DMG..."

hdiutil create \
  -volname "Scout Bridge" \
  -srcfolder "$APP_DIR" \
  -ov \
  -format UDZO \
  "$ROOT/apps/web/public/downloads/$DMG_NAME"

echo ""
echo "✅ ScoutBridge.dmg created:"
echo "$ROOT/apps/web/public/downloads/$DMG_NAME"
=======
if [ -n "$SIGNING_IDENTITY" ]; then
  echo "Signing app bundle..."
  find "$APP_DIR/Contents/Resources/node" -type f -name node -exec codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$SIGNING_IDENTITY" \
    {} \;
  sign_path "$APP_DIR"
fi

echo "Creating DMG layout..."
mkdir -p "$STAGE_DIR"
cp -R "$APP_DIR" "$STAGE_DIR/$APP_NAME.app"
ln -s /Applications "$STAGE_DIR/Applications"

echo "Creating DMG..."
hdiutil create \
  -volname "Scout Bridge" \
  -srcfolder "$STAGE_DIR" \
  -ov \
  -format UDZO \
  "$DMG_TMP_PATH"

mv "$DMG_TMP_PATH" "$DMG_PATH"

if [ -n "$SIGNING_IDENTITY" ]; then
  echo "Signing DMG..."
  sign_path "$DMG_PATH"
fi

if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
  echo "Submitting DMG for notarization..."
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --wait
  xcrun stapler staple "$DMG_PATH"
else
  echo "Skipping notarization. Set APPLE_ID, APPLE_TEAM_ID, and APPLE_APP_SPECIFIC_PASSWORD to notarize."
fi

echo ""
echo "ScoutBridge.dmg created:"
echo "$DMG_PATH"
>>>>>>> a8a7a71f1c3cefd70e00920e9b1ad769e0e84a08
