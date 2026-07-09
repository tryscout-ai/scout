import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/slack/crypto";
import {
  createTaskFromSlackMessage,
  postTaskCreatedToSlack,
  verifySlackRequest,
} from "@/lib/slack/scout-slack";

interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
}

interface SlackEventEnvelope {
  type: "event_callback";
  team_id: string;
  api_app_id?: string;
  event: {
    type: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
}

type SlackBlock = Record<string, unknown>;

interface SlackInteractionPayload {
  type: "block_actions" | "view_submission" | "message_action";
  api_app_id?: string;
  trigger_id?: string;
  team?: { id: string };
  user?: { id: string };
  channel?: { id: string };
  message?: {
    ts?: string;
    thread_ts?: string;
  };
  actions?: Array<{
    action_id: string;
    value?: string;
  }>;
  view?: {
    callback_id: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, { type?: string; value?: string }>>;
    };
  };
}

interface DraftActionMetadata {
  taskId: string;
  scoutMessageId: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
}

function stripBotMentions(text: string) {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

async function signingSecretForApp(apiAppId: string | undefined) {
  if (!apiAppId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("slack_agent_apps")
    .select("signing_secret_encrypted")
    .eq("slack_app_id", apiAppId)
    .maybeSingle();

  return decryptSecret(data?.signing_secret_encrypted);
}

async function botTokenForApp(apiAppId: string | undefined) {
  if (!apiAppId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("slack_agent_apps")
    .select("bot_access_token_encrypted")
    .eq("slack_app_id", apiAppId)
    .maybeSingle();

  return decryptSecret(data?.bot_access_token_encrypted);
}

function defaultHumanId() {
  return process.env.SCOUT_SLACK_DEFAULT_HUMAN_ID || process.env.SCOUT_SLACK_USER_ID || null;
}

function truncateSlackText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function parseDraftMetadata(value: string | undefined): DraftActionMetadata {
  if (!value) throw new Error("Missing draft action metadata");
  const parsed = JSON.parse(value) as Partial<DraftActionMetadata>;
  if (!parsed.taskId || !parsed.scoutMessageId) {
    throw new Error("Invalid draft action metadata");
  }
  return {
    taskId: parsed.taskId,
    scoutMessageId: parsed.scoutMessageId,
  };
}

function modalValue(
  payload: SlackInteractionPayload,
  blockId: string,
  actionId: string
) {
  return payload.view?.state?.values?.[blockId]?.[actionId]?.value?.trim() || "";
}

function draftStateBlocks(params: {
  title: string;
  agentName: string;
  taskNumber: number;
  draft: string;
  stateText: string;
}): SlackBlock[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: truncateSlackText(`${params.title} - Task #${params.taskNumber}`, 150),
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
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: params.stateText,
        },
      ],
    },
  ];
}

async function slackApi(
  method: string,
  token: string,
  body: Record<string, unknown>
) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const result = (await response.json()) as SlackApiResponse;
  if (!result.ok) throw new Error(result.error || `Slack ${method} failed`);
  return result;
}

async function mentionedAgentsForText(text: string) {
  const botIds = Array.from(text.matchAll(/<@([A-Z0-9]+)>/g)).map((match) => match[1]);
  if (botIds.length === 0) return [];

  const admin = createAdminClient();
  const { data: apps } = await admin
    .from("slack_agent_apps")
    .select("agent_id, slack_bot_user_id, agents(id, name, display_name)")
    .in("slack_bot_user_id", botIds)
    .eq("install_status", "installed");

  const ordered: Array<{ id: string; name: string; displayName: string }> = [];
  for (const botId of botIds) {
    const app = (apps || []).find((item) => item.slack_bot_user_id === botId);
    const agent = firstRelation(
      app?.agents as
        | { id: string; name: string; display_name: string }
        | Array<{ id: string; name: string; display_name: string }>
        | null
        | undefined
    );
    if (agent && !ordered.some((existing) => existing.id === agent.id)) {
      ordered.push({
        id: agent.id,
        name: agent.name,
        displayName: agent.display_name,
      });
    }
  }

  return ordered;
}

