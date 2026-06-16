import { createHmac, timingSafeEqual } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/slack/crypto";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

interface SlackMessageRef {
  teamId: string;
  channelId: string;
  messageTs: string;
  threadTs?: string | null;
}

interface SlackPostMessageResponse {
  ok: boolean;
  error?: string;
  ts?: string;
}

interface SlackAgentMention {
  id: string;
  name: string;
  displayName: string;
}

export interface SlackTaskResult {
  taskId: string;
  taskNumber: number;
  messageId: string;
  scoutChannelId: string;
  slackThreadTs: string | null;
  assigneeName: string | null;
  assigneeHandle: string | null;
  collaborators: Array<{ id: string; name: string; displayName: string; role: "lead" | "collaborator" }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null, signingSecret = process.env.SLACK_SIGNING_SECRET): boolean {
  if (!signingSecret || !timestamp || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export async function postSlackMessage(channel: string, text: string, threadTs?: string | null, token = requireEnv("SLACK_BOT_TOKEN")) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs || undefined,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  const body = (await response.json()) as SlackPostMessageResponse;
  if (!body.ok) {
    throw new Error(body.error || "Slack chat.postMessage failed");
  }
  return body.ts || null;
}

async function resolveMappedChannel(admin: SupabaseAdmin, teamId: string, slackChannelId: string) {
  const { data } = await admin
    .from("slack_channel_mappings")
    .select("scout_channel_id")
    .eq("slack_team_id", teamId)
    .eq("slack_channel_id", slackChannelId)
    .single();

  const mappedChannelId =
    data?.scout_channel_id || process.env.SCOUT_SLACK_DEFAULT_CHANNEL_ID || null;

  console.log("[Slack] Channel resolution", {
    slackTeamId: teamId,
    slackChannelId,
    mappedScoutChannelId: data?.scout_channel_id || null,
    fallbackScoutChannelId: process.env.SCOUT_SLACK_DEFAULT_CHANNEL_ID || null,
    resolvedScoutChannelId: mappedChannelId,
  });

  return mappedChannelId;
}

function defaultHumanId() {
  return process.env.SCOUT_SLACK_DEFAULT_HUMAN_ID || process.env.SCOUT_SLACK_USER_ID || null;
}

function defaultAgentId() {
  return process.env.SCOUT_SLACK_DEFAULT_AGENT_ID || null;
}

function normalizeAgentRef(value: string) {
  return value
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/g, "");
}

function buildAgentAliases(agent: { name: string; display_name: string }) {
  const aliases = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeAgentRef(value);
    if (normalized) aliases.add(normalized);
  };

  add(agent.name);
  add(agent.display_name);
  add(agent.name.replace(/-/g, " "));
  add(agent.display_name.replace(/\s+agent$/i, ""));
  add(agent.display_name.replace(/\s+assistant$/i, ""));
  add(agent.display_name.replace(/\s+manager$/i, ""));

  return aliases;
}

function hasSlackAgentMention(text: string, aliases: Set<string>) {
  const mentionMatches = text.matchAll(/@([a-z0-9][a-z0-9 _.-]{1,60})/gi);
  for (const match of mentionMatches) {
    const raw = match[1];
    const words = raw.trim().split(/\s+/).filter(Boolean);
    for (let len = words.length; len >= 1; len--) {
      const candidate = words.slice(0, len).join(" ");
      if (aliases.has(normalizeAgentRef(candidate))) return true;
    }
  }

  return false;
}

async function resolveMentionedSlackAgents(admin: SupabaseAdmin, scoutChannelId: string, text: string) {
  const { data: memberships } = await admin
    .from("channel_members")
    .select("member_id")
    .eq("channel_id", scoutChannelId)
    .eq("member_type", "agent");

  const memberIds = (memberships || []).map((m) => m.member_id as string);
  if (memberIds.length === 0) return [];

  const { data: agents } = await admin
    .from("agents")
    .select("id, name, display_name")
    .in("id", memberIds);

  const mentioned: Array<{ id: string; name: string; displayName: string }> = [];
  for (const agent of agents || []) {
    if (hasSlackAgentMention(text, buildAgentAliases(agent))) {
      mentioned.push({
        id: agent.id as string,
        name: agent.name as string,
        displayName: agent.display_name as string,
      });
    }
  }

  return mentioned;
}

