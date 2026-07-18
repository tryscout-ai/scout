import { createAdminClient } from "@/lib/supabase/admin";

type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_type: "human" | "agent" | "system";
  content: string;
  thread_parent_id: string | null;
};

type Agent = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  system_prompt: string | null;
  model: string;
};

const mentionBoundary = "[\\s,.:!?，。！？、】【；]|$";
const maxOutputTokens = Number(process.env.SCOUT_MAX_OUTPUT_TOKENS || 2_048);

function isMentioned(content: string, agent: Agent) {
  const names = [agent.display_name, agent.name, agent.display_name.replace(/\s+/g, "")];
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`@${escaped}(?=${mentionBoundary})`, "i").test(content);
  });
}

function modelFor(agent: Agent) {
  // Existing workspaces may store provider-specific labels such as "sonnet".
  // A deployment-wide override keeps the hosted runtime independent of those labels.
  if (process.env.SCOUT_LLM_MODEL) return process.env.SCOUT_LLM_MODEL;
  return ["opus", "sonnet", "haiku"].includes(agent.model)
    ? "gpt-4.1-mini"
    : agent.model;
}

async function generateReply(agent: Agent, prompt: string, history: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const system = [
    agent.system_prompt || `You are ${agent.display_name}, a helpful Scout agent.`,
    "Reply directly to the user. If another agent should take the next step, mention that agent exactly once.",
  ].join("\n\n");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelFor(agent),
      temperature: 0.2,
      max_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
        ? maxOutputTokens
        : 2_048,
      messages: [
        { role: "system", content: system },
        ...(history ? [{ role: "user", content: history }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Model request failed: ${await response.text()}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Wake agents for one message. This is deliberately stateless: every web
 * instance can process a request, so no browser or local bridge is required.
 */
export async function dispatchMessage(message: Message): Promise<void> {
  if (message.sender_type === "system") return;

  const supabase = createAdminClient();
  const [{ data: channel }, { data: memberships }] = await Promise.all([
    supabase.from("channels").select("type, name").eq("id", message.channel_id).single(),
    supabase
      .from("channel_members")
      .select("member_id")
      .eq("channel_id", message.channel_id)
      .eq("member_type", "agent"),
  ]);
  if (!channel || !memberships?.length) return;

  const agentIds = memberships.map((membership) => membership.member_id);
  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, display_name, description, system_prompt, model")
    .in("id", agentIds);
  if (!agents?.length) return;

  let targets = channel.type === "dm" && message.sender_type === "human"
    ? agents as Agent[]
    : (agents as Agent[]).filter((agent) => isMentioned(message.content, agent));
  if (message.sender_type === "agent") targets = targets.filter((agent) => agent.id !== message.sender_id);
  if (!targets.length) return;

  const [{ data: sender }, { data: recentMessages }] = await Promise.all([
    message.sender_type === "human"
      ? supabase.from("profiles").select("display_name").eq("id", message.sender_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      .select("sender_id, sender_type, content")
      .eq("channel_id", message.channel_id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const history = (recentMessages || []).reverse().map((entry) =>
    `[${entry.sender_type === "human" ? "User" : "Agent"}]: ${entry.content}`
  ).join("\n");
  const senderName = sender?.display_name || (message.sender_type === "agent" ? "Agent" : "User");

  await Promise.all(targets.map(async (agent) => {
    await supabase.from("agents").update({ status: "online" }).eq("id", agent.id);
    const reply = await generateReply(
      agent,
      `[target=${channel.type === "dm" ? `dm:@${senderName}` : `#${channel.name}`} sender=@${senderName}] ${message.content}`,
      history,
    );
    if (!reply) return;
    const { data: inserted, error } = await supabase.from("messages").insert({
      channel_id: message.channel_id,
      sender_id: agent.id,
      sender_type: "agent",
      content: reply,
      ...(message.thread_parent_id ? { thread_parent_id: message.thread_parent_id } : {}),
    }).select("id, channel_id, sender_id, sender_type, content, thread_parent_id").single();
    if (error) throw new Error(error.message);
    await dispatchMessage(inserted as Message);
  }));
}
