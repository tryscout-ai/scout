#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAC_DIR="$ROOT/installer/mac"
APP_NAME="Scout Bridge"
APP_DIR="$MAC_DIR/build/$APP_NAME.app"
STAGE_DIR="$MAC_DIR/build/dmg"
NODE_CACHE_DIR="$MAC_DIR/.cache/node"
DMG_NAME="ScoutBridge.dmg"
DMG_PATH="$ROOT/apps/web/public/downloads/$DMG_NAME"
NODE_VERSION="${NODE_VERSION:-$(node -p 'process.version')}"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

download_node() {
  local arch="$1"
  local platform="darwin-$arch"
  local archive="node-$NODE_VERSION-$platform.tar.xz"
  local url="https://nodejs.org/dist/$NODE_VERSION/$archive"
  local archive_path="$NODE_CACHE_DIR/$archive"
  local extract_dir="$NODE_CACHE_DIR/node-$NODE_VERSION-$platform"

  if [ ! -x "$extract_dir/bin/node" ]; then
    mkdir -p "$NODE_CACHE_DIR"

    if [ ! -f "$archive_path" ]; then
      echo "Downloading Node $NODE_VERSION for $platform..."
      curl -L "$url" -o "$archive_path"
    fi

    echo "Extracting Node $NODE_VERSION for $platform..."
    rm -rf "$extract_dir"
    tar -xJf "$archive_path" -C "$NODE_CACHE_DIR"
  fi

  mkdir -p "$APP_DIR/Contents/Resources/node/$platform"
  cp -R "$extract_dir/." "$APP_DIR/Contents/Resources/node/$platform/"
}

sign_path() {
  local path="$1"

  if [ -z "$SIGNING_IDENTITY" ]; then
    return
  fi

  codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$SIGNING_IDENTITY" \
    "$path"
}

echo "Cleaning Mac installer build..."
rm -rf "$MAC_DIR/build"
rm -f "$DMG_PATH"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

echo "Building bridge TypeScript..."
pnpm --filter @scout-ai/scout-bridge build

echo "Staging bridge runtime..."
mkdir -p "$APP_DIR/Contents/Resources/bridge"
cp -R "$ROOT/apps/bridge/dist" "$APP_DIR/Contents/Resources/bridge/dist"
cp "$ROOT/apps/bridge/package.json" "$APP_DIR/Contents/Resources/bridge/package.json"

(
  cd "$APP_DIR/Contents/Resources/bridge"
  npm install --omit=dev --ignore-scripts --package-lock=false
)

find "$APP_DIR/Contents/Resources/bridge" \
  -path "*/~/.scout" -prune -exec rm -rf {} +

download_node "arm64"
download_node "x64"

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
</dict>
</plist>
EOF

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
  "$DMG_PATH"

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
