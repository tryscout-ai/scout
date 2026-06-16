import { createDecipheriv, createHash } from "crypto";
import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { readdir, readFile, stat, lstat } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";
import { AgentManager } from "./agent-manager.js";

interface BridgeConfig {
  supabaseUrl: string;
  supabaseKey: string;    // anon key
  authToken: string;       // JWT for authenticated Supabase operations
  userId: string;
  serverId: string;
  agentsDir: string;
  hostname?: string;
  platform?: string;
  arch?: string;
}

interface DbMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_type: "human" | "agent" | "system";
  content: string;
  thread_parent_id: string | null;
  created_at: string;
}

interface DbAgent {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
  status: string;
}

interface DbTask {
  id: string;
  task_number: number;
  status: "todo" | "in_progress" | "in_review" | "done";
  assignee_id: string | null;
  assignee_type: "human" | "agent" | null;
  channel_id: string;
  message_id: string;
  created_at: string;
}

interface DbTaskCollaborator {
  task_id: string;
  agent_id: string;
  role: "lead" | "collaborator";
  created_at: string;
}

interface DbAgentHandoff {
  id: string;
  task_id: string;
  message_id: string;
  channel_id: string;
  source_agent_id: string | null;
  target_agent_id: string | null;
  reason: string;
  summary: string;
  next_action: string;
  created_at: string;
}

interface DbChannelMember {
  channel_id: string;
  member_id: string;
  member_type: string;
}

interface SlackMessageMapping {
  slack_team_id: string;
  slack_channel_id: string;
  slack_message_ts: string;
  slack_thread_ts: string | null;
}

interface SlackAgentAppToken {
  bot_access_token_encrypted: string | null;
}

function slackEncryptionKey() {
  const secret =
    process.env.SCOUT_SLACK_TOKEN_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SCOUT_SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret).digest();
}

