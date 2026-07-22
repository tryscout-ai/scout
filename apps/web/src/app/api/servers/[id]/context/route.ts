import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getMissingWorkspaceContextFields,
  isWorkspaceContextComplete,
  normalizeWorkspaceContext,
} from "@/lib/workspace-context";
import { ensureOrganizationSummary } from "@/lib/organization-summary";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CONTEXT_COLUMNS =
  "id, owner_id, company_name, company_website, company_description, icp, niche, agent_goals, current_workflow, context_notes, organization_summary, organization_summary_updated_at, organization_summary_error, onboarding_completed_at";

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: server, error } = await supabase
    .from("servers")
    .select(CONTEXT_COLUMNS)
    .eq("id", id)
    .single();

  if (error || !server) {
    return NextResponse.json({ error: error?.message || "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({ context: server });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: server } = await supabase
    .from("servers")
    .select("id, owner_id")
    .eq("id", id)
    .single();

  if (!server) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (server.owner_id !== user.id) {
    return NextResponse.json({ error: "Only workspace owners can update context" }, { status: 403 });
  }

  const body = await request.json();
  const normalized = normalizeWorkspaceContext(body);
  const missing = getMissingWorkspaceContextFields(normalized);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: "Missing required workspace context", missing },
      { status: 400 },
    );
  }

  const { data: updated, error } = await supabase
    .from("servers")
    .update({
      ...normalized,
      organization_summary: null,
      organization_summary_updated_at: null,
      organization_summary_error: null,
      onboarding_completed_at: isWorkspaceContextComplete(normalized)
        ? new Date().toISOString()
        : null,
    })
    .eq("id", id)
    .select(CONTEXT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = await ensureOrganizationSummary(supabase, updated.id, {
    force: true,
    select: CONTEXT_COLUMNS,
  });

  return NextResponse.json({
    context: summary.server,
    summaryStatus: summary.summaryStatus,
  });
}
