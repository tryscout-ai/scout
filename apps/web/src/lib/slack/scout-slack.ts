import { createHmac, timingSafeEqual } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/slack/crypto";
import { SLACK_DEMO_AGENT_HANDLES } from "@/lib/slack/platform";

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

type SlackBlock = Record<string, unknown>;

interface SlackAgentMention {
  id: string;
  name: string;
  displayName: string;
}

interface SlackChannelResolution {
  scoutChannelId: string | null;
  serverId: string | null;
  humanId: string | null;
}

export interface SlackTaskResult {
  taskId: string;
  taskNumber: number;
  messageId: string;
  scoutChannelId: string;
  serverId: string | null;
  slackThreadTs: string | null;
  created: boolean;
  assigneeName: string | null;
  assigneeHandle: string | null;
  collaborators: Array<{ id: string; name: string; displayName: string; role: "lead" | "collaborator" }>;
}

function isUniqueViolation(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || error?.message?.includes("duplicate key value");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findTaskForSlackMessage(
  admin: SupabaseAdmin,
  params: Pick<SlackMessageRef, "teamId" | "channelId" | "messageTs">,
  attempts = 1
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: existingMapping } = await admin
      .from("slack_message_mappings")
      .select("scout_message_id, slack_thread_ts")
      .eq("slack_team_id", params.teamId)
      .eq("slack_channel_id", params.channelId)
      .eq("slack_message_ts", params.messageTs)
      .maybeSingle();

    if (existingMapping?.scout_message_id) {
      const { data: existingTask } = await admin
        .from("tasks")
        .select("id, task_number, message_id, channel_id")
        .eq("message_id", existingMapping.scout_message_id)
        .maybeSingle();

      if (existingTask) {
        return {
          taskId: existingTask.id as string,
          taskNumber: existingTask.task_number as number,
          messageId: existingTask.message_id as string,
          scoutChannelId: existingTask.channel_id as string,
          slackThreadTs: (existingMapping.slack_thread_ts as string | null) || params.messageTs,
        };
      }
    }

    if (attempt < attempts - 1) await sleep(250);
  }

  return null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function isBridgeRecentlyOnline(admin: SupabaseAdmin, serverId: string | null) {
  if (!serverId) return null;

  const { data, error } = await admin
    .from("machine_keys")
    .select("last_used_at")
    .eq("server_id", serverId)
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    console.warn("[Slack] Could not check bridge heartbeat:", error.message);
    return null;
  }

  const lastUsedAt = data?.[0]?.last_used_at;
  if (!lastUsedAt) return false;

  return Date.now() - new Date(lastUsedAt as string).getTime() < 90_000;
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