function decryptSlackSecret(value: string | null | undefined) {
  const key = slackEncryptionKey();
  if (!value || !key) return null;

  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) return null;

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export class Bridge {
  private supabase: SupabaseClient;
  private agentManager: AgentManager;
  private config: BridgeConfig;
  // Maps channel_id -> Set of agent_ids in that channel
  private channelAgents = new Map<string, Set<string>>();
  // Maps channel_id -> channel type ('dm' | 'public' | 'private')
  private channelTypes = new Map<string, string>();
  // Maps channel_id -> channel name
  private channelNames = new Map<string, string>();
  // Maps agent_id -> agent DB record
  private agentRecords = new Map<string, DbAgent>();
  // Realtime channel for workspace file RPC (web UI ↔ bridge)
  private workspaceRpcChannel: RealtimeChannel | null = null;
  // Presence channel for online status (auto-offline on disconnect)
  private presenceChannel: RealtimeChannel | null = null;
  // Heartbeat timer for machine_keys.last_used_at (polling fallback for online status)
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  // Prevent duplicate wakeups when a task insert and collaborator inserts arrive together.
  private taskDispatches = new Map<string, Set<string>>();

  constructor(config: BridgeConfig) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${config.authToken}` },
      },
    });
    // Set auth token for Realtime WebSocket (global headers only cover REST)
    this.supabase.realtime.setAuth(config.authToken);
    this.agentManager = new AgentManager(
      config.agentsDir,
      this.supabase,
      config.supabaseUrl,
      config.supabaseKey,
      config.authToken
    );
  }

  /** Update the auth token (called on periodic refresh) */
  updateAuthToken(token: string) {
    this.config.authToken = token;
    // Remove old channels before recreating client
    if (this.workspaceRpcChannel) {
      this.supabase.removeChannel(this.workspaceRpcChannel);
      this.workspaceRpcChannel = null;
    }
    if (this.presenceChannel) {
      this.supabase.removeChannel(this.presenceChannel);
      this.presenceChannel = null;
    }
    // Recreate the Supabase client with the new token
    this.supabase = createClient(this.config.supabaseUrl, this.config.supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    this.supabase.realtime.setAuth(token);
    // Update agent manager's client too
    this.agentManager.updateSupabaseClient(this.supabase, token);
    // Re-subscribe workspace RPC and presence on new client
    this.subscribeToWorkspaceRpc();
    this.trackPresence();
  }

  async start() {
    // 1. Load this user's agents from DB
    await this.loadAgents();

    // 2. Load channel memberships for these agents
    await this.loadChannelMemberships();

    // 3. Initialize agent workspaces
    for (const [agentId, agent] of this.agentRecords) {
      await this.agentManager.initAgent(agentId, agent);
    }

    // 4. Update agent statuses to 'online' (best-effort DB backup)
    const agentIds = Array.from(this.agentRecords.keys());
    if (agentIds.length > 0) {
      await this.supabase
        .from("agents")
        .update({ status: "online" })
        .in("id", agentIds);
    }

    // 5. Subscribe to new messages in channels where agents are members
    this.subscribeToMessages();

    // 6. Subscribe to new tasks created from Scout UI, CLI, or Slack.
    this.subscribeToTasks();

    // 7. Subscribe to task collaborators so mentioned agents wake immediately.
    this.subscribeToTaskCollaborators();

    // 8. Subscribe to agent handoffs so delegated agents wake immediately.
    this.subscribeToHandoffs();

    // 9. Subscribe to new agents and channel memberships (for agents created via UI)
    this.subscribeToNewAgents();

    // 10. Subscribe to workspace file RPC (web UI requests files via Realtime)
    this.subscribeToWorkspaceRpc();

    // 11. Track presence (auto-offline on disconnect — no SIGINT needed)
    this.trackPresence();

    // 12. Start heartbeat (updates machine_keys.last_used_at every 30s for polling-based status)
    this.startHeartbeat();

    console.log(
      `  Bridge ready. Listening for messages across ${this.channelAgents.size} channel(s).`
    );
    console.log(
      `  Managing ${this.agentRecords.size} agent(s): ${Array.from(this.agentRecords.values()).map((a) => a.display_name).join(", ")}`
    );
  }

  private async loadAgents() {
    const { data: agents, error } = await this.supabase
      .from("agents")
      .select("*")
      .eq("owner_id", this.config.userId);

    if (error) {
      console.error("  Failed to load agents:", error.message);
      return;
    }

    for (const agent of agents || []) {
      this.agentRecords.set(agent.id, agent as DbAgent);
    }

    console.log(`  Loaded ${this.agentRecords.size} agent(s) from database.`);
  }

  private async loadChannelMemberships() {
    const agentIds = Array.from(this.agentRecords.keys());
    if (agentIds.length === 0) return;

    const { data: memberships, error } = await this.supabase
      .from("channel_members")
      .select("channel_id, member_id")
      .eq("member_type", "agent")
      .in("member_id", agentIds);

    if (error) {
      console.error("  Failed to load memberships:", error.message);
      return;
    }

    const channelIds = new Set<string>();
    for (const m of memberships || []) {
      const mem = m as DbChannelMember;
      if (!this.channelAgents.has(mem.channel_id)) {
        this.channelAgents.set(mem.channel_id, new Set());
      }
      this.channelAgents.get(mem.channel_id)!.add(mem.member_id);
      channelIds.add(mem.channel_id);
    }

    // Load channel types and names
    if (channelIds.size > 0) {
      const { data: channels } = await this.supabase
        .from("channels")
        .select("id, name, type")
        .in("id", Array.from(channelIds));

      for (const ch of channels || []) {
        this.channelTypes.set(ch.id, ch.type);
        this.channelNames.set(ch.id, ch.name);
      }
    }
  }

  private subscribeToMessages() {
    const subscription = this.supabase
      .channel("bridge-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const msg = payload.new as DbMessage;
          this.handleNewMessage(msg);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("  Subscribed to Supabase Realtime.");
        } else if (status === "CHANNEL_ERROR") {
          console.error("  Supabase Realtime subscription error.");
        }
      });
  }

  private async postSlack(channelId: string, text: string, threadTs?: string | null, tokenOverride?: string | null) {
    const token = tokenOverride || process.env.SLACK_BOT_TOKEN;
    if (!token) return null;

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        thread_ts: threadTs || undefined,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const body = (await response.json()) as { ok: boolean; error?: string; ts?: string };
    if (!body.ok) {
      throw new Error(body.error || "Slack chat.postMessage failed");
    }
    return body.ts || null;
  }

  private async mirrorAgentReplyToSlack(msg: DbMessage) {
    if (msg.sender_type !== "agent" || !msg.thread_parent_id) return;

    const { data } = await this.supabase
      .from("slack_message_mappings")
      .select("slack_team_id, slack_channel_id, slack_message_ts, slack_thread_ts")
      .eq("scout_message_id", msg.thread_parent_id)
      .single();

    const slackRef = data as SlackMessageMapping | null;
    if (!slackRef) return;

    try {
      const senderName = await this.resolveSenderName(msg.sender_id, msg.sender_type);
      const slackText = `*${senderName}:*\n${msg.content}`;
      const token = await this.resolveSlackAgentToken(msg.sender_id);
      const slackTs = await this.postSlack(
        slackRef.slack_channel_id,
        slackText,
        slackRef.slack_thread_ts || slackRef.slack_message_ts,
        token
      );

      if (slackTs) {
        await this.supabase.from("slack_message_mappings").upsert({
          scout_message_id: msg.id,
          slack_team_id: slackRef.slack_team_id,
          slack_channel_id: slackRef.slack_channel_id,
          slack_message_ts: slackTs,
          slack_thread_ts: slackRef.slack_thread_ts || slackRef.slack_message_ts,
        });
      }
    } catch (err) {
      console.error(
        "  [Bridge] Could not mirror Scout reply to Slack:",
        err instanceof Error ? err.message : err
      );
    }
  }

  private async resolveSlackAgentToken(agentId: string) {
    const { data } = await this.supabase
      .from("slack_agent_apps")
      .select("bot_access_token_encrypted")
      .eq("agent_id", agentId)
      .eq("install_status", "installed")
      .maybeSingle();

    const app = data as SlackAgentAppToken | null;
    return decryptSlackSecret(app?.bot_access_token_encrypted);
  }

  private subscribeToTasks() {
    this.supabase
      .channel("bridge-tasks")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tasks",
        },
        (payload) => {
          const task = payload.new as DbTask;
          this.handleNewTask(task);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("  Subscribed to Scout tasks.");
        } else if (status === "CHANNEL_ERROR") {
          console.error("  Scout task subscription error.");
        }
      });
  }

  private subscribeToTaskCollaborators() {
    this.supabase
      .channel("bridge-task-collaborators")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_collaborators",
        },
        async (payload) => {
          const collaborator = payload.new as DbTaskCollaborator;
          const { data: task, error } = await this.supabase
            .from("tasks")
            .select("id, task_number, status, assignee_id, assignee_type, channel_id, message_id, created_at")
            .eq("id", collaborator.task_id)
            .single();

          if (error || !task) {
            console.error(
              "  [Bridge] Could not load task collaborator target:",
              error?.message || "task not found"
            );
            return;
          }

          await this.dispatchTaskToAgent(task as DbTask, collaborator.agent_id, collaborator.role);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("  Subscribed to Scout task collaborators.");
        } else if (status === "CHANNEL_ERROR") {
          console.error("  Scout task collaborator subscription error.");
        }
      });
  }

  private subscribeToHandoffs() {
    this.supabase
      .channel("bridge-agent-handoffs")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_handoffs",
        },
        async (payload) => {
          const handoff = payload.new as DbAgentHandoff;
          if (!handoff.target_agent_id) return;

          const { data: task, error } = await this.supabase
            .from("tasks")
            .select("id, task_number, status, assignee_id, assignee_type, channel_id, message_id, created_at")
            .eq("id", handoff.task_id)
            .single();

          if (error || !task) {
            console.error(
              "  [Bridge] Could not load handoff target task:",
              error?.message || "task not found"
            );
            return;
          }

          await this.dispatchTaskToAgent(task as DbTask, handoff.target_agent_id, "lead", {
            reason: handoff.reason,
            summary: handoff.summary,
            nextAction: handoff.next_action,
          }, true);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("  Subscribed to Scout handoffs.");
        } else if (status === "CHANNEL_ERROR") {
          console.error("  Scout handoff subscription error.");
        }
      });
  }

  /**
   * Parse @mentions from message content.
   * Matches @DisplayName (case-insensitive) against agents in the channel.
   */
  private parseMentionedAgents(
    content: string,
    channelAgentIds: Set<string>
  ): Set<string> {
    const mentioned = new Set<string>();
    for (const agentId of channelAgentIds) {
      const agent = this.agentRecords.get(agentId);
      if (!agent) continue;
      const mentionNames = new Set([
        agent.display_name,
        agent.name,
        agent.display_name.replace(/\s+/g, ""),
      ]);

      // Match @DisplayName followed by whitespace, punctuation, or end of string
      // (don't use \b — it doesn't work with CJK characters)
      for (const name of mentionNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`@${escaped}(?=[\\s,.:!?，。！？、；]|$)`, "i");
        if (pattern.test(content)) {
          mentioned.add(agentId);
          break;
        }
      }
    }
    return mentioned;
  }

  /**
   * Fetch recent channel history for context.
   */
  private async getChannelContext(
    channelId: string,
    limit: number = 10
  ): Promise<string> {
    const { data: messages } = await this.supabase
      .from("messages")
      .select("sender_id, sender_type, content, created_at")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!messages || messages.length === 0) return "";

    const lines = messages.reverse().map((m) => {
      let senderName = "Unknown";
      if (m.sender_type === "human") {
        senderName = "User";
      } else if (m.sender_type === "system") {
        senderName = "System";
      } else {
        const agent = this.agentRecords.get(m.sender_id);
        senderName = agent?.display_name || "Agent";
      }
      return `[${senderName}]: ${m.content.substring(0, 300)}`;
    });

    return `\n--- Recent channel messages ---\n${lines.join("\n")}\n---`;
  }

  /**
   * Resolve the display name for a sender_id (human or agent).
   */
  private async resolveSenderName(
    senderId: string,
    senderType: string
  ): Promise<string> {
    if (senderType === "agent") {
      const agent = this.agentRecords.get(senderId);
      if (agent) return agent.display_name;
    }

    // Try profiles table for humans
    const { data } = await this.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", senderId)
      .single();
    return data?.display_name || "User";
  }

  /**
   * Build a target string for the channel (e.g. "#general", "dm:@alice").
   */
  private buildChannelTarget(channelId: string, senderName?: string): string {
    const ch = this.channelTypes.get(channelId);
    if (ch === "dm" && senderName) {
      return `dm:@${senderName}`;
    }
    // For non-DM channels, find the channel name
    for (const [id, info] of this.channelNames) {
      if (id === channelId) return `#${info}`;
    }
    return channelId;
  }

  private async sendAgentReply(
    agentId: string,
    msg: DbMessage,
    replyText: string
  ) {
    const text = replyText.trim();
    if (!text) return;

    const payload: {
      channel_id: string;
      sender_id: string;
      sender_type: "agent";
      content: string;
      thread_parent_id?: string;
    } = {
      channel_id: msg.channel_id,
      sender_id: agentId,
      sender_type: "agent",
      content: text,
    };

    if (msg.thread_parent_id) {
      payload.thread_parent_id = msg.thread_parent_id;
    }

    const { error } = await this.supabase.from("messages").insert(payload);
    if (error) {
      throw new Error(error.message);
    }
  }

  private async handleNewMessage(msg: DbMessage) {
    await this.mirrorAgentReplyToSlack(msg);

    // Only respond to human messages
    if (msg.sender_type !== "human") return;

    // Check if any of our agents are in this channel
    const agentIdsInChannel = this.channelAgents.get(msg.channel_id);
    if (!agentIdsInChannel || agentIdsInChannel.size === 0) return;

    const channelType = this.channelTypes.get(msg.channel_id);
    const isDm = channelType === "dm";

    // Determine which agents should respond
    let respondingAgentIds: Set<string>;

    if (isDm) {
      // DM: always respond with the single agent
      respondingAgentIds = agentIdsInChannel;
    } else {
      // Channel: only respond if @mentioned
      const mentioned = this.parseMentionedAgents(
        msg.content,
        agentIdsInChannel
      );
      if (mentioned.size === 0) {
        // No agents mentioned — don't respond
        console.log(
          `  [Bridge] No @mention in channel message, skipping.`
        );
        return;
      }
      respondingAgentIds = mentioned;
    }

    // Resolve sender name for message context
    const senderName = await this.resolveSenderName(
      msg.sender_id,
      msg.sender_type
    );

    // Build channel target for MCP context
    const channelTarget = this.buildChannelTarget(msg.channel_id, senderName);

    // For channels (not DM), get conversation context
    let contextPrefix = "";
    if (!isDm) {
      contextPrefix = await this.getChannelContext(msg.channel_id);
    }

    for (const agentId of respondingAgentIds) {
      const agent = this.agentRecords.get(agentId);
      if (!agent) continue;

      console.log(
        `  [${agent.display_name}] Received${isDm ? "" : " (@mention)"}: "${msg.content.substring(0, 60)}${msg.content.length > 60 ? "..." : ""}"`
      );

      try {
        // Build prompt with message metadata
        const msgHeader = `[target=${channelTarget} sender=@${senderName} type=${msg.sender_type}]`;
        const prompt = contextPrefix
          ? `${contextPrefix}\n\n${msgHeader} ${msg.content}`
          : `${msgHeader} ${msg.content}`;

        // Fire-and-forget: agent handles all responses via `scout` CLI
        const reply = await this.agentManager.sendToAgent(agentId, prompt);
        if (typeof reply === "string" && reply.trim()) {
          await this.sendAgentReply(agentId, msg, reply);
        }
      } catch (err) {
        this.agentManager.markError(
          agentId,
          err instanceof Error ? err.message : String(err)
        );
        console.error(
          `  [${agent.display_name}] Error:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  private async handleNewTask(task: DbTask) {
    const agentIdsInChannel = this.channelAgents.get(task.channel_id);
    if (!agentIdsInChannel || agentIdsInChannel.size === 0) return;

    const { data: collaborators } = await this.supabase
      .from("task_collaborators")
      .select("agent_id, role")
      .eq("task_id", task.id);

    if (collaborators && collaborators.length > 0) {
      for (const collaborator of collaborators as Array<{ agent_id: string; role: "lead" | "collaborator" }>) {
        await this.dispatchTaskToAgent(task, collaborator.agent_id, collaborator.role);
      }
      return;
    }

    let targetAgentId: string | null = null;
    if (task.assignee_type === "agent" && task.assignee_id) {
      if (!this.agentRecords.has(task.assignee_id)) return;
      targetAgentId = task.assignee_id;
    } else if (agentIdsInChannel.size === 1) {
      targetAgentId = Array.from(agentIdsInChannel)[0];
    }

    if (!targetAgentId) {
      console.log(
        `  [Bridge] Task #${task.task_number} has no resolved lead agent in a multi-agent channel; Slack-native coordination cannot start until configuration is fixed.`
      );
      return;
    }

    await this.dispatchTaskToAgent(task, targetAgentId, "lead");
  }

  private hasDispatchedTask(taskId: string, agentId: string) {
    return this.taskDispatches.get(taskId)?.has(agentId) || false;
  }

  private markTaskDispatched(taskId: string, agentId: string) {
    const dispatched = this.taskDispatches.get(taskId) || new Set<string>();
    dispatched.add(agentId);
    this.taskDispatches.set(taskId, dispatched);

    setTimeout(() => {
      const current = this.taskDispatches.get(taskId);
      if (!current) return;
      current.delete(agentId);
      if (current.size === 0) this.taskDispatches.delete(taskId);
    }, 10 * 60 * 1000);
  }

  private async dispatchTaskToAgent(
    task: DbTask,
    targetAgentId: string,
    role: "lead" | "collaborator",
    handoff?: { reason: string; summary: string; nextAction: string },
    force = false
  ) {
    if (!this.agentRecords.has(targetAgentId)) return;
    if (!force && this.hasDispatchedTask(task.id, targetAgentId)) return;
    this.markTaskDispatched(task.id, targetAgentId);

    const agent = this.agentRecords.get(targetAgentId);
    if (!agent) return;

    const { data: message, error } = await this.supabase
      .from("messages")
      .select("id, channel_id, sender_id, sender_type, content, thread_parent_id, created_at")
      .eq("id", task.message_id)
      .single();

    if (error || !message) {
      console.error(
        `  [Bridge] Could not load message for task #${task.task_number}:`,
        error?.message || "message not found"
      );
      return;
    }

    const senderName = await this.resolveSenderName(
      message.sender_id,
      message.sender_type
    );
    const channelTarget = this.buildChannelTarget(task.channel_id, senderName);
    const threadTarget = `${channelTarget}:${message.id.replace(/-/g, "").substring(0, 8)}`;
    const contextPrefix = await this.getChannelContext(task.channel_id);
    const roleInstruction =
      role === "lead"
        ? `You are the lead agent for this task. Start by acknowledging in-thread, coordinate collaborators if any, and consolidate the final result.`
        : `You are a collaborator on this task. Reply in-thread with your contribution, coordinate with the lead agent, and avoid taking over final consolidation unless asked.`;
    const handoffInstruction = handoff
      ? `\n\nHandoff context:\nReason: ${handoff.reason}\nSummary: ${handoff.summary}\nNext action: ${handoff.nextAction}`
      : "";
    const prompt =
      `${contextPrefix}\n` +
      `\n[target=${threadTarget} sender=@${senderName} type=task task=#${task.task_number}] ` +
      `Scout task #${task.task_number} was created from this message. ${roleInstruction} ` +
      `Keep all progress, handoffs, and the final outcome in this task thread. ` +
      `If you need another agent, use the Scout task handoff flow instead of informal mentions. ` +
      `Update the task status when work reaches review or completion.${handoffInstruction}\n\n` +
      message.content;

    console.log(
      `  [${agent.display_name}] Received ${role} task #${task.task_number}: "${message.content.substring(0, 60)}${message.content.length > 60 ? "..." : ""}"`
    );

    try {
      const reply = await this.agentManager.sendToAgent(targetAgentId, prompt);
      if (typeof reply === "string" && reply.trim()) {
        await this.sendAgentReply(
          targetAgentId,
          { ...(message as DbMessage), thread_parent_id: task.message_id },
          reply
        );
      }
    } catch (err) {
      this.agentManager.markError(
        targetAgentId,
        err instanceof Error ? err.message : String(err)
      );
      console.error(
        `  [${agent.display_name}] Task #${task.task_number} error:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  private subscribeToNewAgents() {
    // Watch for new agents belonging to this user
    this.supabase
      .channel("bridge-new-agents")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agents",
          filter: `owner_id=eq.${this.config.userId}`,
        },
        async (payload) => {
          const agent = payload.new as DbAgent;
          if (this.agentRecords.has(agent.id)) return;

          console.log(
            `  [Bridge] New agent detected: ${agent.display_name}`
          );
          this.agentRecords.set(agent.id, agent);
          await this.agentManager.initAgent(agent.id, agent);

          // Mark as active (best-effort DB backup)
          await this.supabase
            .from("agents")
            .update({ status: "online" })
            .eq("id", agent.id);

          // Update presence with new agent list
          this.updatePresence();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_members",
        },
        async (payload) => {
          const member = payload.new as DbChannelMember;
          // Only track agent memberships for our agents
          if (
            member.member_type !== "agent" ||
            !this.agentRecords.has(member.member_id)
          )
            return;

          console.log(
            `  [Bridge] Agent ${this.agentRecords.get(member.member_id)?.display_name} joined channel ${member.channel_id}`
          );
          if (!this.channelAgents.has(member.channel_id)) {
            this.channelAgents.set(member.channel_id, new Set());
          }
          this.channelAgents.get(member.channel_id)!.add(member.member_id);

          // Load channel type and name if not known
          if (!this.channelTypes.has(member.channel_id)) {
            const { data: ch } = await this.supabase
              .from("channels")
              .select("name, type")
              .eq("id", member.channel_id)
              .single();
            if (ch) {
              this.channelTypes.set(member.channel_id, ch.type);
              this.channelNames.set(member.channel_id, ch.name);
            }
          }
        }
      )
      .subscribe();
  }

  /**
   * Track this bridge's presence. Supabase automatically removes presence
   * when the WebSocket disconnects (crash, network loss, terminal close).
   */
  private trackPresence() {
    const channelName = `bridge-presence:${this.config.serverId}`;
    this.presenceChannel = this.supabase
      .channel(channelName)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await this.updatePresence();
          console.log("  Bridge presence tracked.");
        }
      });
  }

  /** Periodically update machine_keys.last_used_at as a heartbeat for polling-based status. */
  private startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    const sendHeartbeat = async () => {
      try {
        await this.supabase
          .from("machine_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("user_id", this.config.userId)
          .eq("server_id", this.config.serverId);
      } catch {
        // Ignore heartbeat errors
      }
    };

    // Send immediately, then every 30 seconds
    sendHeartbeat();
    this.heartbeatInterval = setInterval(sendHeartbeat, 30_000);
  }

  /** Update the presence payload (e.g. when new agents are added). */
  private async updatePresence() {
    if (!this.presenceChannel) return;
    await this.presenceChannel.track({
      hostname: this.config.hostname || "unknown",
      platform: this.config.platform || "",
      arch: this.config.arch || "",
      agentIds: Array.from(this.agentRecords.keys()),
    });
  }

  /**
   * Subscribe to workspace file RPC requests from the web UI.
   * The web UI sends broadcast events; the bridge reads local files and responds.
   */
  private subscribeToWorkspaceRpc() {
    this.workspaceRpcChannel = this.supabase
      .channel("bridge-rpc")
      .on(
        "broadcast",
        { event: "rpc:request" },
        async ({ payload }) => {
          const { requestId, agentId, action, filePath } = payload;
          if (!requestId) return;

          try {
            let responsePayload: Record<string, unknown>;

            if (action === "skills:list") {
              // Skills are machine-wide, no agentId needed
              responsePayload = await this.listSkills();
            } else if (agentId && this.agentRecords.has(agentId)) {
              const workDir = this.agentManager.getWorkspaceDir(agentId);
              if (!workDir) {
                responsePayload = { error: "Agent workspace not found" };
              } else if (action === "list") {
                responsePayload = await this.listWorkspaceFiles(workDir);
              } else if (action === "read" && filePath) {
                responsePayload = await this.readWorkspaceFile(
                  workDir,
                  filePath
                );
              } else {
                responsePayload = { error: "Unknown action" };
              }
            } else {
              responsePayload = { error: "Unknown action or agent" };
            }

            this.workspaceRpcChannel!.send({
              type: "broadcast",
              event: "rpc:response",
              payload: { requestId, ...responsePayload },
            });
          } catch (err) {
            this.workspaceRpcChannel!.send({
              type: "broadcast",
              event: "rpc:response",
              payload: {
                requestId,
                error:
                  err instanceof Error ? err.message : "Unknown error",
              },
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("  Bridge RPC channel ready.");
        }
      });
  }

  private async listWorkspaceFiles(workDir: string) {
    const files: Array<{
      name: string;
      type: "file" | "directory";
      size: number;
      modified: string;
    }> = [];

    const entries = await readdir(workDir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const entryPath = join(workDir, entry);
      const entryStat = await stat(entryPath);
      files.push({
        name: entry,
        type: entryStat.isDirectory() ? "directory" : "file",
        size: entryStat.size,
        modified: entryStat.mtime.toISOString(),
      });
    }

    // Also list files inside notes/
    const notesDir = join(workDir, "notes");
    const notesFiles: typeof files = [];
    try {
      const notesEntries = await readdir(notesDir);
      for (const entry of notesEntries) {
        if (entry.startsWith(".")) continue;
        const entryPath = join(notesDir, entry);
        const entryStat = await stat(entryPath);
        notesFiles.push({
          name: `notes/${entry}`,
          type: entryStat.isDirectory() ? "directory" : "file",
          size: entryStat.size,
          modified: entryStat.mtime.toISOString(),
        });
      }
    } catch {
      // notes/ may not exist yet
    }

    return { workspace_path: workDir, files, notes_files: notesFiles };
  }

  private async readWorkspaceFile(workDir: string, filePath: string) {
    // Security: prevent path traversal
    const resolvedPath = join(workDir, filePath);
    if (!resolvedPath.startsWith(workDir)) {
      throw new Error("Invalid file path");
    }
    const content = await readFile(resolvedPath, "utf-8");
    return { file: filePath, content };
  }

  private async listSkills() {
    const skillsDir = join(homedir(), ".claude", "skills");
    const skills: Array<{ name: string; description: string }> = [];

    try {
      const entries = await readdir(skillsDir);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const entryPath = join(skillsDir, entry);
        const entryStat = await lstat(entryPath);
        const resolvedPath = entryStat.isSymbolicLink()
          ? resolve(skillsDir, entry)
          : entryPath;

        for (const filename of ["SKILL.md", "skill.md"]) {
          try {
            const content = await readFile(
              join(resolvedPath, filename),
              "utf-8"
            );
            const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
            let description = "";
            if (fmMatch) {
              const descMatch = fmMatch[1].match(
                /^description:\s*(.+)$/m
              );
              if (descMatch) {
                description = descMatch[1]
                  .trim()
                  .replace(/^['"]|['"]$/g, "");
              }
            }
            skills.push({ name: entry, description: description || entry });
            break;
          } catch {
            // File doesn't exist, try next
          }
        }
      }
    } catch {
      // Skills directory doesn't exist
    }

    return { skills };
  }

  async stop() {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Mark agents as offline
    const agentIds = Array.from(this.agentRecords.keys());
    if (agentIds.length > 0) {
      await this.supabase
        .from("agents")
        .update({ status: "offline" })
        .in("id", agentIds);
    }

    // Stop all agent sessions
    this.agentManager.stopAll();

    // Disconnect from Supabase (removes all channels including workspace RPC + presence)
    this.workspaceRpcChannel = null;
    this.presenceChannel = null;
    await this.supabase.removeAllChannels();

    console.log("  Bridge stopped.");
  }
}
