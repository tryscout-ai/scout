import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeSlackCode, normalizeSlackReturnTo, storeWorkspaceInstall } from "@/lib/slack/platform";
import { verifySlackOAuthState } from "@/lib/slack/oauth-state";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/slack?error=missing-slack-oauth", request.url));
  }

  const payload = verifySlackOAuthState(state);
  if (!payload || payload.kind !== "workspace") {
    return NextResponse.redirect(new URL("/slack?error=invalid-slack-oauth", request.url));
  }

  try {
    const admin = createAdminClient();
    const { data: server, error } = await admin
      .from("servers")
      .select("id, owner_id")
      .eq("id", payload.id)
      .single();

    if (error || !server) throw new Error(error?.message || "Slack workspace server not found");

    const oauth = await exchangeSlackCode({ code, redirectPath: "/api/slack/oauth/callback" });
    if (!oauth.team?.id) throw new Error("Slack OAuth response did not include a team");

    await storeWorkspaceInstall({
      userId: server.owner_id,
      serverId: server.id,
      teamId: oauth.team.id,
      teamName: oauth.team.name,
      botUserId: oauth.bot_user_id,
      botAccessToken: oauth.access_token,
      userAccessToken: oauth.authed_user?.access_token,
    });

    return NextResponse.redirect(new URL(normalizeSlackReturnTo(payload.returnTo), request.url));
  } catch (err) {
    const message = encodeURIComponent(err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(new URL(`/slack?error=${message}`, request.url));
  }
}
