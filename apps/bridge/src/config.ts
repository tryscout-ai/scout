import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface BridgeConfig {
  serverUrl: string;
  apiKey: string;
  agentsDir: string;
}

const SCOUT_DIR = join(homedir(), ".scout");
const CONFIG_PATH = join(SCOUT_DIR, "config.json");

export function loadConfig(): BridgeConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }

  try {
    const config: BridgeConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

if (config.agentsDir.startsWith("~/")) {
  config.agentsDir = join(homedir(), config.agentsDir.slice(2));
}

return config;
  } catch {
    return null;
  }
}

export interface BridgeConfig {
  serverUrl: string;
  apiKey: string;
  agentsDir: string;
}

export function saveConfig(config: BridgeConfig) {
  if (!existsSync(SCOUT_DIR)) {
    mkdirSync(SCOUT_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getConfigPath() {
  return CONFIG_PATH;
}