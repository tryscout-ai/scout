export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  agentId: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  workingDirectory: string;
  messages?: LLMMessage[];

  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
    content: string;
    finishReason?: string;

    activity?: {
        activity: "idle" | "thinking" | "working" | "error";
        label: string;
        detail: string;
    }[];
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
}