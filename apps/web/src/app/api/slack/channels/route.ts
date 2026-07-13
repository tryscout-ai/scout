import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  ensureSlackDemoAgents,
  ensureSlackServer,
  getSlackHome,
  getWorkspaceBotToken,
  listSlackChannels,
  mapAgentToSlackChannel,
  mapDemoAgentsToSlackChannel,
} from "@/lib/slack/platform";
import { postSlackMessage } from "@/lib/slack/scout-slack";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const home = await getSlackHome(user.id);
    if (!home.workspace) return NextResponse.json({ channels: [] });
    const channels = await listSlackChannels(home.workspace.id);
    return NextResponse.json({ channels });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const agentId = String(body.agent_id || "");
  const slackChannelId = String(body.slack_channel_id || "");
  const slackChannelName = String(body.slack_channel_name || slackChannelId);
  const demo = Boolean(body.demo);

  if ((!demo && !agentId) || !slackChannelId) {
    return NextResponse.json({ error: "agent_id and slack_channel_id are required" }, { status: 400 });
  }

  try {
    const server = await ensureSlackServer(user.id);
    const home = await getSlackHome(user.id);
    if (!home.workspace) return NextResponse.json({ error: "Connect Slack first" }, { status: 400 });

    if (demo) {
      const demoTeam = await ensureSlackDemoAgents(user.id);
      await mapDemoAgentsToSlackChannel({
        userId: user.id,
        workspaceId: home.workspace.id,
        serverId: server.id,
        agents: demoTeam.agents,
        slackTeamId: home.workspace.slack_team_id,
        slackChannelId,
        slackChannelName,
      });
      const token = await getWorkspaceBotToken(home.workspace.id);
      if (!token) {
        return NextResponse.json(
          { error: "Demo setup saved, but Scout could not post to Slack because the workspace bot token is missing. Reconnect Slack and try again." },
          { status: 500 }
        );
      }
      await postSlackMessage(
        slackChannelId,
        [
          "Scout hosted demo is ready.",
          "",
          "Mention @Scout in this channel with a lead or task. If the managed bridge is offline, the server fallback will still run Research, Enrichment, and Outreach here for the demo.",
        ].join("\n"),
        null,
        token
      );
      return NextResponse.json({ ok: true, agents: demoTeam.agents.length });
    }

    await mapAgentToSlackChannel({
      userId: user.id,
      workspaceId: home.workspace.id,
      serverId: server.id,
      agentId,
      slackTeamId: home.workspace.slack_team_id,
      slackChannelId,
      slackChannelName,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
