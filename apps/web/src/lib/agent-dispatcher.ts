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

type WorkspaceContext = { organization_summary: string | null;
  company_name: string | null;
  company_website: string | null;
  company_description: string | null;
  icp: string | null;
  niche: string | null;
  agent_goals: string | null;
  current_workflow: string | null;
  context_notes: string | null;
};

type LlmProvider = {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

const salesHandoffStages = ["leadfinder", "enricher", "leadscorer", "outreach", "reviewer"] as const;
const mentionBoundary = "[\\s,.:!?，。！？、】【；]|$";
const maxOutputTokens = Number(process.env.SCOUT_MAX_OUTPUT_TOKENS || 2_048);
const contextMessageLimit = Number(process.env.SCOUT_CONTEXT_MESSAGE_LIMIT || 6);
const contextMessageChars = Number(process.env.SCOUT_CONTEXT_MESSAGE_CHARS || 400);

function summarizeProviderError(body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return (parsed.error?.message || parsed.message || body).replace(/\s+/g, " ").slice(0, 500);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 500);
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("")
    .trim();
}

function extractChatCompletionText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const response = data as { choices?: Array<{ message?: { content?: unknown } }>; output_text?: unknown };
  return extractText(response.choices?.[0]?.message?.content) || extractText(response.output_text);
}

function responseShape(data: unknown) {
  if (!data || typeof data !== "object") return typeof data;
  const response = data as { choices?: Array<{ message?: object }>; steps?: unknown[]; status?: string };
  const message = response.choices?.[0]?.message;
  return JSON.stringify({
    keys: Object.keys(data),
    status: response.status,
    stepCount: response.steps?.length,
    messageKeys: message ? Object.keys(message) : undefined,
  });
}

// function formatWorkspaceContext(context: WorkspaceContext | null) {
//   const summary = context?.organization_summary?.trim();
//   return summary ? `Organization summary (use this to tailor every response):\n${summary}` : "";
// }

function formatWorkspaceContext(context: WorkspaceContext | null) {
    if (!context) return "";

    const summary = context.organization_summary?.trim();
    if (summary) {
        return `Organization summary (use this to tailor every response):\n${summary}`;
    }

    const parts: string[] = [];

    if (context.company_name)
        parts.push(`- Company: ${context.company_name}`);

    if (context.company_website)
        parts.push(`- Website: ${context.company_website}`);

    if (context.company_description)
        parts.push(`- What the company does: ${context.company_description}`);

    if (context.icp)
        parts.push(`- Ideal customer profile: ${context.icp}`);

    if (context.niche)
        parts.push(`- Market: ${context.niche}`);

    if (context.agent_goals)
        parts.push(`- Agent goals: ${context.agent_goals}`);

    if (context.current_workflow)
        parts.push(`- Current workflow: ${context.current_workflow}`);

    if (context.context_notes)
        parts.push(`- Additional constraints: ${context.context_notes}`);

    return parts.length
        ? `Workspace context (use this to tailor every response):\n${parts.join("\n")}`
        : "";
}

function isMentioned(content: string, agent: Agent) {
  const names = [agent.display_name, agent.name, agent.display_name.replace(/\s+/g, "")];
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`@${escaped}(?=${mentionBoundary})`, "i").test(content);
  });
}

function findAgentByName(agents: Agent[], name: string) {
  const normalized = name.toLowerCase();
  return agents.find((agent) =>
    [agent.name, agent.display_name, agent.display_name.replace(/\s+/g, "")]
      .map((candidate) => candidate.toLowerCase())
      .includes(normalized)
  );
}

function getSalesHandoffStage(agentId: string, agents: Agent[]) {
  return salesHandoffStages.find((stage) => findAgentByName(agents, stage)?.id === agentId);
}

function getForwardHandoffTargets(message: Message, mentionedAgents: Agent[], agents: Agent[]) {
  const senderStage = getSalesHandoffStage(message.sender_id, agents);
  if (!senderStage) return [];

  const nextStage = salesHandoffStages[salesHandoffStages.indexOf(senderStage) + 1];
  if (!nextStage) return [];

  const nextAgent = findAgentByName(agents, nextStage);
  if (!nextAgent || !mentionedAgents.some((agent) => agent.id === nextAgent.id)) return [];

  return [nextAgent];
}

function modelFor(agent: Agent) {
  // Existing workspaces may store provider-specific labels such as "sonnet".
  // A deployment-wide override keeps the hosted runtime independent of those labels.
  if (process.env.SCOUT_LLM_MODEL) return process.env.SCOUT_LLM_MODEL;
  return ["opus", "sonnet", "haiku"].includes(agent.model)
    ? "gpt-4.1-mini"
    : agent.model;
}

