import { NextRequest, NextResponse } from "next/server";

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
  event: {
    type: string;
    channel?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
  };
}

interface SlackShortcutPayload {
  type: "message_action";
  team: { id: string };
  channel: { id: string };
  user: { id: string };
  message: {
    text?: string;
    ts: string;
    thread_ts?: string;
  };
}

function stripBotMention(text: string) {
  return text.replace(/^<@[^>]+>\s*/, "").trim();
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("application/x-www-form-urlencoded")) {
    const body = JSON.parse(rawBody) as SlackUrlVerification | SlackEventEnvelope;
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }
  }

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!verifySlackRequest(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(rawBody);
    const payloadText = form.get("payload");
    if (!payloadText) {
      return NextResponse.json({ error: "Missing payload" }, { status: 400 });
    }

    const payload = JSON.parse(payloadText) as SlackShortcutPayload;
    if (payload.type !== "message_action") {
      return NextResponse.json({ ok: true });
    }

    try {
      const result = await createTaskFromSlackMessage({
        teamId: payload.team.id,
        channelId: payload.channel.id,
        userId: payload.user.id,
        text: payload.message.text || "Slack message task",
        messageTs: payload.message.ts,
        threadTs: payload.message.thread_ts || payload.message.ts,
      });

      if (result.created) {
        await postTaskCreatedToSlack(
          {
            teamId: payload.team.id,
            channelId: payload.channel.id,
            messageTs: payload.message.ts,
            threadTs: payload.message.thread_ts || payload.message.ts,
          },
          result
        );
      }
    } catch (err) {
      console.error("[Slack] Message action failed:", err);
    }

    return NextResponse.json({ ok: true });
  }

  const body = JSON.parse(rawBody) as SlackUrlVerification | SlackEventEnvelope;

  if (body.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;
  if (event.bot_id || event.type !== "app_mention" || !event.channel || !event.ts) {
    return NextResponse.json({ ok: true });
  }

  try {
    const result = await createTaskFromSlackMessage({
      teamId: body.team_id,
      channelId: event.channel,
      userId: event.user,
      text: stripBotMention(event.text || ""),
      messageTs: event.ts,
      threadTs: event.thread_ts || event.ts,
    });

    if (result.created) {
      await postTaskCreatedToSlack(
        {
          teamId: body.team_id,
          channelId: event.channel,
          messageTs: event.ts,
          threadTs: event.thread_ts || event.ts,
        },
        result
      );
    }
  } catch (err) {
    console.error("[Slack] Event handling failed:", err);
  }

  return NextResponse.json({ ok: true });
}
