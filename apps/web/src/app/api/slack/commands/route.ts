import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import {
  createTaskFromSlackMessage,
  mapSlackMessageToScout,
  postTaskCreatedToSlack,
  verifySlackRequest,
} from "@/lib/slack/scout-slack";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!verifySlackRequest(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const teamId = form.get("team_id");
  const channelId = form.get("channel_id");
  const userId = form.get("user_id");
  const text = form.get("text") || "";
  const responseUrl = form.get("response_url");

  if (!teamId || !channelId) {
    return NextResponse.json({ response_type: "ephemeral", text: "Slack team and channel are required." });
  }

  after(async () => {
    try {
      const result = await createTaskFromSlackMessage({
        teamId,
        channelId,
        userId,
        text,
      });

      let threadTs: string | null = null;
      let slackPostError: string | null = null;

      try {
        if (result.created) {
          threadTs = await postTaskCreatedToSlack(
            { teamId, channelId, messageTs: "", threadTs: null },
            result
          );
        }
      } catch (err) {
        slackPostError = err instanceof Error ? err.message : String(err);
        console.warn("[Slack] Could not post task confirmation:", slackPostError);
      }

      if (threadTs) {
        await mapSlackMessageToScout({
          teamId,
          channelId,
          slackMessageTs: threadTs,
          slackThreadTs: threadTs,
          scoutMessageId: result.messageId,
        });
      }

      if (responseUrl) {
        await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response_type: "ephemeral",
            text: `Created Scout task #${result.taskNumber}${result.assigneeName ? ` and assigned lead agent ${result.assigneeName}` : ""}${threadTs ? " and posted the coordination thread to the channel" : ""}${!result.assigneeName ? ". No Slack lead agent is configured yet, so it will not run automatically" : ""}${slackPostError ? `. I could not post in this Slack channel: ${slackPostError}` : ""}.`,
          }),
        }).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (responseUrl) {
        await fetch(responseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response_type: "ephemeral", text: `Scout could not create the task: ${message}` }),
        }).catch(() => undefined);
      }
    }
  });

  return NextResponse.json({ response_type: "ephemeral", text: "Scout is creating the task..." });
}
