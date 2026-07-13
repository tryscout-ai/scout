import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createTaskFromSlackMessage,
  postTaskCreatedToSlack,
  runHostedSlackDemoFallback,
} from "@/lib/slack/scout-slack";
import { getSlackHome, getWorkspaceBotToken } from "@/lib/slack/platform";

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{
    type?: string;
    subtype?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  }>;
}

async function slackHistory(channel: string, token: string) {
  const url = new URL("https://slack.com/api/conversations.history");
  url.searchParams.set("channel", channel);
  url.searchParams.set("limit", "15");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as SlackHistoryResponse;
  if (!body.ok) throw new Error(body.error || "Could not poll Slack channel");
  return body.messages || [];
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const home = await getSlackHome(user.id);
    if (!home.workspace) return NextResponse.json({ ok: true, processed: 0 });

    const token = await getWorkspaceBotToken(home.workspace.id);
    if (!token) return NextResponse.json({ ok: true, processed: 0 });

    const admin = createAdminClient();
    const { data: workspace } = await admin
      .from("slack_workspaces")
      .select("bot_user_id")
      .eq("id", home.workspace.id)
      .maybeSingle();

    const botUserId = workspace?.bot_user_id as string | null | undefined;
    if (!botUserId) return NextResponse.json({ ok: true, processed: 0 });

    let processed = 0;
    for (const mapping of home.channelMappings) {
      const channelId = mapping.slack_channel_id as string;
      const messages = await slackHistory(channelId, token);

      for (const message of messages.reverse()) {
        if (
          message.bot_id ||
          message.subtype ||
          message.type !== "message" ||
          !message.user ||
          !message.ts ||
          !message.text?.includes(`<@${botUserId}>`)
        ) {
          continue;
        }

        const result = await createTaskFromSlackMessage({
          teamId: home.workspace.slack_team_id,
          channelId,
          userId: message.user,
          text: message.text.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim() || message.text,
          messageTs: message.ts,
          threadTs: message.thread_ts || message.ts,
        });

        const ref = {
          teamId: home.workspace.slack_team_id,
          channelId,
          messageTs: message.ts,
          threadTs: message.thread_ts || message.ts,
        };
        const fallbackHandled = await runHostedSlackDemoFallback(ref, result, { force: true });
        if (!fallbackHandled && result.created) {
          await postTaskCreatedToSlack(ref, result);
        }
        if (result.created || fallbackHandled) processed += 1;
      }
    }

    return NextResponse.json({ ok: true, processed });
  } catch (err) {
    console.error("[Slack] Poll failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
