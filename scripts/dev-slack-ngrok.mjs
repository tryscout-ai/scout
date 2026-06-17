import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const envFile = new URL("../apps/web/.env.local", import.meta.url);

function loadEnv() {
  const env = {};
  const file = readFileSync(envFile, "utf8");

  for (const line of file.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

const appUrl = loadEnv().NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
if (!appUrl) {
  console.error("Missing NEXT_PUBLIC_APP_URL in apps/web/.env.local");
  process.exit(1);
}

const hostname = new URL(appUrl).hostname;
console.log(`Starting ngrok tunnel ${hostname} -> http://localhost:3000`);

const child = spawn("ngrok", ["http", `--url=${hostname}`, "3000"], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
