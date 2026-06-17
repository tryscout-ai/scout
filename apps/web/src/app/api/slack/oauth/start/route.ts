import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { baseSlackInstallUrl, ensureSlackServer, normalizeSlackReturnTo } from "@/lib/slack/platform";
import { createSlackOAuthState } from "@/lib/slack/oauth-state";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const server = await ensureSlackServer(user.id);
  const requestedReturnTo = request.nextUrl.searchParams.get("returnTo");
  const returnTo = normalizeSlackReturnTo(
    requestedReturnTo && requestedReturnTo.startsWith(request.nextUrl.origin)
      ? requestedReturnTo
      : requestedReturnTo && requestedReturnTo.startsWith("/")
        ? new URL(requestedReturnTo, request.nextUrl.origin).toString()
        : new URL("/slack", request.url).toString()
  );
  const state = createSlackOAuthState({ kind: "workspace", id: server.id, returnTo });

  return NextResponse.redirect(baseSlackInstallUrl(state));
}
