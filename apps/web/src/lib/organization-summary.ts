export interface OrganizationContext {
  company_name: string | null;
  company_website: string | null;
  company_description: string | null;
  icp: string | null;
  niche: string | null;
  agent_goals: string | null;
  current_workflow: string | null;
  context_notes: string | null;
}

const SUMMARY_SYSTEM_PROMPT = `Create a compact, factual organization brief for recurring AI system prompts.
Return plain text only: 80-120 tokens when possible, never more than 150 generated tokens.
Preserve company, offer, ICP, market, goals, workflow, and important constraints. Remove marketing language, repetition, and unsupported inferences. Use concise sentences or semicolon-separated facts. Be deterministic.`;

function sourceText(context: OrganizationContext) {
  return [
    ["Company", context.company_name],
    ["Website", context.company_website],
    ["Company description", context.company_description],
    ["Ideal customer profile", context.icp],
    ["Market", context.niche],
    ["Agent goals", context.agent_goals],
    ["Current workflow", context.current_workflow],
    ["Additional constraints", context.context_notes],
  ]
    .filter(([, value]) => Boolean(value?.trim()))
    .map(([label, value]) => `${label}: ${value!.trim()}`)
    .join("\n");
}

function textFromChatCompletion(data: unknown) {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
}

async function generateWithOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  input: string,
) {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 150,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: input },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const summary = textFromChatCompletion(await response.json());
  if (!summary) throw new Error("Provider returned no summary text");
  return summary;
}

async function generateWithGemini(input: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const response = await fetch("https://generativelanguage.googleapis.com/v1/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model: process.env.SCOUT_GEMINI_MODEL || "gemini-3.5-flash",
      store: false,
      system_instruction: SUMMARY_SYSTEM_PROMPT,
      input,
      generation_config: { temperature: 0, max_output_tokens: 150 },
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as {
    steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  const summary = data.steps
    ?.filter((step) => step.type === "model_output")
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("")
    .trim();
  if (!summary) throw new Error("Gemini returned no summary text");
  return summary;
}

/** Best-effort summary generation. Provider output is hard-capped at 150 tokens. */
export async function generateOrganizationSummary(context: OrganizationContext) {
  const input = sourceText(context);
  if (!input) throw new Error("No organization context is available to summarize");

  const providers = [
    process.env.OPENAI_API_KEY && {
      baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.SCOUT_LLM_MODEL || "gpt-4.1-mini",
    },
    process.env.SCOUT_FALLBACK_OPENAI_API_KEY && process.env.SCOUT_FALLBACK_LLM_MODEL && {
      baseUrl: process.env.SCOUT_FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.SCOUT_FALLBACK_OPENAI_API_KEY,
      model: process.env.SCOUT_FALLBACK_LLM_MODEL,
    },
    process.env.NVIDIA_NIM_API_KEY && process.env.SCOUT_NVIDIA_NIM_MODEL && {
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_NIM_API_KEY,
      model: process.env.SCOUT_NVIDIA_NIM_MODEL,
    },
  ].filter(Boolean) as Array<{ baseUrl: string; apiKey: string; model: string }>;

  let lastError = "No summary provider is configured";
  for (const provider of providers) {
    try {
      return await generateWithOpenAiCompatible(provider.baseUrl, provider.apiKey, provider.model, input);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`Organization summary provider ${provider.model} failed: ${lastError}`);
    }
  }

  try {
    const summary = await generateWithGemini(input);
    if (summary) return summary;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.warn(`Organization summary Gemini fallback failed: ${lastError}`);
  }
  throw new Error(lastError);
}
