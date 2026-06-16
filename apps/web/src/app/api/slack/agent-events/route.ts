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

function stripBotMentions(text: string) {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
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
    const agent = app?.agents as { id: string; name: string; display_name: string } | null | undefined;
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

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
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

    await postTaskCreatedToSlack(
      {
        teamId: parsed.team_id,
        channelId: event.channel,
        messageTs: event.ts,
        threadTs: event.thread_ts || event.ts,
      },
      result
    );
  } catch (err) {
    console.error("[Slack] Agent event handling failed:", err);
  }

  return NextResponse.json({ ok: true });
}
