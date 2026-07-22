import { NextRequest, NextResponse } from "next/server";
import { dispatchMessage } from "@/lib/agent-dispatcher";
import { ensureOrganizationSummary, summaryErrorMessage } from "@/lib/organization-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function hasFreshBridgeHeartbeat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  channelId: string
) {
  const { data: channel } = await supabase
    .from("channels")
    .select("server_id")
    .eq("id", channelId)
    .single();
  if (!channel?.server_id) return false;

  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: keys } = await supabase
    .from("machine_keys")
    .select("id")
    .eq("server_id", channel.server_id)
    .gte("last_used_at", since)
    .limit(1);

  return Boolean(keys?.length);
}

async function getChannelServerId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  channelId: string,
) {
  const { data: channel } = await supabase
    .from("channels")
    .select("server_id")
    .eq("id", channelId)
    .single();

  return channel?.server_id ?? null;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.channel_id || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "channel_id and content are required" }, { status: 400 });
  }

  const serverId = await getChannelServerId(supabase, body.channel_id);
  if (serverId) {
    try {
      await ensureOrganizationSummary(createAdminClient(), serverId);
    } catch (summaryError) {
      console.warn(
        `Message context repair failed for workspace ${serverId}: ${summaryErrorMessage(summaryError)}`,
      );
    }
  }

  const { data: message, error } = await supabase.from("messages").insert({
    channel_id: body.channel_id,
    sender_id: user.id,
    sender_type: "human",
    content: body.content.trim(),
    ...(body.thread_parent_id ? { thread_parent_id: body.thread_parent_id } : {}),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!(await hasFreshBridgeHeartbeat(supabase, body.channel_id))) {
    try {
      await dispatchMessage(message);
    } catch (dispatchError) {
      console.error("Agent dispatch fallback failed", dispatchError);
    }
  }

  return NextResponse.json({ message });
}
