import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  createAgentSlackApp,
  createScoutAgent,
  ensureSlackServer,
  getSlackHome,
} from "@/lib/slack/platform";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getSlackHome(user.id));
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const displayName = String(body.display_name || "").trim();
  if (!displayName) return NextResponse.json({ error: "display_name is required" }, { status: 400 });

  try {
    const referer = request.headers.get("referer");
    const requestedReturnTo = String(body.returnTo || "");
    const returnTo = requestedReturnTo.startsWith(request.nextUrl.origin)
      ? requestedReturnTo
      : requestedReturnTo.startsWith("/")
        ? new URL(requestedReturnTo, request.nextUrl.origin).toString()
        : referer?.startsWith(request.nextUrl.origin)
          ? referer
          : new URL("/slack", request.url).toString();

    const server = await ensureSlackServer(user.id);
    const home = await getSlackHome(user.id);
    if (!home.workspace) {
      return NextResponse.json({ error: "Connect Slack before creating Slack agents" }, { status: 400 });
    }

    const agent = await createScoutAgent({
      userId: user.id,
      serverId: server.id,
      displayName,
      description: body.description,
      systemPrompt: body.system_prompt,
      model: body.model,
    });

    const app = await createAgentSlackApp({
      workspaceId: home.workspace.id,
      agentId: agent.id,
      appName: displayName,
      description: body.description,
      returnTo,
    });

    return NextResponse.json({ agent, app });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