async function resolveMentionedSlackBotAgents(admin: SupabaseAdmin, scoutChannelId: string, text: string) {
  const botIds = Array.from(text.matchAll(/<@([A-Z0-9]+)>/g)).map((match) => match[1]);
  if (botIds.length === 0) return [];

  const { data: apps } = await admin
    .from("slack_agent_apps")
    .select("agent_id, slack_bot_user_id")
    .in("slack_bot_user_id", botIds);

  const agentIds = (apps || []).map((app) => app.agent_id as string);
  if (agentIds.length === 0) return [];

  const { data: memberships } = await admin
    .from("channel_members")
    .select("member_id")
    .eq("channel_id", scoutChannelId)
    .eq("member_type", "agent")
    .in("member_id", agentIds);
  const channelAgentIds = new Set((memberships || []).map((membership) => membership.member_id as string));

  const { data: agents } = await admin
    .from("agents")
    .select("id, name, display_name")
    .in("id", agentIds);

  const agentsById = new Map(
    (agents || []).map((agent) => [
      agent.id as string,
      {
        id: agent.id as string,
        name: agent.name as string,
        displayName: agent.display_name as string,
      },
    ])
  );

  const ordered: SlackAgentMention[] = [];
  for (const botId of botIds) {
    const app = (apps || []).find((item) => item.slack_bot_user_id === botId);
    const agent = app ? agentsById.get(app.agent_id as string) : null;
    if (agent && channelAgentIds.has(agent.id) && !ordered.some((existing) => existing.id === agent.id)) {
      ordered.push(agent);
    }
  }

  return ordered;
}

async function resolveSlackAssignee(
  admin: SupabaseAdmin,
  scoutChannelId: string,
  mentionedAgents: Array<{ id: string; name: string; displayName: string }>
): Promise<Pick<SlackTaskResult, "assigneeName" | "assigneeHandle"> & { agentId: string | null }> {
  if (mentionedAgents.length > 0) {
    const lead = mentionedAgents[0];
    return {
      agentId: lead.id,
      assigneeName: lead.displayName,
      assigneeHandle: lead.name,
    };
  }

  const configuredAgentId =
    process.env.SCOUT_SLACK_LEAD_AGENT_ID || defaultAgentId();
  const configuredAgentSource = process.env.SCOUT_SLACK_LEAD_AGENT_ID
    ? "SCOUT_SLACK_LEAD_AGENT_ID"
    : process.env.SCOUT_SLACK_DEFAULT_AGENT_ID
      ? "SCOUT_SLACK_DEFAULT_AGENT_ID"
      : null;

  if (configuredAgentId) {
    const { data: agent, error: agentError } = await admin
      .from("agents")
      .select("id, name, display_name")
      .eq("id", configuredAgentId)
      .single();

    if (agentError || !agent) {
      throw new Error(
        `${configuredAgentSource || "Configured Slack lead agent"}=${configuredAgentId} does not match a Scout agent`
      );
    }

    const { data: membership } = await admin
      .from("channel_members")
      .select("channel_id")
      .eq("channel_id", scoutChannelId)
      .eq("member_id", configuredAgentId)
      .eq("member_type", "agent")
      .single();

    console.log("[Slack] Lead agent resolution", {
      configuredAgentSource,
      configuredAgentId,
      scoutChannelId,
      membershipFound: Boolean(membership),
    });

    if (!membership) {
      throw new Error(
        `${configuredAgentSource || "Configured Slack lead agent"}=${configuredAgentId} is not a member of Scout channel ${scoutChannelId}`
      );
    }

    return {
      agentId: agent.id as string,
      assigneeName: agent.display_name as string,
      assigneeHandle: agent.name as string,
    };
  }

  const { data: memberships } = await admin
    .from("channel_members")
    .select("member_id")
    .eq("channel_id", scoutChannelId)
    .eq("member_type", "agent");

  if (!memberships || memberships.length !== 1) {
    return { agentId: null, assigneeName: null, assigneeHandle: null };
  }

  const agentId = memberships[0].member_id as string;
  const { data: agent } = await admin
    .from("agents")
    .select("name, display_name")
    .eq("id", agentId)
    .single();

  return {
    agentId,
    assigneeName:
      (agent?.display_name as string | undefined) || "the channel agent",
    assigneeHandle: (agent?.name as string | undefined) || null,
  };
}

