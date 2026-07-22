import { NextRequest, NextResponse } from "next/server";
import { ensureOrganizationSummary, summaryErrorMessage } from "@/lib/organization-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Regenerates the compact prompt summary without changing the raw onboarding fields. */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: server, error } = await admin
    .from("servers")
    .select("id, owner_id")
    .eq("id", id)
    .single();

  if (error || !server) {
    const message = error ? summaryErrorMessage(error) : "Workspace not found";
    return NextResponse.json({ error: message }, { status: error ? 500 : 404 });
  }
  if (server.owner_id !== user.id) {
    return NextResponse.json({ error: "Only workspace owners can regenerate the summary" }, { status: 403 });
  }

  let summary;
  try {
    summary = await ensureOrganizationSummary(admin, server.id, {
      force: true,
    });
  } catch (summaryError) {
    return NextResponse.json({ error: summaryErrorMessage(summaryError) }, { status: 500 });
  }

  const response = {
    organizationSummary: summary.organizationSummary,
    summaryStatus: summary.summaryStatus,
  };

  return NextResponse.json(response, {
    status: summary.summaryStatus === "ready" ? 200 : 202,
  });
}
