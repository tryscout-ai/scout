#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/../Resources" && pwd)"
LOG_DIR="$HOME/Library/Logs/Scout Bridge"
mkdir -p "$LOG_DIR"

case "$(uname -m)" in
  arm64)
    NODE_PLATFORM="darwin-arm64"
    ;;
  x86_64)
    NODE_PLATFORM="darwin-x64"
    ;;
  *)
    echo "Unsupported Mac architecture: $(uname -m)" >> "$LOG_DIR/bridge-error.log"
    exit 1
    ;;
esac

NODE_BIN="$RESOURCES_DIR/node/$NODE_PLATFORM/bin/node"
BRIDGE="$RESOURCES_DIR/bridge/dist/index.js"

if [ ! -x "$NODE_BIN" ]; then
  echo "Missing bundled Node runtime for $NODE_PLATFORM at $NODE_BIN" >> "$LOG_DIR/bridge-error.log"
  exit 1
fi

if [ ! -f "$BRIDGE" ]; then
  echo "Missing Scout Bridge entrypoint at $BRIDGE" >> "$LOG_DIR/bridge-error.log"
  exit 1
fi

{
  echo "========== Scout Bridge =========="
  echo "SCRIPT_DIR=$SCRIPT_DIR"
  echo "RESOURCES_DIR=$RESOURCES_DIR"
  echo "NODE_BIN=$NODE_BIN"
  echo "BRIDGE=$BRIDGE"
  echo "LOG_DIR=$LOG_DIR"
  echo
  echo "Node version:"
  "$NODE_BIN" -v
  echo
  echo "Starting bridge..."
} >> "$LOG_DIR/bridge.log" 2>> "$LOG_DIR/bridge-error.log"

exec "$NODE_BIN" "$BRIDGE" >> "$LOG_DIR/bridge.log" 2>> "$LOG_DIR/bridge-error.log"