function providersFor(agent: Agent): LlmProvider[] {
  const primaryKey = process.env.OPENAI_API_KEY;
  if (!primaryKey) throw new Error("OPENAI_API_KEY is not configured");

  const providers: LlmProvider[] = [{
    name: "primary",
    apiKey: primaryKey,
    baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: modelFor(agent),
  }];
  const fallbackKey = process.env.SCOUT_FALLBACK_OPENAI_API_KEY;
  const fallbackModel = process.env.SCOUT_FALLBACK_LLM_MODEL;
  if (fallbackKey && fallbackModel) {
    providers.push({
      name: "fallback",
      apiKey: fallbackKey,
      baseUrl: (process.env.SCOUT_FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: fallbackModel,
    });
  }
  return providers;
}

async function generateGeminiReply(system: string, prompt: string, history: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: process.env.SCOUT_GEMINI_MODEL || "gemini-3.5-flash",
      store: false,
      system_instruction: system,
      input: `${history ? `${history}\n\n` : ""}${prompt}`,
      generation_config: {
        max_output_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 2_048,
      },
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${summarizeProviderError(await response.text())}`);
  const data = (await response.json()) as {
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  const reply = data.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("")
    .trim() || "";
  if (!reply) console.warn(`Agent dispatch Gemini returned no text; response shape: ${responseShape(data)}.`);
  return reply;
}

async function generateNvidiaReply(system: string, prompt: string, history: string) {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  const model = process.env.SCOUT_NVIDIA_NIM_MODEL;
  if (!apiKey || !model) return null;

  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 2_048,
      messages: [
        { role: "system", content: system },
        ...(history ? [{ role: "user", content: history }] : []),
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${summarizeProviderError(await response.text())}`);
  const data = await response.json();
  const reply = extractChatCompletionText(data);
  if (!reply) console.warn(`Agent dispatch NVIDIA NIM returned no text; response shape: ${responseShape(data)}.`);
  return reply;
}

async function generateReply(
  agent: Agent,
  prompt: string,
  history: string,
  workspaceContext: WorkspaceContext | null,
) {
  console.log("workspaceContext =", JSON.stringify(workspaceContext, null, 2));

  const formattedContext = formatWorkspaceContext(workspaceContext);
  console.log("Formatted Context = ", formattedContext)
  const system = [
    agent.system_prompt || `You are ${agent.display_name}, a helpful Scout agent.`,
    formatWorkspaceContext(workspaceContext),
    "Reply directly to the user. If another agent should take the next step, mention that agent exactly once.",
  ].filter(Boolean).join("\n\n");
  console.log(system);
  let lastError = "";
  let shouldTryNextProvider = false;
  for (const provider of providersFor(agent)) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.2,
          max_tokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 2_048,
          messages: [
            { role: "system", content: system },
            ...(history ? [{ role: "user", content: history }] : []),
            { role: "user", content: prompt },
          ],
        }),
      });
      if (response.ok) {
        const data = await response.json();
        const reply = extractChatCompletionText(data);
        if (reply) {
          console.log(
    `[LLM] ${provider.name} -> ${provider.model} (${provider.baseUrl})`
  );
          return reply;
        }
        lastError = "Provider returned a successful response with no text content.";
        shouldTryNextProvider = true;
        console.warn(`Agent dispatch ${provider.name} (${provider.model}) returned no text; response shape: ${responseShape(data)}. Trying next provider.`);
        continue;
      }
      lastError = await response.text();
      // Quota exhaustion, rate limits, and temporary upstream failures may use the next provider.
      const reason = summarizeProviderError(lastError);
      if (![402, 429, 500, 502, 503, 504].includes(response.status)) {
        console.error(`Agent dispatch ${provider.name} (${provider.model}) failed with HTTP ${response.status}: ${reason}`);
        break;
      }
      shouldTryNextProvider = true;
      console.warn(`Agent dispatch ${provider.name} (${provider.model}) failed with HTTP ${response.status}: ${reason}. Trying next provider.`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      shouldTryNextProvider = true;
      console.warn(`Agent dispatch ${provider.name} (${provider.model}) request failed: ${lastError}. Trying next provider.`);
    }
  }
  if (shouldTryNextProvider && process.env.GEMINI_API_KEY) {
    try {
      const model = process.env.SCOUT_GEMINI_MODEL || "gemini-3.5-flash";
      console.warn(`Agent dispatch OpenAI-compatible providers failed; trying Gemini (${model}).`);
      const reply = await generateGeminiReply(system, prompt, history);
    if (reply) {
      console.log(`[LLM] Gemini -> ${model}`);
      return reply
    };
      lastError = "Gemini returned a successful response with no text content.";
      console.warn("Agent dispatch Gemini returned no text; trying next provider.");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`Agent dispatch Gemini failed: ${lastError}. Trying next provider.`);
    }
  } else if (shouldTryNextProvider) {
    console.warn("Agent dispatch Gemini fallback is not configured; skipping it.");
  }
  if (shouldTryNextProvider && process.env.NVIDIA_NIM_API_KEY && process.env.SCOUT_NVIDIA_NIM_MODEL) {
    try {
      console.warn(`Agent dispatch trying NVIDIA NIM (${process.env.SCOUT_NVIDIA_NIM_MODEL}).`);
      const reply = await generateNvidiaReply(system, prompt, history);
      if (reply) {
        console.log(`[LLM] NVIDIA NIM -> ${process.env.SCOUT_NVIDIA_NIM_MODEL}`);
        return reply;
      }
      lastError = "NVIDIA NIM returned a successful response with no text content.";
      console.warn("Agent dispatch NVIDIA NIM returned no text.");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(`Agent dispatch NVIDIA NIM failed: ${lastError}`);
    }
  } else if (shouldTryNextProvider) {
    console.warn("Agent dispatch NVIDIA NIM fallback is not configured; skipping it.");
  }
  throw new Error(`Model request failed: ${lastError}`);
}

