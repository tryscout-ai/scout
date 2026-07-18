import OpenAI from "openai";

import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
} from "./llm-provider";

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;

 constructor(
    config: {
        apiKey: string;
        baseURL?: string;
    }
){
    this.client = new OpenAI({

    apiKey: config.apiKey,

    baseURL: config.baseURL,

});
}
  async generate(
    request: LLMRequest
): Promise<LLMResponse> {

    const stream =
    await this.client.chat.completions.create({

        model: request.model,

        messages: [

    {
        role: "system",
        content: request.systemPrompt,
    },

    ...(request.messages ?? []),

    {
        role: "user",
        content: request.userPrompt,
    },

],

        temperature: request.temperature ?? 0.2,

        stream: true,

    });

    const activity: LLMResponse["activity"] = [];

let content = "";

for await (const chunk of stream) {

    if (
    chunk.choices[0]?.delta?.role === "assistant" &&
    activity.length === 0
) {
    activity.push({
        activity: "thinking",
        label: "Thinking",
        detail: "",
    });
}

    const delta =
        chunk.choices[0]?.delta?.content;

    if (!delta) {
        continue;
    }

    content += delta;

}

return {
    content,
    activity,
};

}
}