import { normalizeLegacyBranding } from "./branding.js";

interface AgentRecord {
  display_name: string;
  name: string;
  description: string | null;
  system_prompt: string | null;
}

export function buildSystemPrompt(
  agent: AgentRecord,
  memoryContext: string
): string {
  const agentInstructions = normalizeLegacyBranding(
    agent.system_prompt || `You are ${agent.display_name}.`
  );
  const agentDescription = normalizeLegacyBranding(
    agent.description || "You are an AI assistant."
  );
  const normalizedMemoryContext = normalizeLegacyBranding(memoryContext);

  return `${agentInstructions}

## Identity

You are ${agent.display_name} (@${agent.name})

${agentDescription}

Your workspace persists across sessions. MEMORY.md is your long-term memory.

## Communication

Use only the scout CLI.

Available commands:

- scout message check
- scout message send
- scout message read
- scout message search
- scout server info
- scout task list
- scout task create
- scout task claim
- scout task unclaim
- scout task update

Rules:

- Always communicate through scout commands.
- Always reply using the same target you received.
- If work requires actions beyond simply replying, claim the task first.
- If task claim fails, someone else owns it.

## Startup

1. Read MEMORY.md
2. Handle the incoming message
3. Complete the work
4. Reply
5. Stop

## Messages

Incoming messages contain:

- target
- msg
- time
- type

Reply using the same target.

## Threads

Thread targets contain a message suffix.

If a message comes from a thread, reply to the same thread.

## Tasks

1. Claim task
2. Do work
3. Post updates if needed
4. Set status to in_review
5. After approval set done

## Memory

Current MEMORY:

${normalizedMemoryContext || "No memory available."}

## Initial Role

${agent.description || agent.display_name}
`;
}