/**
 * Wake agents for one message. This is deliberately stateless: every web
 * instance can process a request, so no browser or local bridge is required.
 */
export async function dispatchMessage(message: Message): Promise<void> {
  if (message.sender_type === "system") return;

  const supabase = createAdminClient();
  const [{ data: channel }, { data: memberships }] = await Promise.all([
    supabase.from("channels").select("type, name, server_id").eq("id", message.channel_id).single(),
    supabase
      .from("channel_members")
      .select("member_id")
      .eq("channel_id", message.channel_id)
      .eq("member_type", "agent"),
  ]);
  if (!channel || !memberships?.length) return;

  const agentIds = memberships.map((membership) => membership.member_id);
  const [{ data: agents }, { data: workspaceContext }] = await Promise.all([
    supabase
      .from("agents")
      .select("id, name, display_name, description, system_prompt, model")
      .in("id", agentIds),
    supabase
      .from("servers")
.select(`
  organization_summary,
  company_name,
  company_website,
  company_description,
  icp,
  niche,
  agent_goals,
  current_workflow,
  context_notes
`)
      .eq("id", channel.server_id)
      .single(),
  ]);
  if (!agents?.length) return;

  const channelAgents = agents as Agent[];
  const mentionedAgents = channelAgents.filter((agent) => isMentioned(message.content, agent));
  let targets: Agent[];

  if (channel.type === "dm" && message.sender_type === "human") {
    targets = channelAgents;
  } else if (message.sender_type === "agent") {
    targets = getForwardHandoffTargets(message, mentionedAgents, channelAgents);
  } else {
    targets = mentionedAgents;
  }

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
      .limit(Number.isFinite(contextMessageLimit) && contextMessageLimit > 0 ? contextMessageLimit : 6),
  ]);
  const history = (recentMessages || []).reverse().map((entry) =>
    `[${entry.sender_type === "human" ? "User" : "Agent"}]: ${entry.content.slice(0, Number.isFinite(contextMessageChars) && contextMessageChars > 0 ? contextMessageChars : 400)}`
  ).join("\n");
  const senderAgent = message.sender_type === "agent"
    ? channelAgents.find((agent) => agent.id === message.sender_id)
    : null;
  const senderName = sender?.display_name || senderAgent?.display_name || (message.sender_type === "agent" ? "Agent" : "User");

  await Promise.all(targets.map(async (agent) => {
    await supabase.from("agents").update({ status: "online" }).eq("id", agent.id);
    const reply = await generateReply(
      agent,
      `[target=${channel.type === "dm" ? `dm:@${senderName}` : `#${channel.name}`} sender=@${senderName}] ${message.content}`,
      history,
      (workspaceContext as WorkspaceContext | null) || null,
    );
    if (!reply) return;
    const { data: inserted, error } = await supabase.from("messages").insert({
      channel_id: message.channel_id,
      sender_id: agent.id,
      sender_type: "agent",
      content: reply,
      ...(message.thread_parent_id ? { thread_parent_id: message.thread_parent_id } : {}),
    }).select().single();
    if (error) throw new Error(error.message);

    await dispatchMessage(inserted as Message);
  }));
}
