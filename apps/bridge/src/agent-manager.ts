import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, dirname, delimiter } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
import { spawn, ChildProcess } from "child_process";
import { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { normalizeLegacyBranding } from "./branding.js";
import {
  buildSystemPrompt,
  type WorkspaceContext,
} from "./system-prompt.js";
import { spawnSync } from "child_process";
import { LLMMessage, LLMProvider } from "./providers/llm-provider.js";

type AgentActivity = "idle" | "thinking" | "working" | "error";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ACTIVITY_HEARTBEAT_MS = 60_000; // Re-broadcast active state every 60s
const CODEX_TURN_TIMEOUT_MS = Number(process.env.SCOUT_CODEX_TURN_TIMEOUT_MS || 300_000);
const PROVIDER_TURN_TIMEOUT_MS = Number(process.env.SCOUT_PROVIDER_TURN_TIMEOUT_MS || 120_000);
const AGENT_RUNNER = (process.env.SCOUT_AGENT_RUNNER || "codex").toLowerCase();
const CODEX_COMMAND = process.env.SCOUT_CODEX_COMMAND || "codex";

interface AgentRecord {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
  status: string;
  server_id: string;
}

interface AgentSession {
  id: string;
  name: string;
  displayName: string;
  workDir: string;
  conversation: LLMMessage[];
}

interface QueuedMessage {
  userMessage: string;
  resolve: (value: string | void) => void;
  reject: (err: Error) => void;
}

interface AgentProcess {
  proc: ChildProcess;
  sessionId: string | null;
  busy: boolean;
  stopVersion: number;
  stopRequested: boolean;
  currentAbortController: AbortController | null;
  currentTurnProc: ChildProcess | null;
  stdoutBuffer: string;
  activity: AgentActivity;
  activityLabel: string;
  activityDetail: string;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  messageQueue: QueuedMessage[];
  /** Accumulated text content from assistant text events */
  pendingText: string;
  runner: "claude" | "codex";
}

export class AgentPausedError extends Error {
  constructor() {
    super("Agent paused");
    this.name = "AgentPausedError";
  }
}

function resolveExecutable(name: string) {
  if (process.platform === "win32") {
    return {
      command: `${name}.cmd`,
      argsPrefix: [],
    };
  }

  return {
    command: name,
    argsPrefix: [],
  };
}

function getLoginShellPath(prepend: string[] = []) {
  return [...prepend, process.env.PATH ?? ""].filter(Boolean).join(delimiter);
}

export class AgentManager {
  private sessions = new Map<string, AgentSession>();
  private processes = new Map<string, AgentProcess>();
  private agentsDir: string;
  private supabase: SupabaseClient;
  private supabaseUrl: string;
  private supabaseKey: string;
  private authToken: string;
  private activityChannel: RealtimeChannel;
  private readonly llmProvider: LLMProvider;
  private readonly defaultRunner: "claude" | "codex";

  constructor(
    agentsDir: string,
    supabase: SupabaseClient,
    supabaseUrl: string,
    supabaseKey: string,
    authToken: string = "",
    llmProvider: LLMProvider
  ) {
    this.agentsDir = agentsDir;
    this.supabase = supabase;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
    this.authToken = authToken;
    this.llmProvider = llmProvider;
    this.defaultRunner =
      AGENT_RUNNER === "claude"
        ? "claude"
        : "codex";

    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true });
    }

    // Set up Realtime Broadcast channel for agent activity
    this.activityChannel = this.supabase.channel("agent-activity", {
      config: { broadcast: { self: false } },
    });
    this.activityChannel.subscribe();
  }

  /** Update the Supabase client and auth token (called on token refresh) */
  updateSupabaseClient(supabase: SupabaseClient, authToken: string) {
    // Remove old activity channel
    this.supabase.removeChannel(this.activityChannel);

    this.supabase = supabase;
    this.authToken = authToken;

    // Re-subscribe activity channel on new client
    this.activityChannel = this.supabase.channel("agent-activity", {
      config: { broadcast: { self: false } },
    });
    this.activityChannel.subscribe();
  }

  /** Broadcast agent activity to all connected frontend clients */
  private broadcastActivity(
    agentId: string,
    activity: AgentActivity,
    label: string = "",
    detail: string = ""
  ) {
    const agentProc = this.processes.get(agentId);
    if (agentProc) {
      agentProc.activity = activity;
      agentProc.activityLabel = label;
      agentProc.activityDetail = detail;

      // Manage heartbeat: only active for thinking/working
      if (activity === "thinking" || activity === "working") {
        if (!agentProc.heartbeatTimer) {
          agentProc.heartbeatTimer = setInterval(() => {
            this.activityChannel.send({
              type: "broadcast",
              event: "activity",
              payload: {
                agentId,
                activity: agentProc.activity,
                label: agentProc.activityLabel,
                detail: agentProc.activityDetail,
              },
            });
          }, ACTIVITY_HEARTBEAT_MS);
        }
      } else {
        if (agentProc.heartbeatTimer) {
          clearInterval(agentProc.heartbeatTimer);
          agentProc.heartbeatTimer = null;
        }
      }
    }

    this.activityChannel.send({
      type: "broadcast",
      event: "activity",
      payload: { agentId, activity, label, detail },
    });
  }

  markIdle(agentId: string) {
    this.broadcastActivity(agentId, "idle", "Idle", "");
  }

  markError(agentId: string, message: string) {
    this.broadcastActivity(agentId, "error", "Error", message);
  }

  stopAgent(agentId: string): boolean {
    const agentProc = this.processes.get(agentId);
    if (!agentProc) return false;

    agentProc.stopRequested = true;
    agentProc.stopVersion += 1;

    for (const queued of agentProc.messageQueue) {
      queued.reject(new AgentPausedError());
    }
    agentProc.messageQueue = [];

    agentProc.currentAbortController?.abort();
    if (agentProc.currentTurnProc && !agentProc.currentTurnProc.killed) {
      agentProc.currentTurnProc.kill();
    }

    if (agentProc.runner === "claude" && !agentProc.proc.killed) {
      agentProc.proc.kill();
    }

    this.broadcastActivity(agentId, "idle", "Paused", "");
    return true;
  }

  getStopVersion(agentId: string): number {
    return this.processes.get(agentId)?.stopVersion ?? 0;
  }

  /**
   * Map a tool_use event to a human-readable label and detail string.
   * e.g. Read → ("Reading file", "/path/to/file")
   */
  private describeToolUse(contentBlock: any): { label: string; detail: string } {
    const toolName: string = contentBlock.name || "tool";
    const input = contentBlock.input || {};

    switch (toolName) {
      case "Read":
        return { label: "Reading file", detail: input.file_path || "" };

      case "Write":
        return { label: "Writing file", detail: input.file_path || "" };

      case "Edit":
        return { label: "Editing file", detail: input.file_path || "" };

      case "Bash": {
        const cmd: string = input.command || "";
        // Detect scout/slock message send
        const msgMatch = cmd.match(/(?:scout|slock)\s+message\s+send\s+--target\s+"?([^"]+)"?/);
        if (msgMatch) {
          return { label: "Sending message", detail: msgMatch[1] };
        }
        // Truncate long commands
        return { label: "Running command", detail: cmd.length > 120 ? cmd.substring(0, 120) + "…" : cmd };
      }

      case "Grep":
        return { label: "Searching", detail: input.pattern || "" };

      case "Glob":
        return { label: "Finding files", detail: input.pattern || "" };

      case "Agent":
        return { label: "Running agent", detail: input.description || "" };

      case "WebSearch":
        return { label: "Searching web", detail: input.query || "" };

      case "WebFetch":
        return { label: "Fetching URL", detail: input.url || "" };

      case "Skill":
        return { label: "Running skill", detail: input.skill || "" };

      case "TodoWrite":
        return { label: "Updating tasks", detail: "" };

      default:
        return { label: `Running ${toolName}`, detail: "" };
    }
  }

  private ensureCodexLoggedIn(env: NodeJS.ProcessEnv) {
    const status = spawnSync("cmd.exe", [
      "/d",
      "/s",
      "/c",
      "codex",
      "login",
      "status",
    ], {
      env,
      encoding: "utf8",
      windowsHide: true,
    });

    if (status.status === 0) {
      return;
    }

    console.log("Codex not logged in. Launching login...");

    const login = spawnSync("cmd.exe", [
      "/d",
      "/s",
      "/c",
      "codex",
      "login",
    ], {
      env,
      stdio: "inherit",
      windowsHide: false,
    });

    if (login.status !== 0) {
      throw new Error("Codex login failed.");
    }
  }

  /**
   * Flush accumulated assistant text as an activity broadcast.
   * Called before switching to a different activity type.
   */
  private flushPendingText(agentId: string, agentProc: AgentProcess) {
    if (!agentProc.pendingText) return;

    const text = agentProc.pendingText.trim();
    if (text) {
      this.broadcastActivity(agentId, "thinking", "", text);
    }
    agentProc.pendingText = "";
  }

  /** Save session ID to Supabase so it survives bridge restarts */
  private async saveSessionId(agentId: string, sessionId: string) {
    await this.supabase
      .from("agents")
      .update({ session_id: sessionId })
      .eq("id", agentId);
  }

  /** Load session ID from Supabase */
  private async loadSessionId(agentId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("agents")
      .select("session_id")
      .eq("id", agentId)
      .single();
    return data?.session_id || null;
  }

  private async loadWorkspaceContext(serverId: string): Promise<WorkspaceContext | null> {
    const { data, error } = await this.supabase
      .from("servers")
      .select("organization_summary, onboarding_completed_at")
      .eq("id", serverId)
      .single();

    if (error) {
      console.warn(`  [Bridge] Failed to load organization summary: ${error.message}`);
      return null;
    }

    const context = data as WorkspaceContext | null;
    if (context?.onboarding_completed_at && !context.organization_summary?.trim()) {
      console.warn(`  [Bridge] Organization summary missing for workspace ${serverId}.`);
    }

    return context;
  }

  async initAgent(agentId: string, agent: AgentRecord) {
    const workDir = join(this.agentsDir, agentId);

    // Create workspace if it doesn't exist
    if (!existsSync(workDir)) {
      mkdirSync(workDir, { recursive: true });
      mkdirSync(join(workDir, "notes"), { recursive: true });

      // Write initial MEMORY.md
      const memoryContent = `# ${agent.display_name}

## Role
${normalizeLegacyBranding(agent.description || agent.display_name)}

## Key Knowledge
- Organization context is supplied separately in the system prompt.

## Active Context
- Status: First startup — no prior conversations.
- Workspace initialized at: ${new Date().toISOString().split("T")[0]}
`;
      writeFileSync(join(workDir, "MEMORY.md"), memoryContent);
      console.log(`  [${agent.display_name}] Workspace created: ${workDir}`);
    } else {
      console.log(`  [${agent.display_name}] Workspace exists: ${workDir}`);
      this.migrateLegacyBrandingInMemory(join(workDir, "MEMORY.md"));
    }

    // Initialize session
    this.sessions.set(agentId, {
      id: agentId,
      name: agent.name,
      displayName: agent.display_name,
      workDir,
      conversation: [],
    });

    // Update workspace_path in DB
    await this.supabase
      .from("agents")
      .update({ workspace_path: workDir })
      .eq("id", agentId);
  }

  private migrateLegacyBrandingInMemory(memoryPath: string): string {
    if (!existsSync(memoryPath)) return "";

    const original = readFileSync(memoryPath, "utf-8");
    const normalized = normalizeLegacyBranding(original)
      .replace(/\n## Workspace Context\n[\s\S]*?(?=\n## Active Context|\s*$)/, "")
      .replace(/\n{3,}/g, "\n\n");
    if (normalized !== original) {
      writeFileSync(memoryPath, normalized);
    }
    return normalized;
  }

  /**
   * Send a message to an agent. Messages are queued and processed
   * sequentially — the next message is only sent after the current
   * turn completes (indicated by a "result" stream-json event).
   */
  async sendToAgent(agentId: string, userMessage: string): Promise<string | void> {
    const session = this.sessions.get(agentId);
    if (!session) {
      throw new Error(`Agent ${agentId} not initialized`);
    }

    // Get agent record for system prompt
    const { data: agent } = await this.supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();
    // Get MEMORY.md content
    const memoryPath = join(session.workDir, "MEMORY.md");
    const memoryContext = this.migrateLegacyBrandingInMemory(memoryPath);

    const workspaceContext = agent?.server_id
      ? await this.loadWorkspaceContext(agent.server_id)
      : null;
    const systemPrompt = buildSystemPrompt(agent, memoryContext, workspaceContext);

    // Ensure a persistent process is running
    let agentProc = this.processes.get(agentId);
    if (!agentProc || agentProc.proc.killed || agentProc.proc.exitCode !== null) {
      agentProc = await this.spawnProcess(agentId, session, systemPrompt, agent?.model || "opus");
      this.processes.set(agentId, agentProc);
    }

    // If the agent is busy, queue the message and wait
    if (agentProc.busy) {
      const displayName = session.displayName;
      console.log(
        `  [${displayName}] Agent busy, queueing message (${userMessage.length} chars, queue size: ${agentProc.messageQueue.length + 1})...`
      );
      return new Promise<string | void>((resolve, reject) => {
        agentProc!.messageQueue.push({ userMessage, resolve, reject });
      });
    }

    return this.deliverMessage(agentId, agentProc, session, userMessage);
  }

  /** Write a message to the agent's stdin and mark it as busy */
  private deliverMessage(
    agentId: string,
    agentProc: AgentProcess,
    session: AgentSession,
    userMessage: string
  ): Promise<string | void> | void {

    agentProc.busy = true;

    const displayName = session.displayName;

    console.log(
      `[${displayName}] Forwarding message (${userMessage.length} chars)...`
    );

    this.broadcastActivity(
      agentId,
      "working",
      "Working",
      "Message received"
    );

    return this.runWithProvider(
      agentId,
      agentProc,
      session,
      userMessage
    );

  }

  /** Process the next queued message, if any */
  private drainQueue(agentId: string, agentProc: AgentProcess) {
    const session = this.sessions.get(agentId);
    if (!session) return;

    const next = agentProc.messageQueue.shift();
    if (next) {
      console.log(
        `  [${session.displayName}] Draining queue (${agentProc.messageQueue.length} remaining)...`
      );
      const delivered = this.deliverMessage(
        agentId,
        agentProc,
        session,
        next.userMessage
      );
      if (delivered && typeof delivered.then === "function") {
        delivered.then(next.resolve, next.reject);
      } else {
        next.resolve();
      }
    }
  }

  /**
   * Restart the agent process to pick up a fresh system prompt
   * (with updated MEMORY.md). Uses --resume to continue the session.
   */
  private async restartProcess(agentId: string) {
    const session = this.sessions.get(agentId);
    if (!session) return;

    const agentProc = this.processes.get(agentId);
    if (!agentProc) return;

    const displayName = session.displayName;
    const sessionId = agentProc.sessionId;

    console.log(
      `  [${displayName}] Restarting process for fresh system prompt (session: ${sessionId?.substring(0, 8) || "none"})...`
    );

    // Clean up old process
    if (agentProc.heartbeatTimer) {
      clearInterval(agentProc.heartbeatTimer);
    }

    // Save any queued messages before killing the process
    const pendingQueue = [...agentProc.messageQueue];
    agentProc.messageQueue = [];

    if (!agentProc.proc.killed) {
      agentProc.proc.kill();
    }

    // Build fresh system prompt with current MEMORY.md
    const { data: agent } = await this.supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();
    const memoryPath = join(session.workDir, "MEMORY.md");
    const memoryContext = this.migrateLegacyBrandingInMemory(memoryPath);

    const workspaceContext = agent?.server_id
      ? await this.loadWorkspaceContext(agent.server_id)
      : null;
    const systemPrompt = buildSystemPrompt(agent, memoryContext, workspaceContext);

    // Spawn new process — will resume the session via saved sessionId
    const newProc = await this.spawnProcess(
      agentId,
      session,
      systemPrompt,
      agent?.model || "opus"
    );

    // Restore pending queue
    newProc.messageQueue = pendingQueue;

    this.processes.set(agentId, newProc);

    console.log(
      `  [${displayName}] Process restarted with fresh MEMORY.md.`
    );
  }

  /**
   * Set up CLI transport for the agent — writes a bash wrapper script
   * and env config into .scout/ directory in agent workspace.
   * Returns the .scout/ directory path (to prepend to PATH).
   */
  private prepareCliTransport(agentId: string, session: AgentSession): string {
    const scoutDir = join(session.workDir, ".scout");
    if (!existsSync(scoutDir)) {
      mkdirSync(scoutDir, { recursive: true });
    }

    const wrapperPath = join(scoutDir, "scout");
    let wrapperBody: string;

    // Try to resolve the compiled CLI from @scout/scout-cli npm package first
    try {
      const req = createRequire(import.meta.url);
      const cliPath = req.resolve("@scout/scout-cli/dist/index.js");
      // Published mode: use node to run compiled JS directly
      wrapperBody = `#!/usr/bin/env bash\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${cliPath.replace(/'/g, "'\\''")}' "$@"\n`;
      console.log(`  [${session.displayName}] CLI resolved from npm package: ${cliPath}`);
    } catch {
      // Fall back to monorepo dev path (TypeScript source via tsx)
      const bridgeRoot = resolve(__dirname, "..");
      const cliPath = resolve(bridgeRoot, "..", "..", "packages", "cli", "src", "index.ts");
      const tsxPath = join(bridgeRoot, "node_modules", "tsx", "dist", "cli.mjs");
      wrapperBody = `#!/usr/bin/env bash\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${tsxPath.replace(/'/g, "'\\''")}' '${cliPath.replace(/'/g, "'\\''")}' "$@"\n`;
      console.log(`  [${session.displayName}] CLI resolved from monorepo dev path: ${cliPath}`);
    }

    writeFileSync(wrapperPath, wrapperBody, { mode: 0o755 });
    console.log(`  [${session.displayName}] CLI wrapper written: ${wrapperPath}`);
    return scoutDir;
  }


  private async spawnProcess(
    agentId: string,
    session: AgentSession,
    systemPrompt: string,
    model: string = "opus"
  ): Promise<AgentProcess> {
    // Prepare CLI transport (.scout/ wrapper + env vars)
    const scoutDir = this.prepareCliTransport(agentId, session);

    const prevProc = this.processes.get(agentId);
    const runner = this.defaultRunner;

    if (runner === "codex") {
      console.log(`  [${session.displayName}] Preparing Codex runner...`);
      const proc = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], {
        cwd: session.workDir,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          SCOUT_AGENT_ID: agentId,
          SCOUT_SUPABASE_URL: this.supabaseUrl,
          SCOUT_SUPABASE_KEY: this.supabaseKey,
          SCOUT_AUTH_TOKEN: this.authToken,
          PATH: getLoginShellPath([scoutDir]),
        },
        stdio: ["ignore", "ignore", "pipe"],
      });

      const agentProc: AgentProcess = {
        proc,
        sessionId: prevProc?.sessionId || null,
        busy: false,
        stopVersion: prevProc?.stopVersion ?? 0,
        stopRequested: false,
        currentAbortController: null,
        currentTurnProc: null,
        stdoutBuffer: "",
        activity: "working",
        activityLabel: "Working",
        activityDetail: "Starting...",
        heartbeatTimer: null,
        messageQueue: [],
        pendingText: "",
        runner,
      };

      this.broadcastActivity(agentId, "idle", "Idle", "");

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (!text) return;
        console.error(`  [${session.displayName}] codex-runner stderr: ${text.substring(0, 200)}`);
      });

      proc.on("error", (err: Error) => {
        console.error(`  [${session.displayName}] Process error: ${err.message}`);
      });

      proc.on("close", (code: number | null) => {
        console.log(`  [${session.displayName}] Process exited with code ${code}`);
        for (const queued of agentProc.messageQueue) {
          queued.reject(new Error(`Agent process exited with code ${code}`));
        }
        agentProc.messageQueue = [];
      });

      return agentProc;
    }

    const args = [
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      systemPrompt,
      "--permission-mode",
      "bypassPermissions",
      "--model",
      model,
    ];

    // Resume previous session: check in-memory first, then Supabase
    const sessionId =
      prevProc?.sessionId || (await this.loadSessionId(agentId));
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    console.log(
      `  [${session.displayName}] Spawning Claude Code (stream-json + CLI, ${sessionId ? `resume: ${sessionId.substring(0, 8)}` : "new session"})...`
    );

    const proc = spawn("claude", args, {
      cwd: session.workDir,
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        // CLI injection: agent identity + Supabase credentials
        SCOUT_AGENT_ID: agentId,
        SCOUT_SUPABASE_URL: this.supabaseUrl,
        SCOUT_SUPABASE_KEY: this.supabaseKey,
      SCOUT_AUTH_TOKEN: this.authToken,
      // Prepend .scout/ to PATH so `scout` command is available
        PATH: getLoginShellPath([scoutDir]),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const agentProc: AgentProcess = {
      proc,
      sessionId: prevProc?.sessionId || null,
      busy: false,
      stopVersion: prevProc?.stopVersion ?? 0,
      stopRequested: false,
      currentAbortController: null,
      currentTurnProc: null,
      stdoutBuffer: "",
      activity: "working",
      activityLabel: "Working",
      activityDetail: "Starting…",
      heartbeatTimer: null,
      messageQueue: [],
      pendingText: "",
      runner,
    };

    // Broadcast initial activity
    this.broadcastActivity(agentId, "working", "Working", "Starting…");

    // Parse stdout line by line for stream-json events
    proc.stdout?.on("data", (chunk: Buffer) => {
      agentProc.stdoutBuffer += chunk.toString();
      const lines = agentProc.stdoutBuffer.split("\n");
      agentProc.stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleStreamEvent(agentId, agentProc, line.trim());
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      // Filter out noisy reconnection messages
      if (/Reconnecting\.\.\.|Falling back from WebSockets/i.test(text)) return;
      console.error(`  [${session.displayName}] stderr: ${text.substring(0, 200)}`);
    });

    proc.on("error", (err: Error) => {
      console.error(
        `  [${session.displayName}] Process error: ${err.message}`
      );
    });

    proc.on("close", (code: number | null) => {
      console.log(
        `  [${session.displayName}] Process exited with code ${code}`
      );
      // Reject any remaining queued messages
      for (const queued of agentProc.messageQueue) {
        queued.reject(new Error(`Agent process exited with code ${code}`));
      }
      agentProc.messageQueue = [];
    });

    return agentProc;
  }

  private async runCodexTurn(
    agentId: string,
    agentProc: AgentProcess,
    session: AgentSession,
    userMessage: string
  ): Promise<string> {
    console.log("ENTERED runCodexTurn");

    const memoryPath = join(session.workDir, "MEMORY.md");
    const memoryContext = this.migrateLegacyBrandingInMemory(memoryPath);

    try {
      const { data: agent } = await this.supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();
      const workspaceContext = agent?.server_id
        ? await this.loadWorkspaceContext(agent.server_id)
        : null;
      const systemPrompt = buildSystemPrompt(agent, memoryContext, workspaceContext);
      const prompt = `${systemPrompt}

## Codex bridge response mode

For this one-shot Codex runner, do not send the chat reply with \`scout message send\`.
Return the exact message that should appear in chat as your final answer.

${userMessage}`;

      const args = [
        "exec",
        "--skip-git-repo-check",
        "--json",
        "--color",
        "never",
        "--dangerously-bypass-approvals-and-sandbox",
        "-C",
        session.workDir,
      ];

      const runnerEnv = {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        SCOUT_AGENT_ID: agentId,
        SCOUT_SUPABASE_URL: this.supabaseUrl,
        SCOUT_SUPABASE_KEY: this.supabaseKey,
        SCOUT_AUTH_TOKEN: this.authToken,
        PATH: [
          join(session.workDir, ".scout"),
          process.env.PATH ?? "",
        ].join(delimiter),
      };

      this.ensureCodexLoggedIn(runnerEnv);
      const { command, argsPrefix } = resolveExecutable(CODEX_COMMAND);

      this.assertCodexAvailable(command, argsPrefix, runnerEnv);

      console.time("codex-turn");

      const isWindows = process.platform === "win32";

      const turnProc = isWindows
        ? spawn(
          "cmd.exe",
          ["/d", "/s", "/c", command, ...argsPrefix, ...args],
          {
            cwd: session.workDir,
            env: runnerEnv,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
          }
        )
        : spawn(command, [...argsPrefix, ...args], {
          cwd: session.workDir,
          env: runnerEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });

      console.log("Spawned Codex PID:", turnProc.pid);
      agentProc.stopRequested = false;
      agentProc.currentTurnProc = turnProc;

      turnProc.stdin?.on("error", (err: Error & { code?: string }) => {
        if (err.code !== "EPIPE") {
          console.error(
            `  [${session.displayName}] stdin error: ${err.message}`
          );
        }
      });

      turnProc.stdin?.end(prompt);

      let stdoutBuffer = "";
      let stdoutRaw = "";
      let stderrRaw = "";
      let finalText = "";

      return await new Promise<string>((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
          finish(() => {
            turnProc.kill();
            agentProc.busy = false;
            agentProc.currentTurnProc = null;
            this.broadcastActivity(
              agentId,
              "error",
              "Error",
              "Codex turn timed out"
            );
            this.drainQueue(agentId, agentProc);
            reject(new Error("Codex turn timed out"));
          });
        }, CODEX_TURN_TIMEOUT_MS);

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          fn();
        };

        turnProc.stdout?.on("data", (chunk: Buffer) => {
          stdoutRaw += chunk.toString();
          const text = chunk.toString();

          stdoutRaw += text;
          stdoutBuffer += text;

          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("{")) continue;

            finalText = this.handleCodexStreamEvent(
              agentId,
              agentProc,
              trimmed,
              finalText
            );
          }
        });

        let stderrRaw = "";

        turnProc.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString();

          stderrRaw += text;

          process.stderr.write(chunk);
        });
        turnProc.on("error", (err: Error) => {
          finish(() => {
            agentProc.currentTurnProc = null;
            agentProc.busy = false;
            this.broadcastActivity(agentId, "error", "Error", err.message);
            console.error(
              `  [${session.displayName}] Process error: ${err.message}`
            );
            this.drainQueue(agentId, agentProc);
            reject(err);
          });
        });

        turnProc.on("close", (code: number | null) => {

          console.log("Codex exited:", code);
          console.log("stdout so far:\n", stdoutBuffer);

          finish(() => {
            agentProc.currentTurnProc = null;
            if (agentProc.stopRequested) {
              agentProc.stopRequested = false;
              agentProc.busy = false;
              this.broadcastActivity(agentId, "idle", "Paused", "");
              this.drainQueue(agentId, agentProc);
              reject(new AgentPausedError());
              return;
            }

            if (code !== 0) {
              console.log("===== RAW STDOUT =====");
              console.log(stdoutRaw);

              console.log("===== RAW STDERR =====");
              console.log(stderrRaw);
              agentProc.busy = false;
              this.broadcastActivity(
                agentId,
                "error",
                "Error",
                `Codex exited with code ${code}`
              );
              this.drainQueue(agentId, agentProc);
              reject(new Error(`Codex exited with code ${code}`));
              return;
            }

            agentProc.busy = false;
            this.broadcastActivity(agentId, "idle", "Idle", "");
            this.drainQueue(agentId, agentProc);
            console.timeEnd("codex-turn");
            resolve(finalText.trim());
          });
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      agentProc.busy = false;
      agentProc.currentTurnProc = null;
      if (err instanceof AgentPausedError) {
        throw err;
      }
      this.broadcastActivity(agentId, "error", "Error", message);
      console.error(
        `  [${session.displayName}] Failed to start Codex turn: ${message}`
      );
      this.drainQueue(agentId, agentProc);

      throw err instanceof Error ? err : new Error(message);
    }
  }

  private assertCodexAvailable(
    command: string,
    argsPrefix: string[],
    env: NodeJS.ProcessEnv
  ) {
    console.log("\n========== CODEX CHECK ==========");
    console.log("Platform :", process.platform);
    console.log("Node     :", process.version);
    console.log("Command  :", command);
    console.log("Args     :", argsPrefix);
    console.log("PATH     :", env.PATH);
    console.log("=================================\n");

    const result =
      process.platform === "win32"
        ? spawnSync("cmd.exe", ["/d", "/s", "/c", command, "--version"], {
          encoding: "utf8",
          env,
          windowsHide: true,
        })
        : spawnSync(command, [...argsPrefix, "--version"], {
          encoding: "utf8",
          env,
        });

    console.log("\n========== RESULT ==========");
    console.log("status :", result.status);
    console.log("signal :", result.signal);
    console.log("stdout :", result.stdout);
    console.log("stderr :", result.stderr);
    console.log("error  :", result.error);
    console.log("============================\n");

    if (result.status === 0) {
      return;
    }

    const detail =
      result.error?.stack ||
      result.error?.message ||
      result.stderr?.trim() ||
      result.stdout?.trim() ||
      "unknown error";

    throw new Error(`Codex CLI is unavailable.\n${detail}`);
  }

  private handleCodexStreamEvent(
    agentId: string,
    agentProc: AgentProcess,
    line: string,
    finalText: string
  ): string {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return finalText;
    }

    const session = this.sessions.get(agentId);
    const displayName = session?.displayName || agentId;

    switch (event.type) {
      case "turn.started":
        this.broadcastActivity(agentId, "thinking", "Thinking", "");
        break;
      case "item.completed":
        console.log(
          "AGENT MESSAGE RECEIVED",
          Date.now(),
          event.item?.text?.length
        );
        if (event.item?.type === "agent_message" && event.item?.text) {
          finalText = event.item.text;
          this.broadcastActivity(agentId, "working", "", event.item.text);
        }
        break;
      case "turn.completed":
        console.log(`  [${displayName}] Turn complete.`);
        break;
    }

    return finalText;
  }

  private handleStreamEvent(
    agentId: string,
    agentProc: AgentProcess,
    line: string
  ) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return; // Ignore non-JSON lines
    }

    const session = this.sessions.get(agentId);
    const displayName = session?.displayName || agentId;

    switch (event.type) {
      case "system":
        if (event.subtype === "init" && event.session_id) {
          agentProc.sessionId = event.session_id;
          this.saveSessionId(agentId, event.session_id);
          console.log(
            `  [${displayName}] Session initialized: ${event.session_id.substring(0, 8)}...`
          );
        }
        if (event.subtype === "compacting") {
          this.flushPendingText(agentId, agentProc);
          this.broadcastActivity(agentId, "working", "Optimizing context", "");
          // Restart the process to pick up fresh MEMORY.md in system prompt
          console.log(
            `  [${displayName}] Context compaction detected — scheduling process restart for fresh MEMORY.md...`
          );
          this.restartProcess(agentId).catch((err) => {
            console.error(
              `  [${displayName}] Failed to restart after compaction: ${err.message}`
            );
          });
        }
        break;

      case "assistant": {
        // Claude Code stream-json nests content inside event.message.content[]
        // Each assistant event contains one content block in the array.
        const contentBlock = event.message?.content?.[0];
        if (!contentBlock) break;

        const blockType = contentBlock.type;

        if (blockType === "thinking") {
          // Flush any accumulated text before switching to thinking
          this.flushPendingText(agentId, agentProc);
          this.broadcastActivity(agentId, "thinking", "Thinking", "");
        } else if (blockType === "text") {
          // Store latest text output — will be flushed when next non-text event arrives
          agentProc.pendingText = contentBlock.text || "";
        } else if (blockType === "tool_use") {
          // Flush accumulated text first
          this.flushPendingText(agentId, agentProc);
          // Map tool to human-readable label + detail
          const { label, detail } = this.describeToolUse(contentBlock);
          this.broadcastActivity(agentId, "working", label, detail);
        }
        break;
      }

      case "result": {
        // Flush any final text
        this.flushPendingText(agentId, agentProc);
        // Turn is complete — save session ID
        if (event.session_id) {
          agentProc.sessionId = event.session_id;
          this.saveSessionId(agentId, event.session_id);
        }
        agentProc.busy = false;
        this.broadcastActivity(agentId, "idle", "Idle", "");
        console.log(`  [${displayName}] Turn complete.`);

        // Process next queued message if any
        this.drainQueue(agentId, agentProc);
        break;
      }
    }
  }

  private async runWithProvider(
    agentId: string,
    agentProc: AgentProcess,
    session: AgentSession,
    userMessage: string
  ): Promise<string> {

    const memoryPath = join(
      session.workDir,
      "MEMORY.md"
    );

    const memoryContext =
      this.migrateLegacyBrandingInMemory(
        memoryPath
      );

    const { data: agent } =
      await this.supabase
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .single();
    const workspaceContext = agent?.server_id
      ? await this.loadWorkspaceContext(agent.server_id)
      : null;
    const systemPrompt = buildSystemPrompt(agent, memoryContext, workspaceContext);

    let timeout: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    try {
      const abortController = new AbortController();
      timeout = setTimeout(() => {
        timedOut = true;
        agentProc.stopRequested = true;
        abortController.abort();
      }, PROVIDER_TURN_TIMEOUT_MS);
      agentProc.stopRequested = false;
      agentProc.currentAbortController = abortController;

      const result =
        await this.llmProvider.generate({

          agentId,

          model:
            agent?.model ?? "gpt-oss-20b",

          systemPrompt,

          userPrompt: userMessage,

          workingDirectory:
            session.workDir,

          messages:
            session.conversation,

          signal:
            abortController.signal,

        });
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
        if (result.activity) {

    for (const update of result.activity) {

        this.broadcastActivity(
            agentId,
            update.activity,
            update.label,
            update.detail
        );

    }

}
      session.conversation.push({

        role: "user",

        content: userMessage,

      });

      session.conversation.push({

        role: "assistant",

        content: result.content,

      });

      agentProc.busy = false;

      this.broadcastActivity(
        agentId,
        "idle",
        "Idle",
        "Completed"
      );

      this.drainQueue(
        agentId,
        agentProc
      );

      return result.content;

    } catch (err) {

      agentProc.busy = false;
      agentProc.currentAbortController = null;

      if (agentProc.stopRequested) {
        agentProc.stopRequested = false;
        this.broadcastActivity(
          agentId,
          "idle",
          "Paused",
          ""
        );
        this.drainQueue(
          agentId,
          agentProc
        );
        throw timedOut ? new Error("Agent response timed out") : new AgentPausedError();
      }

      this.broadcastActivity(
        agentId,
        "error",
        "Error",
        "Generation failed"
      );

      this.drainQueue(
        agentId,
        agentProc
      );

      throw err;

    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      agentProc.currentAbortController = null;

    }

  }

  /** Get the workspace directory for an agent */
  getWorkspaceDir(agentId: string): string | null {
    return this.sessions.get(agentId)?.workDir ?? null;
  }

  stopAll() {
    // Kill all running processes and clean up heartbeats
    for (const [agentId, agentProc] of this.processes) {
      if (agentProc.heartbeatTimer) {
        clearInterval(agentProc.heartbeatTimer);
      }
      // Reject any queued messages
      for (const queued of agentProc.messageQueue) {
        queued.reject(new Error("Agent manager stopped"));
      }
      agentProc.messageQueue = [];
      if (!agentProc.proc.killed) {
        console.log(`  Stopping agent process: ${agentId}`);
        agentProc.proc.kill();
      }
    }
    this.processes.clear();
    this.sessions.clear();
    this.supabase.removeChannel(this.activityChannel);
  }
}
