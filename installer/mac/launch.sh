#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$(cd "$SCRIPT_DIR/../Resources" && pwd)"

NODE_BIN="$RESOURCES_DIR/node/bin/node"
BRIDGE="$RESOURCES_DIR/bridge/dist/index.js"

exec "$NODE_BIN" "$BRIDGE"