export async function createTaskFromSlackMessage(params: {
  teamId: string;
  channelId: string;
  text: string;
  userId?: string | null;
  messageTs?: string | null;
  threadTs?: string | null;
  mentionedAgents?: SlackAgentMention[];
}): Promise<SlackTaskResult> {
  const admin = createAdminClient();
  const scoutChannelId = await resolveMappedChannel(admin, params.teamId, params.channelId);
  const humanId = defaultHumanId();

  if (!scoutChannelId) {
    throw new Error("No Scout channel mapping found for this Slack channel");
  }
  if (!humanId) {
    throw new Error("Missing SCOUT_SLACK_DEFAULT_HUMAN_ID for Slack-originated Scout messages");
  }
  const botMentionedAgents = params.mentionedAgents || await resolveMentionedSlackBotAgents(admin, scoutChannelId, params.text);
  const mentionedAgents =
    botMentionedAgents.length > 0
      ? botMentionedAgents
      : await resolveMentionedSlackAgents(admin, scoutChannelId, params.text);
  const { agentId, assigneeName, assigneeHandle } = await resolveSlackAssignee(
    admin,
    scoutChannelId,
    mentionedAgents
  );
  const collaborators = mentionedAgents.map((agent, index) => ({
    id: agent.id,
    name: agent.name,
    displayName: agent.displayName,
    role: index === 0 ? "lead" as const : "collaborator" as const,
  }));

  if (params.messageTs) {
    const { data: existingMapping } = await admin
      .from("slack_message_mappings")
      .select("scout_message_id")
      .eq("slack_team_id", params.teamId)
      .eq("slack_channel_id", params.channelId)
      .eq("slack_message_ts", params.messageTs)
      .single();

    if (existingMapping?.scout_message_id) {
      const { data: existingTask } = await admin
        .from("tasks")
        .select("id, task_number, message_id, channel_id")
        .eq("message_id", existingMapping.scout_message_id)
        .single();

      if (existingTask) {
        return {
          taskId: existingTask.id,
          taskNumber: existingTask.task_number,
          messageId: existingTask.message_id,
          scoutChannelId: existingTask.channel_id,
          slackThreadTs: params.threadTs || params.messageTs,
          assigneeName,
          assigneeHandle,
          collaborators,
        };
      }
    }
  }

  const content = params.text.trim();
  if (!content) {
    throw new Error("Slack task text cannot be empty");
  }

  const { data: message, error: messageError } = await admin
    .from("messages")
    .insert({
      channel_id: scoutChannelId,
      sender_id: humanId,
      sender_type: "human",
      content,
    })
    .select("id")
    .single();

  if (messageError) throw new Error(messageError.message);

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .insert({
      message_id: message.id,
      channel_id: scoutChannelId,
      assignee_id: agentId,
      assignee_type: agentId ? "agent" : null,
      status: agentId ? "in_progress" : "todo",
    })
    .select("id, task_number")
    .single();

  if (taskError) throw new Error(taskError.message);

  const collaboratorRows =
    collaborators.length > 0
      ? collaborators
      : agentId
        ? [{ id: agentId, role: "lead" as const }]
        : [];

  if (collaboratorRows.length > 0) {
    const { error: collaboratorError } = await admin.from("task_collaborators").upsert(
      collaboratorRows.map((collaborator) => ({
        task_id: task.id,
        agent_id: collaborator.id,
        role: collaborator.role,
      }))
    );

    if (collaboratorError) throw new Error(collaboratorError.message);
  }

  const slackThreadTs = params.threadTs || params.messageTs || null;
  if (params.messageTs) {
    await admin.from("slack_message_mappings").upsert({
      scout_message_id: message.id,
      slack_team_id: params.teamId,
      slack_channel_id: params.channelId,
      slack_message_ts: params.messageTs,
      slack_thread_ts: slackThreadTs,
    });
  }

  return {
    taskId: task.id,
    taskNumber: task.task_number,
    messageId: message.id,
    scoutChannelId,
    slackThreadTs,
    assigneeName,
    assigneeHandle,
    collaborators,
  };
}

export async function postTaskCreatedToSlack(ref: SlackMessageRef, result: SlackTaskResult) {
  const admin = createAdminClient();
  const leadAgentId = result.collaborators.find((agent) => agent.role === "lead")?.id || null;
  let token: string | null = null;
  if (leadAgentId) {
    const { data: app } = await admin
      .from("slack_agent_apps")
      .select("bot_access_token_encrypted")
      .eq("agent_id", leadAgentId)
      .eq("install_status", "installed")
      .maybeSingle();
    token = decryptSecret(app?.bot_access_token_encrypted);
  }

  const collaboratorNames = result.collaborators
    .filter((agent) => agent.role === "collaborator")
    .map((agent) => agent.displayName);
  const collaboratorText = collaboratorNames.length
    ? ` Collaborators: ${collaboratorNames.join(", ")}.`
    : "";
  const text = result.assigneeName
    ? `Scout created task #${result.taskNumber} and assigned lead agent ${result.assigneeName}.${collaboratorText} Coordination will continue in this Slack thread.`
    : `Scout created task #${result.taskNumber}. Configure SCOUT_SLACK_LEAD_AGENT_ID or SCOUT_SLACK_DEFAULT_AGENT_ID to have Scout run Slack tasks automatically.`;
  const ts = await postSlackMessage(ref.channelId, text, ref.threadTs || ref.messageTs || result.slackThreadTs, token || undefined);
  return ts;
}

export async function mapSlackMessageToScout(params: {
  teamId: string;
  channelId: string;
  slackMessageTs: string;
  slackThreadTs?: string | null;
  scoutMessageId: string;
}) {
  const admin = createAdminClient();
  await admin.from("slack_message_mappings").upsert({
    scout_message_id: params.scoutMessageId,
    slack_team_id: params.teamId,
    slack_channel_id: params.channelId,
    slack_message_ts: params.slackMessageTs,
    slack_thread_ts: params.slackThreadTs || params.slackMessageTs,
  });
}
