#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SCOUT_SUPABASE_SERVICE_ROLE_KEY;
const serverUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.SCOUT_SERVER_URL || "").replace(/\/+$/, "");
const agentsRoot = process.env.SCOUT_HOSTED_AGENTS_DIR || join(homedir(), ".scout", "hosted-demo-agents");
const pollMs = Number(process.env.SCOUT_HOSTED_BRIDGE_POLL_MS || 30_000);

if (!supabaseUrl || !serviceRoleKey || !serverUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and NEXT_PUBLIC_APP_URL are required");
}

mkdirSync(agentsRoot, { recursive: true });

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const children = new Map();

async function loadSlackBridgeKeys() {
  const { data: workspaces, error } = await admin
    .from("slack_workspaces")
    .select("server_id, slack_team_name, updated_at")
    .eq("install_status", "connected")
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) throw new Error(error.message);
  const serverIds = Array.from(new Set((workspaces || []).map((workspace) => workspace.server_id).filter(Boolean)));
  if (serverIds.length === 0) return [];

  const { data: keys, error: keyError } = await admin
    .from("machine_keys")
    .select("server_id, key_value, key_prefix")
    .in("server_id", serverIds)
    .eq("name", "Slack bridge");

  if (keyError) throw new Error(keyError.message);
  return (keys || []).filter((key) => key.key_value);
}

function startBridge(row) {
  if (children.has(row.server_id)) return;

  const agentsDir = join(agentsRoot, row.server_id);
  mkdirSync(agentsDir, { recursive: true });

  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@scout-ai/scout-bridge",
      "start",
      "--",
      "--server-url",
      serverUrl,
      "--api-key",
      row.key_value,
      "--agents-dir",
      agentsDir,
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        SCOUT_HOSTED_DEMO: "1",
        SCOUT_AGENTS_DIR: agentsDir,
      },
    }
  );

  children.set(row.server_id, child);
  console.log(`[hosted-demo] started bridge for ${row.server_id} (${row.key_prefix})`);

  child.on("exit", (code, signal) => {
    children.delete(row.server_id);
    console.log(`[hosted-demo] bridge for ${row.server_id} exited code=${code} signal=${signal || ""}`);
  });
}

async function reconcile() {
  try {
    const keys = await loadSlackBridgeKeys();
    for (const key of keys) startBridge(key);
  } catch (err) {
    console.error("[hosted-demo] reconcile failed:", err instanceof Error ? err.message : err);
  }
}

await reconcile();
setInterval(reconcile, pollMs);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children.values()) child.kill(signal);
    process.exit(0);
  });
}
