import { NextRequest } from "next/server";

import { handleWorkspaceSlackOAuthCallback } from "@/lib/slack/oauth-callback";

export async function GET(request: NextRequest) {
  return handleWorkspaceSlackOAuthCallback(request);
}
