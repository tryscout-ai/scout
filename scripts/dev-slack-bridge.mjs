import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

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

function requireEnv(env, key) {
  const value = env[key] || process.env[key];
  if (!value) throw new Error(`Missing ${key} in apps/web/.env.local`);
  return value;
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const defaultHumanId = requireEnv(env, "SCOUT_SLACK_DEFAULT_HUMAN_ID");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const slug = `slack-agents-${defaultHumanId.substring(0, 8)}`;
  const { data: server, error: serverError } = await admin
    .from("servers")
    .select("id, name, slug")
    .eq("owner_id", defaultHumanId)
    .eq("slug", slug)
    .maybeSingle();

  if (serverError) throw new Error(serverError.message);
  if (!server) {
    throw new Error(
      `Could not find Slack server ${slug}. Connect Slack from /slack first.`
    );
  }

  const { data: keyRecord, error: keyError } = await admin
    .from("machine_keys")
    .select("key_value, created_at")
    .eq("server_id", server.id)
    .not("key_value", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (keyError) throw new Error(keyError.message);
  if (!keyRecord?.key_value) {
    throw new Error(`Could not find a Slack bridge key for ${server.name}.`);
  }

  const keyPrefix = createHash("sha256")
    .update(keyRecord.key_value)
    .digest("hex")
    .slice(0, 8);

  console.log(`Starting Slack bridge for ${server.name} (${server.slug})`);
  console.log(`Loaded bridge key hash prefix ${keyPrefix}; full key hidden.`);

  const child = spawn("pnpm", ["dev:bridge"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      ...env,
      SCOUT_API_KEY: keyRecord.key_value,
      SCOUT_SERVER_URL: process.env.SCOUT_SERVER_URL || "http://localhost:3000",
    },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
