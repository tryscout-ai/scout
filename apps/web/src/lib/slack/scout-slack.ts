import { createHmac, timingSafeEqual } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";

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

export interface SlackTaskResult {
  taskId: string;
  taskNumber: number;
  messageId: string;
  scoutChannelId: string;
  slackThreadTs: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
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

export async function postSlackMessage(channel: string, text: string, threadTs?: string | null) {
  const token = requireEnv("SLACK_BOT_TOKEN");
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

  return data?.scout_channel_id || process.env.SCOUT_SLACK_DEFAULT_CHANNEL_ID || null;
}

function defaultHumanId() {
  return process.env.SCOUT_SLACK_DEFAULT_HUMAN_ID || process.env.SCOUT_SLACK_USER_ID || null;
}

export async function createTaskFromSlackMessage(params: {
  teamId: string;
  channelId: string;
  text: string;
  userId?: string | null;
  messageTs?: string | null;
  threadTs?: string | null;
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
    })
    .select("id, task_number")
    .single();

  if (taskError) throw new Error(taskError.message);

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
  };
}

export async function postTaskCreatedToSlack(ref: SlackMessageRef, result: SlackTaskResult) {
  const text = `Scout created task #${result.taskNumber}. Agents can claim it in Scout; handoffs will stay in this Slack thread.`;
  const ts = await postSlackMessage(ref.channelId, text, ref.threadTs || ref.messageTs || result.slackThreadTs);
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
