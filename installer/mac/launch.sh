#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/../Resources" && pwd)"

NODE_BIN="$RESOURCES_DIR/node/bin/node"
BRIDGE="$RESOURCES_DIR/bridge/dist/index.js"

echo "========== Scout Bridge =========="
echo "SCRIPT_DIR=$SCRIPT_DIR"
echo "RESOURCES_DIR=$RESOURCES_DIR"
echo "NODE_BIN=$NODE_BIN"
echo "BRIDGE=$BRIDGE"

echo
echo "Node version:"
"$NODE_BIN" -v

echo
echo "Starting bridge..."
exec "$NODE_BIN" "$BRIDGE"