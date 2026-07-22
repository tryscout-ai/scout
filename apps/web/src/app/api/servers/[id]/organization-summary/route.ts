import { NextRequest, NextResponse } from "next/server";
import { generateOrganizationSummary } from "@/lib/organization-summary";
import { createClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const SUMMARY_SOURCE_COLUMNS =
  "id, owner_id, company_name, company_website, company_description, icp, niche, agent_goals, current_workflow, context_notes";

/** Regenerates the compact prompt summary without changing the raw onboarding fields. */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: server, error } = await supabase
    .from("servers")
    .select(SUMMARY_SOURCE_COLUMNS)
    .eq("id", id)
    .single();

  if (error || !server) {
    return NextResponse.json({ error: error?.message || "Workspace not found" }, { status: 404 });
  }
  if (server.owner_id !== user.id) {
    return NextResponse.json({ error: "Only workspace owners can regenerate the summary" }, { status: 403 });
  }

  try {
    const organizationSummary = await generateOrganizationSummary(server);
    const { error: updateError } = await supabase
      .from("servers")
      .update({
        organization_summary: organizationSummary,
        organization_summary_updated_at: new Date().toISOString(),
        organization_summary_error: null,
      })
      .eq("id", id);
    if (updateError) throw updateError;

    return NextResponse.json({ organizationSummary, summaryStatus: "ready" });
  } catch (summaryError) {
    const message = summaryError instanceof Error ? summaryError.message : String(summaryError);
    console.warn(`Organization summary regeneration failed for ${id}: ${message}`);
    await supabase
      .from("servers")
      .update({ organization_summary_error: message.slice(0, 500) })
      .eq("id", id);
    return NextResponse.json({ summaryStatus: "pending" }, { status: 202 });
  }
}
