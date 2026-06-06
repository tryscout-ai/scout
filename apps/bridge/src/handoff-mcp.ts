#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

type SenderType = "human" | "agent" | "system";

const SUPABASE_URL = process.env.SCOUT_SUPABASE_URL;
const SUPABASE_KEY = process.env.SCOUT_SUPABASE_SERVICE_ROLE_KEY || process.env.SCOUT_SUPABASE_KEY;
const DEFAULT_HUMAN_ID = process.env.SCOUT_SLACK_DEFAULT_HUMAN_ID || process.env.SCOUT_SLACK_USER_ID;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SCOUT_SUPABASE_URL and SCOUT_SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function text(content: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(content, null, 2) }],
  };
}

async function resolveAgent(agentRef: string) {
  const clean = agentRef.replace(/^@/, "");
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, display_name, description, status, server_id")
    .or(`id.eq.${clean},name.eq.${clean},display_name.eq.${clean}`)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error(`Agent not found: ${agentRef}`);
  }
  return data;
}

async function resolveTask(taskNumber: number) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, task_number, status, assignee_id, assignee_type, channel_id, message_id")
    .eq("task_number", taskNumber)
    .single();

  if (error || !data) {
    throw new Error(`Task #${taskNumber} not found`);
  }
  return data;
}

async function insertSystemMessage(params: {
  channelId: string;
  content: string;
  threadParentId?: string | null;
}) {
  const senderId = DEFAULT_HUMAN_ID;
  if (!senderId) {
    throw new Error("Missing SCOUT_SLACK_DEFAULT_HUMAN_ID for system-style handoff messages");
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      channel_id: params.channelId,
      sender_id: senderId,
      sender_type: "system" satisfies SenderType,
      content: params.content,
      thread_parent_id: params.threadParentId || null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

async function slackThreadForMessage(messageId: string) {
  const { data } = await supabase
    .from("slack_message_mappings")
    .select("slack_team_id, slack_channel_id, slack_message_ts, slack_thread_ts")
    .eq("scout_message_id", messageId)
    .single();
  return data || null;
}

async function postSlack(channelId: string, textValue: string, threadTs?: string | null) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: channelId,
      text: textValue,
      thread_ts: threadTs || undefined,
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const body = (await response.json()) as { ok: boolean; error?: string; ts?: string };
  if (!body.ok) throw new Error(body.error || "Slack chat.postMessage failed");
  return body.ts || null;
}

const server = new McpServer({
  name: "scout-handoff",
  version: "0.1.0",
});

server.registerTool(
  "list_agents",
  {
    title: "List Scout agents",
    description: "List Scout agents available for handoff, optionally scoped by server.",
    inputSchema: {
      server_id: z.string().uuid().optional(),
    },
  },
  async ({ server_id }) => {
    let query = supabase
      .from("agents")
      .select("id, name, display_name, description, status, server_id")
      .order("display_name");

    if (server_id) query = query.eq("server_id", server_id);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return text({ agents: data || [] });
  }
);

server.registerTool(
  "create_task_from_slack_message",
  {
    title: "Create Scout task from Slack message",
    description: "Create a Scout message and task from a Slack message using configured Slack channel mappings.",
    inputSchema: {
      slack_team_id: z.string(),
      slack_channel_id: z.string(),
      slack_message_ts: z.string().optional(),
      slack_thread_ts: z.string().optional(),
      text: z.string(),
      sender_id: z.string().uuid().optional(),
    },
  },
  async ({ slack_team_id, slack_channel_id, slack_message_ts, slack_thread_ts, text: messageText, sender_id }) => {
    const { data: mapping } = await supabase
      .from("slack_channel_mappings")
      .select("scout_channel_id")
      .eq("slack_team_id", slack_team_id)
      .eq("slack_channel_id", slack_channel_id)
      .single();

    const channelId = mapping?.scout_channel_id || process.env.SCOUT_SLACK_DEFAULT_CHANNEL_ID;
    const senderId = sender_id || DEFAULT_HUMAN_ID;
    if (!channelId) throw new Error("No Scout channel mapping found for Slack channel");
    if (!senderId) throw new Error("Missing sender_id or SCOUT_SLACK_DEFAULT_HUMAN_ID");

    if (slack_message_ts) {
      const { data: existingMapping } = await supabase
        .from("slack_message_mappings")
        .select("scout_message_id")
        .eq("slack_team_id", slack_team_id)
        .eq("slack_channel_id", slack_channel_id)
        .eq("slack_message_ts", slack_message_ts)
        .single();

      if (existingMapping?.scout_message_id) {
        const { data: existingTask } = await supabase
          .from("tasks")
          .select("id, task_number, message_id, channel_id, status")
          .eq("message_id", existingMapping.scout_message_id)
          .single();
        if (existingTask) return text({ task: existingTask, duplicate: true });
      }
    }

    const { data: message, error: messageError } = await supabase
      .from("messages")
      .insert({
        channel_id: channelId,
        sender_id: senderId,
        sender_type: "human" satisfies SenderType,
        content: messageText,
      })
      .select("id")
      .single();
    if (messageError) throw new Error(messageError.message);

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .insert({ message_id: message.id, channel_id: channelId })
      .select("id, task_number, status, message_id, channel_id")
      .single();
    if (taskError) throw new Error(taskError.message);

    if (slack_message_ts) {
      await supabase.from("slack_message_mappings").upsert({
        scout_message_id: message.id,
        slack_team_id,
        slack_channel_id,
        slack_message_ts,
        slack_thread_ts: slack_thread_ts || slack_message_ts,
      });
    }

    return text({ task, duplicate: false });
  }
);

server.registerTool(
  "claim_task",
  {
    title: "Claim Scout task",
    description: "Assign a Scout task to an agent and mark it in progress.",
    inputSchema: {
      task_number: z.number().int().positive(),
      agent: z.string(),
    },
  },
  async ({ task_number, agent }) => {
    const task = await resolveTask(task_number);
    const assignee = await resolveAgent(agent);

    const { error } = await supabase
      .from("tasks")
      .update({
        assignee_id: assignee.id,
        assignee_type: "agent",
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    if (error) throw new Error(error.message);

    const content = `Scout task #${task.task_number} claimed by @${assignee.name}.`;
    await insertSystemMessage({
      channelId: task.channel_id,
      content,
      threadParentId: task.message_id,
    });

    return text({ task_number, assignee, status: "in_progress" });
  }
);

server.registerTool(
  "handoff_task",
  {
    title: "Handoff Scout task",
    description: "Transfer a Scout task between agents with context and a next action.",
    inputSchema: {
      task_number: z.number().int().positive(),
      source_agent: z.string(),
      target_agent: z.string(),
      reason: z.string(),
      summary: z.string(),
      next_action: z.string(),
    },
  },
  async ({ task_number, source_agent, target_agent, reason, summary, next_action }) => {
    const task = await resolveTask(task_number);
    const source = await resolveAgent(source_agent);
    const target = await resolveAgent(target_agent);

    const { error: updateError } = await supabase
      .from("tasks")
      .update({
        assignee_id: target.id,
        assignee_type: "agent",
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    if (updateError) throw new Error(updateError.message);

    const handoffText =
      `Handoff: task #${task.task_number} moved from @${source.name} to @${target.name}.\n` +
      `Reason: ${reason}\n` +
      `Summary: ${summary}\n` +
      `Next action: ${next_action}`;

    const handoffMessageId = await insertSystemMessage({
      channelId: task.channel_id,
      content: handoffText,
      threadParentId: task.message_id,
    });

    const { data: handoff, error: handoffError } = await supabase
      .from("agent_handoffs")
      .insert({
        task_id: task.id,
        message_id: handoffMessageId,
        channel_id: task.channel_id,
        source_agent_id: source.id,
        target_agent_id: target.id,
        reason,
        summary,
        next_action,
      })
      .select("id, created_at")
      .single();
    if (handoffError) throw new Error(handoffError.message);

    const slackRef = await slackThreadForMessage(task.message_id);
    let slackTs: string | null = null;
    if (slackRef) {
      slackTs = await postSlack(
        slackRef.slack_channel_id,
        handoffText,
        slackRef.slack_thread_ts || slackRef.slack_message_ts
      );
    }

    return text({ handoff, task_number, source, target, slack_ts: slackTs });
  }
);

server.registerTool(
  "post_handoff_summary",
  {
    title: "Post handoff summary",
    description: "Post a final or interim handoff summary to Scout and the mapped Slack thread.",
    inputSchema: {
      task_number: z.number().int().positive(),
      summary: z.string(),
      status: z.enum(["todo", "in_progress", "in_review", "done"]).optional(),
    },
  },
  async ({ task_number, summary, status }) => {
    const task = await resolveTask(task_number);
    if (status) {
      const { error } = await supabase
        .from("tasks")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", task.id);
      if (error) throw new Error(error.message);
    }

    const messageId = await insertSystemMessage({
      channelId: task.channel_id,
      content: summary,
      threadParentId: task.message_id,
    });

    const slackRef = await slackThreadForMessage(task.message_id);
    let slackTs: string | null = null;
    if (slackRef) {
      slackTs = await postSlack(
        slackRef.slack_channel_id,
        summary,
        slackRef.slack_thread_ts || slackRef.slack_message_ts
      );
    }

    return text({ message_id: messageId, task_number, status: status || task.status, slack_ts: slackTs });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
