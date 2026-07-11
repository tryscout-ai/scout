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
</dict>
</plist>
EOF

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