async function postSlackMessageWithBlocks(
  channel: string,
  text: string,
  blocks: SlackBlock[],
  threadTs: string | null,
  token: string
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
      blocks,
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

function slackChannelNameFromId(slackChannelId: string) {
  return `slack-${slackChannelId.toLowerCase()}`;
}

async function resolveMappedChannel(
  admin: SupabaseAdmin,
  teamId: string,
  slackChannelId: string
): Promise<SlackChannelResolution> {
  const { data: workspace } = await admin
    .from("slack_workspaces")
    .select("server_id, owner_id")
    .eq("slack_team_id", teamId)
    .maybeSingle();

  const { data } = await admin
    .from("slack_channel_mappings")
    .select("server_id, scout_channel_id, channels(name)")
    .eq("slack_team_id", teamId)
    .eq("slack_channel_id", slackChannelId)
    .maybeSingle();

  if (workspace && data?.server_id !== workspace.server_id) {
    const channelsRelation = data?.channels as { name: string } | Array<{ name: string }> | null | undefined;
    const existingChannelName = Array.isArray(channelsRelation)
      ? channelsRelation[0]?.name
      : channelsRelation?.name;
    const channelName = existingChannelName || slackChannelNameFromId(slackChannelId);

    const { data: existingChannel } = await admin
      .from("channels")
      .select("id")
      .eq("server_id", workspace.server_id)
      .eq("name", channelName)
      .maybeSingle();

    const scoutChannel = existingChannel || (await admin
      .from("channels")
      .insert({
        name: channelName,
        description: `Slack channel ${slackChannelId}`,
        type: "public",
        server_id: workspace.server_id,
        created_by: workspace.owner_id,
      })
      .select("id")
      .single()).data;

    if (scoutChannel) {
      await admin.from("slack_channel_mappings").upsert({
        server_id: workspace.server_id,
        scout_channel_id: scoutChannel.id,
        slack_team_id: teamId,
        slack_channel_id: slackChannelId,
      }, { onConflict: "slack_team_id,slack_channel_id" });

      console.log("[Slack] Repaired channel mapping", {
        slackTeamId: teamId,
        slackChannelId,
        scoutChannelId: scoutChannel.id,
        serverId: workspace.server_id,
      });

      return {
        scoutChannelId: scoutChannel.id,
        serverId: workspace.server_id,
        humanId: workspace.owner_id,
      };
    }
  }

  const mappedChannelId =
    data?.scout_channel_id || process.env.SCOUT_SLACK_DEFAULT_CHANNEL_ID || null;

  console.log("[Slack] Channel resolution", {
    slackTeamId: teamId,
    slackChannelId,
    mappedScoutChannelId: data?.scout_channel_id || null,
    fallbackScoutChannelId: process.env.SCOUT_SLACK_DEFAULT_CHANNEL_ID || null,
    resolvedScoutChannelId: mappedChannelId,
  });

  return {
    scoutChannelId: mappedChannelId,
    serverId: (data?.server_id as string | undefined) || (workspace?.server_id as string | undefined) || null,
    humanId: (workspace?.owner_id as string | undefined) || defaultHumanId(),
  };
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

async function filterMentionedAgentsForServer(
  admin: SupabaseAdmin,
  serverId: string | null,
  mentionedAgents: SlackAgentMention[]
) {
  if (!serverId || mentionedAgents.length === 0) return mentionedAgents;

  const { data: agents } = await admin
    .from("agents")
    .select("id")
    .eq("server_id", serverId)
    .in("id", mentionedAgents.map((agent) => agent.id));

  const validAgentIds = new Set((agents || []).map((agent) => agent.id as string));
  return mentionedAgents.filter((agent) => validAgentIds.has(agent.id));
}

async function ensureSlackTaskChannelMembers(
  admin: SupabaseAdmin,
  resolution: SlackChannelResolution,
  mentionedAgents: SlackAgentMention[]
) {
  if (!resolution.scoutChannelId) return;

  const rows: Array<{ channel_id: string; member_id: string; member_type: "human" | "agent" }> = [
    resolution.humanId
      ? {
          channel_id: resolution.scoutChannelId,
          member_id: resolution.humanId,
          member_type: "human" as const,
        }
      : null,
    ...mentionedAgents.map((agent) => ({
      channel_id: resolution.scoutChannelId,
      member_id: agent.id,
      member_type: "agent" as const,
    })),
  ].filter((row): row is { channel_id: string; member_id: string; member_type: "human" | "agent" } => Boolean(row));

  if (rows.length === 0) return;
  await admin.from("channel_members").upsert(rows);
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

  if (!memberships || memberships.length === 0) {
    return { agentId: null, assigneeName: null, assigneeHandle: null };
  }

  const memberIds = memberships.map((membership) => membership.member_id as string);
  const { data: channelAgents } = await admin
    .from("agents")
    .select("id, name, display_name")
    .in("id", memberIds);

  const demoLead = (channelAgents || []).find(
    (agent) => agent.display_name === SLACK_DEMO_AGENT_HANDLES.research
  );
  if (demoLead) {
    return {
      agentId: demoLead.id as string,
      assigneeName: demoLead.display_name as string,
      assigneeHandle: demoLead.name as string,
    };
  }

  if (memberships.length !== 1) {
    return { agentId: null, assigneeName: null, assigneeHandle: null };
  }

  const agentId = memberIds[0];
  const agent = (channelAgents || []).find((item) => item.id === agentId);

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
  const channelResolution = await resolveMappedChannel(admin, params.teamId, params.channelId);
  const scoutChannelId = channelResolution.scoutChannelId;
  const humanId = channelResolution.humanId || defaultHumanId();

  if (!scoutChannelId) {
    throw new Error("No Scout channel mapping found for this Slack channel");
  }
  if (!humanId) {
    throw new Error("Missing SCOUT_SLACK_DEFAULT_HUMAN_ID for Slack-originated Scout messages");
  }
  const rawBotMentionedAgents = params.mentionedAgents || await resolveMentionedSlackBotAgents(admin, scoutChannelId, params.text);
  const botMentionedAgents = await filterMentionedAgentsForServer(
    admin,
    channelResolution.serverId,
    rawBotMentionedAgents
  );
  await ensureSlackTaskChannelMembers(admin, channelResolution, botMentionedAgents);

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
    const existingTask = await findTaskForSlackMessage(admin, {
      teamId: params.teamId,
      channelId: params.channelId,
      messageTs: params.messageTs,
    });

    if (existingTask) {
      return {
        ...existingTask,
        serverId: channelResolution.serverId,
        created: false,
        assigneeName,
        assigneeHandle,
        collaborators,
      };
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

  const slackThreadTs = params.threadTs || params.messageTs || null;
  if (params.messageTs) {
    const { error: mappingError } = await admin.from("slack_message_mappings").insert({
      scout_message_id: message.id,
      slack_team_id: params.teamId,
      slack_channel_id: params.channelId,
      slack_message_ts: params.messageTs,
      slack_thread_ts: slackThreadTs,
    });

    if (mappingError) {
      await admin.from("messages").delete().eq("id", message.id);

      if (!isUniqueViolation(mappingError)) {
        throw new Error(mappingError.message);
      }

      const existingTask = await findTaskForSlackMessage(
        admin,
        {
          teamId: params.teamId,
          channelId: params.channelId,
          messageTs: params.messageTs,
        },
        12
      );

      if (!existingTask) {
        throw new Error("Slack message is already being processed");
      }

      return {
        ...existingTask,
        serverId: channelResolution.serverId,
        created: false,
        assigneeName,
        assigneeHandle,
        collaborators,
      };
    }
  }

  const { data: task, error: taskError } = await admin
    .from("tasks")
    .insert({
      message_id: message.id,
      channel_id: scoutChannelId,
      assignee_id: agentId,
      assignee_type: agentId ? "agent" : null,
      status: "todo",
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

  return {
    taskId: task.id,
    taskNumber: task.task_number,
    messageId: message.id,
    scoutChannelId,
    serverId: channelResolution.serverId,
    slackThreadTs,
    created: true,
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
  if (!token) {
    const { data: workspace } = await admin
      .from("slack_workspaces")
      .select("bot_access_token_encrypted")
      .eq("slack_team_id", ref.teamId)
      .maybeSingle();
    token = decryptSecret(workspace?.bot_access_token_encrypted);
  }

  const collaboratorNames = result.collaborators
    .filter((agent) => agent.role === "collaborator")
    .map((agent) => agent.displayName);
  const collaboratorText = collaboratorNames.length
    ? ` Collaborators: ${collaboratorNames.join(", ")}.`
    : "";
  const bridgeOnline = await isBridgeRecentlyOnline(admin, result.serverId);
  let text: string;

  if (!result.assigneeName) {
    text = `Scout created task #${result.taskNumber}. Configure SCOUT_SLACK_LEAD_AGENT_ID or SCOUT_SLACK_DEFAULT_AGENT_ID to have Scout run Slack tasks automatically.`;
  } else if (bridgeOnline === false) {
    text = `Scout created task #${result.taskNumber} and assigned lead agent ${result.assigneeName}.${collaboratorText} The local Scout bridge is offline, so this task is queued. Start the bridge and ${result.assigneeName} will continue in this Slack thread.`;
  } else {
    text = `Scout created task #${result.taskNumber} and assigned lead agent ${result.assigneeName}.${collaboratorText} ${result.assigneeName} should post a kickoff here shortly.`;
  }

  const ts = await postSlackMessage(ref.channelId, text, ref.threadTs || ref.messageTs || result.slackThreadTs, token || undefined);
  return ts;
}

function truncateSlackText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function demoDraftBlocks(params: {
  agentName: string;
  taskNumber: number;
  taskId: string;
  scoutMessageId: string;
  draft: string;
}): SlackBlock[] {
  const actionValue = JSON.stringify({
    taskId: params.taskId,
    scoutMessageId: params.scoutMessageId,
  });

  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateSlackText(`Draft ready for review - Task #${params.taskNumber}`, 150),
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${params.agentName} drafted:*\n${truncateSlackText(params.draft, 2800)}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve", emoji: true },
          style: "primary",
          action_id: "scout_draft_approve",
          value: actionValue,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Edit", emoji: true },
          action_id: "scout_draft_edit",
          value: actionValue,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Reject", emoji: true },
          style: "danger",
          action_id: "scout_draft_reject",
          value: actionValue,
        },
      ],
    },
  ];
}

function demoReplyText(sourceText: string, agentName: string) {
  const request = truncateSlackText(sourceText.replace(/\s+/g, " ").trim(), 500);

  if (agentName === SLACK_DEMO_AGENT_HANDLES.research) {
    return [
      "Research summary:",
      `- Request: ${request}`,
      "- Signal: the company is actively feeling pain around outbound personalization and sales execution.",
      "- Suggested path: qualify the lead, enrich the pain points, then prepare one concise outreach draft.",
      "",
      "@Enrichment Agent can turn this into sharper buyer context and angles.",
    ].join("\n");
  }

  if (agentName === SLACK_DEMO_AGENT_HANDLES.enrichment) {
    return [
      "Enrichment notes:",
      "- Likely buyer: founder or early GTM lead trying to scale outbound beyond founder-led selling.",
      "- Strong angle: reduce manual personalization time while keeping messages specific to recent hiring and growth signals.",
      "- Risk to avoid: sounding like a generic AI prospecting pitch.",
      "",
      "@Outreach Agent please draft one short message for human review.",
    ].join("\n");
  }

  return [
    "Hi there, saw that you are scaling outbound and hiring your first SDR while experimenting with AI for prospecting.",
    "",
    "Scout could help your team turn public buying signals into specific, reviewable outreach drafts without losing the founder-led tone that worked early on.",
    "",
    "Worth a quick look this week?",
  ].join("\n");
}

export async function runHostedSlackDemoFallback(ref: SlackMessageRef, result: SlackTaskResult) {
  const admin = createAdminClient();
  const bridgeOnline = await isBridgeRecentlyOnline(admin, result.serverId);
  if (bridgeOnline !== false) return false;

  const { data: existingReplies } = await admin
    .from("messages")
    .select("id")
    .eq("thread_parent_id", result.messageId)
    .eq("sender_type", "agent")
    .limit(1);
  if (existingReplies && existingReplies.length > 0) return false;

  const { data: memberships } = await admin
    .from("channel_members")
    .select("member_id")
    .eq("channel_id", result.scoutChannelId)
    .eq("member_type", "agent");
  const memberIds = (memberships || []).map((membership) => membership.member_id as string);
  if (memberIds.length === 0) return false;

  const { data: agents } = await admin
    .from("agents")
    .select("id, name, display_name")
    .in("id", memberIds);
  const agentsByDisplayName = new Map(
    (agents || []).map((agent) => [agent.display_name as string, agent])
  );
  const demoAgents = [
    SLACK_DEMO_AGENT_HANDLES.research,
    SLACK_DEMO_AGENT_HANDLES.enrichment,
    SLACK_DEMO_AGENT_HANDLES.outreach,
  ].map((name) => agentsByDisplayName.get(name));

  if (demoAgents.some((agent) => !agent)) return false;

  const { data: workspace } = await admin
    .from("slack_workspaces")
    .select("bot_access_token_encrypted")
    .eq("slack_team_id", ref.teamId)
    .maybeSingle();
  const token = decryptSecret(workspace?.bot_access_token_encrypted);
  if (!token) return false;

  const { data: taskMessage, error: taskMessageError } = await admin
    .from("messages")
    .select("content")
    .eq("id", result.messageId)
    .maybeSingle();
  if (taskMessageError || !taskMessage) return false;

  const threadTs = ref.threadTs || ref.messageTs || result.slackThreadTs;
  let outreachMessageId: string | null = null;
  let outreachDraft = "";

  for (const agent of demoAgents) {
    if (!agent) continue;
    const agentName = agent.display_name as string;
    const content = demoReplyText(taskMessage.content as string, agentName);
    const { data: inserted, error } = await admin
      .from("messages")
      .insert({
        channel_id: result.scoutChannelId,
        sender_id: agent.id,
        sender_type: "agent",
        content,
        thread_parent_id: result.messageId,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message || "Could not create hosted demo reply");

    if (agentName === SLACK_DEMO_AGENT_HANDLES.outreach) {
      outreachMessageId = inserted.id as string;
      outreachDraft = content;
      continue;
    }

    await postSlackMessage(ref.channelId, `*${agentName}:*\n${content}`, threadTs, token);
  }

  const outreach = demoAgents[2];
  if (!outreach || !outreachMessageId) return false;

  const slackDraftTs = await postSlackMessageWithBlocks(
    ref.channelId,
    `Draft ready for review from ${SLACK_DEMO_AGENT_HANDLES.outreach} for task #${result.taskNumber}:\n${outreachDraft}`,
    demoDraftBlocks({
      agentName: SLACK_DEMO_AGENT_HANDLES.outreach,
      taskNumber: result.taskNumber,
      taskId: result.taskId,
      scoutMessageId: outreachMessageId,
      draft: outreachDraft,
    }),
    threadTs,
    token
  );

  if (slackDraftTs) {
    await admin.from("slack_message_mappings").upsert({
      scout_message_id: outreachMessageId,
      slack_team_id: ref.teamId,
      slack_channel_id: ref.channelId,
      slack_message_ts: slackDraftTs,
      slack_thread_ts: threadTs,
    });
  }

  await admin
    .from("tasks")
    .update({
      assignee_id: outreach.id,
      assignee_type: "agent",
      status: "in_review",
      updated_at: new Date().toISOString(),
    })
    .eq("id", result.taskId);

  console.log("[Slack] Hosted demo fallback completed", {
    taskId: result.taskId,
    taskNumber: result.taskNumber,
    scoutChannelId: result.scoutChannelId,
  });

  return true;
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