async function loadDraftContext(metadata: DraftActionMetadata) {
  const admin = createAdminClient();
  const { data: task, error: taskError } = await admin
    .from("tasks")
    .select("id, task_number, status, channel_id, message_id, assignee_id, assignee_type")
    .eq("id", metadata.taskId)
    .maybeSingle();
  if (taskError || !task) {
    throw new Error(taskError?.message || "Task not found");
  }

  const { data: draft, error: draftError } = await admin
    .from("messages")
    .select("id, channel_id, sender_id, sender_type, content, thread_parent_id")
    .eq("id", metadata.scoutMessageId)
    .maybeSingle();
  if (draftError || !draft) {
    throw new Error(draftError?.message || "Draft message not found");
  }

  const { data: mapping, error: mappingError } = await admin
    .from("slack_message_mappings")
    .select("slack_channel_id, slack_message_ts, slack_thread_ts")
    .eq("scout_message_id", metadata.scoutMessageId)
    .maybeSingle();
  if (mappingError || !mapping) {
    throw new Error(mappingError?.message || "Slack draft mapping not found");
  }

  const { data: agent } = await admin
    .from("agents")
    .select("id, name, display_name")
    .eq("id", draft.sender_id)
    .maybeSingle();

  return {
    admin,
    task,
    draft,
    mapping,
    agentName: (agent?.display_name as string | undefined) || "Agent",
    agentHandle: (agent?.name as string | undefined) || null,
  };
}

async function markTaskDone(taskId: string) {
  const admin = createAdminClient();
  const { data: task, error: loadError } = await admin
    .from("tasks")
    .select("id, status")
    .eq("id", taskId)
    .maybeSingle();
  if (loadError || !task) throw new Error(loadError?.message || "Task not found");
  if (task.status === "done") return false;

  const { error } = await admin
    .from("tasks")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw new Error(error.message);
  return true;
}

async function openDraftEditModal(payload: SlackInteractionPayload, metadata: DraftActionMetadata, token: string) {
  if (!payload.trigger_id) throw new Error("Missing Slack trigger_id");
  const { draft } = await loadDraftContext(metadata);
  await slackApi("views.open", token, {
    trigger_id: payload.trigger_id,
    view: {
      type: "modal",
      callback_id: "scout_draft_edit_submit",
      private_metadata: JSON.stringify(metadata),
      title: { type: "plain_text", text: "Edit draft", emoji: true },
      submit: { type: "plain_text", text: "Send", emoji: true },
      close: { type: "plain_text", text: "Cancel", emoji: true },
      blocks: [
        {
          type: "input",
          block_id: "draft_text",
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            initial_value: truncateSlackText(draft.content as string, 3000),
          },
          label: { type: "plain_text", text: "Draft", emoji: true },
        },
      ],
    },
  });
}

async function openDraftRejectModal(payload: SlackInteractionPayload, metadata: DraftActionMetadata, token: string) {
  if (!payload.trigger_id) throw new Error("Missing Slack trigger_id");
  await slackApi("views.open", token, {
    trigger_id: payload.trigger_id,
    view: {
      type: "modal",
      callback_id: "scout_draft_reject_submit",
      private_metadata: JSON.stringify(metadata),
      title: { type: "plain_text", text: "Request changes", emoji: true },
      submit: { type: "plain_text", text: "Send", emoji: true },
      close: { type: "plain_text", text: "Cancel", emoji: true },
      blocks: [
        {
          type: "input",
          block_id: "change_request",
          element: {
            type: "plain_text_input",
            action_id: "value",
            multiline: true,
            placeholder: { type: "plain_text", text: "What should change?", emoji: true },
          },
          label: { type: "plain_text", text: "What should change?", emoji: true },
        },
      ],
    },
  });
}

