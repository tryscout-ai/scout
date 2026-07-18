#!/usr/bin/env node
import { loadConfig, saveConfig } from "./config.js";
import { hostname, platform, arch } from "os";
import { Bridge } from "./bridge.js";
import { waitForPairing } from "./pairing-server.js";
import { registerStartup } from "./startup.js";
import os from "os";
import path from "path";

// Default server URL (can be overridden)
const DEFAULT_SERVER_URL = "https://tryscout.ai";

interface ConnectResponse {
  supabaseUrl: string;
  supabaseAnonKey: string;
  token: string;
  userId: string;
  serverId: string;
  serverName: string;
  agents: Array<{
    id: string;
    name: string;
    display_name: string;
    description: string | null;
    model: string;
    status: string;
  }>;
}

function parseArgs(): { serverUrl: string; apiKey: string; agentsDir: string } {
  const args = process.argv.slice(2);
  let serverUrl = DEFAULT_SERVER_URL;
  let apiKey = "";
  let agentsDir = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--server-url":
        serverUrl = args[++i] || "";
        break;
      case "--api-key":
        apiKey = args[++i] || "";
        break;
      case "--agents-dir":
        agentsDir = args[++i] || "";
        break;
      case "--help":
      case "-h":
        console.log(`
  Usage: scout-bridge [options]

  Options:
    --api-key <key>        Machine API key (required, generate at ${DEFAULT_SERVER_URL})
    --server-url <url>     Server URL (default: ${DEFAULT_SERVER_URL})
    --agents-dir <path>    Agent workspaces directory (default: ~/.scout/agents)
    -h, --help             Show this help message
`);
        process.exit(0);
    }
  }

  // Also support env vars as fallback (for local dev)
  if (!apiKey) apiKey = process.env.SCOUT_API_KEY || "";
  if (!serverUrl || serverUrl === DEFAULT_SERVER_URL) {
    serverUrl = process.env.SCOUT_SERVER_URL || serverUrl;
  }

  if (!agentsDir) {
    // agentsDir = (process.env.SCOUT_AGENTS_DIR || "~/.scout/agents").replace(
    //   "~",
    //   process.env.HOME || ""
    // );
    agentsDir =
  process.env.SCOUT_AGENTS_DIR ||
  path.join(os.homedir(), ".scout", "agents");
  }

  // if (!apiKey) {
  //   console.error("  Error: --api-key is required.");
  //   console.error("");
  //   console.error("  Generate one at your workspace settings page,");
  //   console.error("  then run:");
  //   console.error("");
  //   console.error("    npx @scout-ai/scout-bridge --api-key zk_your_key_here");
  //   console.error("");
  //   process.exit(1);
  // }

  return { serverUrl: serverUrl.replace(/\/+$/, ""), apiKey, agentsDir };
}

async function authenticate(
  serverUrl: string,
  apiKey: string
): Promise<ConnectResponse> {
  const res = await fetch(`${serverUrl}/api/bridge/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

async function runBridge(
  serverUrl: string,
  apiKey: string,
  agentsDir: string
) {
  console.log(`
  ╔══════════════════════════════════════╗
  ║         Scout Local Bridge           ║
  ╚══════════════════════════════════════╝
`);
  console.log(`  Server: ${serverUrl}`);
  console.log(`  Connecting...`);

  let creds: ConnectResponse;
  try {
    creds = await authenticate(serverUrl, apiKey);
  } catch (err) {
    console.error(
      `  Authentication failed: ${err instanceof Error ? err.message : err}`
    );
    throw err;
  }

  console.log(`  Authenticated as user ${creds.userId.substring(0, 8)}...`);
  console.log(`  Workspace: ${creds.serverName}`);
  console.log(
    `  Agents: ${
      creds.agents.map((a) => a.display_name).join(", ") || "none"
    }`
  );
  console.log(`  Agents dir: ${agentsDir}`);
  console.log("");

  const bridge = new Bridge({
    supabaseUrl: creds.supabaseUrl,
    supabaseKey: creds.supabaseAnonKey,
    authToken: creds.token,
    userId: creds.userId,
    serverId: creds.serverId,
    agentsDir,
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
  });

  bridge.start();

  return bridge;
}

async function main() {
  // const { serverUrl, apiKey, agentsDir } = parseArgs();
  const cli = parseArgs();

let config = loadConfig();

if (cli.apiKey) {
  config = {
    serverUrl: cli.serverUrl,
    apiKey: cli.apiKey,
    agentsDir: cli.agentsDir,
  };

  saveConfig(config);
}

if (!config) {
    console.log("Bridge not configured.");
    console.log("Waiting for pairing...");

    config = await waitForPairing();
    await runBridge(
    config.serverUrl,
    config.apiKey,
    config.agentsDir
);
    saveConfig(config);

}

const { serverUrl, apiKey, agentsDir } = config;

const bridge = await runBridge(serverUrl, apiKey, agentsDir);

await registerStartup();
  // Refresh auth token periodically (every 6 hours)
  const refreshInterval = setInterval(async () => {
    try {
      const fresh = await authenticate(serverUrl, apiKey);
      bridge.updateAuthToken(fresh.token);
      console.log("  Auth token refreshed.");
    } catch (err) {
      console.error(
        `  Token refresh failed: ${err instanceof Error ? err.message : err}`
      );
    }

    if (bridge) {
      bridge.stop();
      bridge = null;
    }
  };

  const startBridge = async (nextConfig: BridgeConfig) => {
    stopBridge();

    bridge = await runBridge(
      nextConfig.serverUrl,
      nextConfig.apiKey,
      nextConfig.agentsDir
    );

    await registerStartup();

    refreshInterval = setInterval(async () => {
      try {
        const fresh = await authenticate(nextConfig.serverUrl, nextConfig.apiKey);
        bridge?.updateAuthToken(fresh.token);
        console.log("  Auth token refreshed.");
      } catch (err) {
        console.error(
          `  Token refresh failed: ${err instanceof Error ? err.message : err}`
        );
      }
    }, 6 * 60 * 60 * 1000);
  };

  if (cli.apiKey) {
    config = {
      serverUrl: cli.serverUrl,
      apiKey: cli.apiKey,
      agentsDir: cli.agentsDir,
    };

    saveConfig(config);
  }

  let resolveInitialPairing: ((pairedConfig: BridgeConfig) => void) | null =
    null;
  const initialPairing = new Promise<BridgeConfig>((resolve) => {
    resolveInitialPairing = resolve;
  });

  try {
    await startPairingServer({
      isPaired: () => Boolean(config),
      onPair: async (pairedConfig) => {
        config = pairedConfig;
        resolveInitialPairing?.(pairedConfig);

        if (bridge) {
          await startBridge(pairedConfig);
        }
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Unable to start local pairing server: ${message}`);
    process.exit(1);
  }

  if (!config) {
    console.log("Bridge not configured.");
    console.log("Waiting for pairing from Scout web...");
    config = await initialPairing;
  }

  await startBridge(config);

  process.on("SIGINT", () => {
    console.log("\n  Shutting down bridge...");
    stopBridge();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    stopBridge();
    process.exit(0);
  });
  // Keep the packaged background app alive while the bridge and pairing server run.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
