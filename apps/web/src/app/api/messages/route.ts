import { NextRequest, NextResponse } from "next/server";
import { dispatchMessage } from "@/lib/agent-dispatcher";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.channel_id || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "channel_id and content are required" }, { status: 400 });
  }
  const { data: message, error } = await supabase.from("messages").insert({
    channel_id: body.channel_id,
    sender_id: user.id,
    sender_type: "human",
    content: body.content.trim(),
    ...(body.thread_parent_id ? { thread_parent_id: body.thread_parent_id } : {}),
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    await dispatchMessage(message);
  } catch (dispatchError) {
    console.error("Agent dispatch failed", dispatchError);
  }
  return NextResponse.json({ message });
}