async function approveDraft(payload: SlackInteractionPayload, metadata: DraftActionMetadata, token: string) {
  const context = await loadDraftContext(metadata);
  const changed = await markTaskDone(metadata.taskId);
  if (!changed) return;

  const taskNumber = context.task.task_number as number;
  const channelId = context.mapping.slack_channel_id as string;
  const messageTs = context.mapping.slack_message_ts as string;
  const threadTs = (context.mapping.slack_thread_ts as string | null) || messageTs;
  const approvedBy = payload.user?.id ? `<@${payload.user.id}>` : "A reviewer";
  const blocks = draftStateBlocks({
    title: "Draft approved",
    agentName: context.agentName,
    taskNumber,
    draft: context.draft.content as string,
    stateText: `Approved by ${approvedBy}.`,
  });

  await slackApi("chat.update", token, {
    channel: channelId,
    ts: messageTs,
    text: `Draft approved for task #${taskNumber}.`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  });

  await slackApi("chat.postMessage", token, {
    channel: channelId,
    thread_ts: threadTs,
    text: `Approved by ${approvedBy}. Scout marked task #${taskNumber} complete.`,
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function submitEditedDraft(payload: SlackInteractionPayload, metadata: DraftActionMetadata, token: string) {
  const editedText = modalValue(payload, "draft_text", "value");
  if (!editedText) {
    return { response_action: "errors", errors: { draft_text: "Draft text is required." } };
  }

  const context = await loadDraftContext(metadata);
  const changed = await markTaskDone(metadata.taskId);
  if (!changed) return {};

  const taskNumber = context.task.task_number as number;
  const channelId = context.mapping.slack_channel_id as string;
  const messageTs = context.mapping.slack_message_ts as string;
  const threadTs = (context.mapping.slack_thread_ts as string | null) || messageTs;
  const editedBy = payload.user?.id ? `<@${payload.user.id}>` : "A reviewer";

  await slackApi("chat.postMessage", token, {
    channel: channelId,
    thread_ts: threadTs,
    text: `Approved edited draft for task #${taskNumber}:\n${editedText}`,
    unfurl_links: false,
    unfurl_media: false,
  });

  await slackApi("chat.update", token, {
    channel: channelId,
    ts: messageTs,
    text: `Draft edited and approved for task #${taskNumber}.`,
    blocks: draftStateBlocks({
      title: "Draft edited and approved",
      agentName: context.agentName,
      taskNumber,
      draft: editedText,
      stateText: `Edited and sent by ${editedBy}.`,
    }),
    unfurl_links: false,
    unfurl_media: false,
  });

  return {};
}

async function submitRejectedDraft(payload: SlackInteractionPayload, metadata: DraftActionMetadata, token: string) {
  const instructions = modalValue(payload, "change_request", "value");
  if (!instructions) {
    return { response_action: "errors", errors: { change_request: "Revision instructions are required." } };
  }

  const context = await loadDraftContext(metadata);
  const targetAgentId =
    (context.task.assignee_id as string | null) ||
    (context.draft.sender_type === "agent" ? context.draft.sender_id as string : null);
  const humanId = defaultHumanId();
  if (!targetAgentId) throw new Error("No agent is available for revision");
  if (!humanId) throw new Error("Missing SCOUT_SLACK_DEFAULT_HUMAN_ID for revision requests");

  const mention = context.agentHandle ? `@${context.agentHandle}` : context.agentName;
  const taskNumber = context.task.task_number as number;
  const channelId = context.mapping.slack_channel_id as string;
  const messageTs = context.mapping.slack_message_ts as string;
  const requestedBy = payload.user?.id ? `<@${payload.user.id}>` : "A reviewer";
  const revisionContent =
    `${mention} Revision requested from Slack for task #${taskNumber}:\n` +
    `${instructions}\n\n` +
    "Please post exactly one revised draft only. Do not include the previous draft, " +
    "multiple options, explanations, or labels like \"Outreach Agent:\". When the revised draft is ready, mark the task in_review.";

  const { error: updateError } = await context.admin
    .from("tasks")
    .update({
      assignee_id: targetAgentId,
      assignee_type: "agent",
      status: "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", metadata.taskId);
  if (updateError) throw new Error(updateError.message);

  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: existingRevision, error: existingRevisionError } = await context.admin
    .from("messages")
    .select("id")
    .eq("channel_id", context.task.channel_id)
    .eq("sender_id", humanId)
    .eq("sender_type", "human")
    .eq("thread_parent_id", context.task.message_id)
    .eq("content", revisionContent)
    .gte("created_at", since)
    .maybeSingle();
  if (existingRevisionError) throw new Error(existingRevisionError.message);

  if (!existingRevision) {
    const { error: insertError } = await context.admin.from("messages").insert({
      channel_id: context.task.channel_id,
      sender_id: humanId,
      sender_type: "human",
      content: revisionContent,
      thread_parent_id: context.task.message_id,
    });
    if (insertError) throw new Error(insertError.message);
  }

  await slackApi("chat.update", token, {
    channel: channelId,
    ts: messageTs,
    text: `Changes requested for task #${taskNumber}.`,
    blocks: draftStateBlocks({
      title: "Changes requested",
      agentName: context.agentName,
      taskNumber,
      draft: context.draft.content as string,
      stateText: `Changes requested by ${requestedBy}. The agent will post an updated draft here.`,
    }),
    unfurl_links: false,
    unfurl_media: false,
  });

  return {};
}

async function handleSlackInteraction(payload: SlackInteractionPayload) {
  const token = await botTokenForApp(payload.api_app_id);
  if (!token) throw new Error("Missing Slack bot token for interactive payload");

  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    const metadata = parseDraftMetadata(action?.value);

    if (action?.action_id === "scout_draft_approve") {
      await approveDraft(payload, metadata, token);
    } else if (action?.action_id === "scout_draft_edit") {
      await openDraftEditModal(payload, metadata, token);
    } else if (action?.action_id === "scout_draft_reject") {
      await openDraftRejectModal(payload, metadata, token);
    }
    return {};
  }

  if (payload.type === "view_submission") {
    const metadata = parseDraftMetadata(payload.view?.private_metadata);
    if (payload.view?.callback_id === "scout_draft_edit_submit") {
      return submitEditedDraft(payload, metadata, token);
    }
    if (payload.view?.callback_id === "scout_draft_reject_submit") {
      return submitRejectedDraft(payload, metadata, token);
    }
  }

  return {};
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(rawBody);
    const payloadText = form.get("payload");
    if (!payloadText) {
      return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }

    const payload = JSON.parse(payloadText) as SlackInteractionPayload;
    const signingSecret = await signingSecretForApp(payload.api_app_id);
    const timestamp = request.headers.get("x-slack-request-timestamp");
    const signature = request.headers.get("x-slack-signature");
    if (!verifySlackRequest(rawBody, timestamp, signature, signingSecret || undefined)) {
      return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
    }

    try {
      const response = await handleSlackInteraction(payload);
      return NextResponse.json(response);
    } catch (err) {
      console.error("[Slack] Interactive payload failed:", err);
      return NextResponse.json({ ok: true });
    }
  }

  const parsed = JSON.parse(rawBody) as SlackUrlVerification | SlackEventEnvelope;

  if (parsed.type === "url_verification") {
    return NextResponse.json({ challenge: parsed.challenge });
  }

  const signingSecret = await signingSecretForApp(parsed.api_app_id);
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!verifySlackRequest(rawBody, timestamp, signature, signingSecret || undefined)) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  if (parsed.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = parsed.event;
  if (
    event.bot_id ||
    event.subtype ||
    !event.channel ||
    !event.ts ||
    !event.text ||
    !["app_mention", "message"].includes(event.type)
  ) {
    return NextResponse.json({ ok: true });
  }

  const mentionedAgents = await mentionedAgentsForText(event.text);
  if (mentionedAgents.length === 0) {
    console.warn("[Slack] Agent event did not resolve mentioned bot", {
      apiAppId: parsed.api_app_id,
      teamId: parsed.team_id,
      eventType: event.type,
      text: event.text,
    });
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await createTaskFromSlackMessage({
      teamId: parsed.team_id,
      channelId: event.channel,
      userId: event.user,
      text: stripBotMentions(event.text) || event.text,
      messageTs: event.ts,
      threadTs: event.thread_ts || event.ts,
      mentionedAgents,
    });

    if (result.created) {
      await postTaskCreatedToSlack(
        {
          teamId: parsed.team_id,
          channelId: event.channel,
          messageTs: event.ts,
          threadTs: event.thread_ts || event.ts,
        },
        result
      );
    }
  } catch (err) {
    console.error("[Slack] Agent event handling failed:", err);
  }

  return NextResponse.json({ ok: true });
}
