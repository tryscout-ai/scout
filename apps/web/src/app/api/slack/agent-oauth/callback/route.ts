import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { installAgentApp } from "@/lib/slack/platform";
import { verifySlackOAuthState } from "@/lib/slack/oauth-state";

function slackInstallErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("public.slack_workspaces") || message.includes("schema cache")) {
    return "Slack schema is not applied to the connected Supabase project yet. Run `pnpm db:push` after linking Supabase CLI to this project.";
  }
  return message;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/slack?error=missing-agent-oauth", request.url));
  }

  const payload = verifySlackOAuthState(state);
  if (!payload || payload.kind !== "agent") {
    return NextResponse.redirect(new URL("/slack?error=invalid-agent-oauth", request.url));
  }

  try {
    const admin = createAdminClient();
    const { data: app, error } = await admin
      .from("slack_agent_apps")
      .select("*, slack_workspaces(owner_id)")
      .eq("id", payload.id)
      .single();

    if (error || !app) throw new Error(error?.message || "Slack agent app not found");

    await installAgentApp({ app, code });
    return NextResponse.redirect(new URL(payload.returnTo, request.url));
  } catch (err) {
    const message = encodeURIComponent(slackInstallErrorMessage(err));
    return NextResponse.redirect(new URL(`/slack?error=${message}`, request.url));
  }
}
