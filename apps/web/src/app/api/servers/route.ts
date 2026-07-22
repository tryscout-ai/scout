import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateOrganizationSummary } from "@/lib/organization-summary";
import {
  isWorkspaceContextComplete,
  normalizeWorkspaceContext,
} from "@/lib/workspace-context";

// GET /api/servers — list servers the user belongs to
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get servers where user is a member
  const { data: memberships } = await supabase
    .from("server_members")
    .select("server_id")
    .eq("member_id", user.id)
    .eq("member_type", "human");

  if (!memberships || memberships.length === 0) {
    return NextResponse.json({ servers: [] });
  }

  const serverIds = memberships.map((m) => m.server_id);
  const { data: servers, error } = await supabase
    .from("servers")
    .select("*")
    .in("id", serverIds)
    .order("created_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ servers: servers ?? [] });
}

// POST /api/servers — create a new server
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, slug: userSlug } = body;
  const workspaceContext = normalizeWorkspaceContext(body);

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Use user-provided slug or generate from name
  const rawSlug = (userSlug?.trim() || name.trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!rawSlug) {
    return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
  }

  // Check slug uniqueness
  const { data: existing } = await supabase
    .from("servers")
    .select("id")
    .eq("slug", rawSlug)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "This slug is already taken. Please choose another one." },
      { status: 409 }
    );
  }

  const slug = rawSlug;

  const { data: server, error } = await supabase
    .from("servers")
    .insert({
      name: name.trim(),
      slug,
      description: description?.trim() || null,
      ...workspaceContext,
      onboarding_completed_at: isWorkspaceContextComplete(workspaceContext)
        ? new Date().toISOString()
        : null,
      owner_id: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Add creator as owner member
  await supabase.from("server_members").insert({
    server_id: server.id,
    member_id: user.id,
    member_type: "human",
    role: "owner",
  });

  try {
    const organizationSummary = await generateOrganizationSummary(server);
    const { data: summarized, error: summaryUpdateError } = await supabase
      .from("servers")
      .update({
        organization_summary: organizationSummary,
        organization_summary_updated_at: new Date().toISOString(),
        organization_summary_error: null,
      })
      .eq("id", server.id)
      .select()
      .single();
    if (summaryUpdateError) throw summaryUpdateError;
    return NextResponse.json({ server: summarized, summaryStatus: "ready" });
  } catch (summaryError) {
    const message = summaryError instanceof Error ? summaryError.message : String(summaryError);
    console.warn(`Organization summary generation failed for ${server.id}: ${message}`);
    await supabase
      .from("servers")
      .update({ organization_summary_error: message.slice(0, 500) })
      .eq("id", server.id);
    return NextResponse.json({ server, summaryStatus: "pending" });
  }
}
