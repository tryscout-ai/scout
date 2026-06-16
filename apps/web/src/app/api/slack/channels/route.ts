import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  ensureSlackServer,
  getSlackHome,
  listSlackChannels,
  mapAgentToSlackChannel,
} from "@/lib/slack/platform";

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

  if (!agentId || !slackChannelId) {
    return NextResponse.json({ error: "agent_id and slack_channel_id are required" }, { status: 400 });
  }

  try {
    const server = await ensureSlackServer(user.id);
    const home = await getSlackHome(user.id);
    if (!home.workspace) return NextResponse.json({ error: "Connect Slack first" }, { status: 400 });

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
