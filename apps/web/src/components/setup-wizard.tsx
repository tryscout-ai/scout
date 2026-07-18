"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LoaderIcon,
  MonitorIcon,
  TerminalIcon,
} from "lucide-react";

interface SetupWizardProps {
  serverId: string;
  serverSlug: string;
  onComplete: () => void;
}

const MODEL_ITEMS = [
  { value: "opus", label: "Opus — Most capable" },
  { value: "sonnet", label: "Sonnet — Balanced" },
  { value: "haiku", label: "Haiku — Fastest" },
];

type Step = "connect" | "connected" | "create-agent";

export function SetupWizard({ serverId, serverSlug, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>("connect");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");
  const [machineName, setMachineName] = useState("");
  const [serverUrl] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin
  );

  // Create agent form
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentModel, setAgentModel] = useState("sonnet");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentError, setAgentError] = useState("");

  const router = useRouter();
  const pollRef = useRef<ReturnType<typeof setInterval>>(null);

  // Load API key from sessionStorage
  useEffect(() => {
    const storedKey = sessionStorage.getItem("scout_setup_key");
    if (storedKey) {
      setApiKey(storedKey);
      sessionStorage.removeItem("scout_setup_key");
    }
  }, []);

  // Poll for bridge connection (check if the key's last_used_at becomes non-null)
  useEffect(() => {
    if (step !== "connect" || !apiKey) return;

    const keyPrefix = apiKey.substring(0, 11); // "zk_" + first 8 hex chars

    async function checkConnection() {
      try {
        const res = await fetch(`/api/bridge/keys?server_id=${serverId}`);
        if (!res.ok) return;
        const { keys } = await res.json();
        const matchedKey = keys.find(
          (k: { key_prefix: string; last_used_at: string | null }) =>
            k.key_prefix === keyPrefix
        );
        if (matchedKey?.last_used_at) {
          setMachineName(matchedKey.name || "");
          setStep("connected");
        }
      } catch {
        // Ignore poll errors
      }
    }

    // Check immediately, then poll every 3 seconds
    checkConnection();
    pollRef.current = setInterval(checkConnection, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, apiKey, serverId]);

  const npxCommand = apiKey
    ? [
        "npx @scout-ai/scout-bridge",
        serverUrl ? `--server-url ${serverUrl}` : "",
        `--api-key ${apiKey}`,
      ].filter(Boolean).join(" ")
    : "";

  async function handleCopy() {
    if (!npxCommand) return;
    await navigator.clipboard.writeText(npxCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadBridge() {
    window.open("/api/download/bridge", "_blank");
  }

  async function handlePairBridge() {
    if (!apiKey) return;

    setPairing(true);
    setPairError("");

    try {
      const res = await fetch("http://localhost:42137/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl,
          apiKey,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Scout Bridge is not running yet.");
      }
    } catch (err) {
      setPairError(
        err instanceof Error
          ? err.message
          : "Scout Bridge is not running yet."
      );
    } finally {
      setPairing(false);
    }
  }

  async function handleCreateAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!agentName.trim()) return;

    setCreatingAgent(true);
    setAgentError("");

    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: agentName.trim(),
          description: agentDescription.trim() || undefined,
          model: agentModel,
          system_prompt: agentPrompt.trim() || undefined,
          server_id: serverId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create agent");
      }

      const { agent, channel } = await res.json();
      // Navigate to the agent's DM
      if (channel?.id) {
        router.push(`/s/${serverSlug}/dm/${channel.id}`);
      }
      onComplete();
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "Failed to create agent");
      setCreatingAgent(false);
    }
  }

  function handleSkip() {
    onComplete();
  }

  const selectedModel = MODEL_ITEMS.find((m) => m.value === agentModel) ?? MODEL_ITEMS[1];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleSkip(); }}>
      <DialogPopup showCloseButton={false} className="max-w-md">
        {step === "connect" && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <MonitorIcon className="size-6" />
              </div>
              <DialogTitle className="text-center">Connect Your Machine</DialogTitle>
              <DialogDescription className="text-center">
                Download and open Scout Bridge to connect this computer.
                Make sure <a href="https://docs.anthropic.com/en/docs/claude-code/overview" target="_blank" rel="noopener" className="underline underline-offset-2">Claude Code</a> is installed first.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-4">
                {apiKey ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button type="button" variant="outline" onClick={handleDownloadBridge}>
                        <DownloadIcon className="size-3.5 mr-1.5" />
                        Download Bridge
                      </Button>
                      <Button
                        type="button"
                        onClick={handlePairBridge}
                        loading={pairing}
                      >
                        Connect Bridge
                      </Button>
                    </div>
                    {pairError && (
                      <p className="text-xs text-destructive">
                        {pairError} Open Scout Bridge, then try Connect Bridge again.
                      </p>
                    )}
                    <div className="relative">
                      <div className="rounded-lg border bg-muted/50 p-3 pr-10 font-mono text-xs break-all select-all leading-relaxed">
                        {npxCommand}
                      </div>
                      <button
                        onClick={handleCopy}
                        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        title="Copy command"
                      >
                        {copied ? (
                          <CheckIcon className="size-3.5 text-green-500" />
                        ) : (
                          <CopyIcon className="size-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                      <LoaderIcon className="size-3.5 animate-spin" />
                      <span>Waiting for connection...</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    Generating API key...
                  </div>
                )}
              </div>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button variant="ghost" onClick={handleSkip}>
                Skip for now
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "connected" && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-green-500/10 text-green-500 mb-2">
                <CheckIcon className="size-6" />
              </div>
              <DialogTitle className="text-center">Machine Connected</DialogTitle>
              <DialogDescription className="text-center">
                Your computer is now connected to Scout.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-4">
                <Field>
                  <FieldLabel>Machine Name</FieldLabel>
                  <Input
                    type="text"
                    value={machineName}
                    onChange={(e) => setMachineName((e.target as HTMLInputElement).value)}
                    placeholder="e.g. My MacBook, Work PC..."
                  />
                </Field>
              </div>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button onClick={() => setStep("create-agent")}>
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "create-agent" && (
          <>
            <DialogHeader>
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
                <TerminalIcon className="size-6" />
              </div>
              <DialogTitle className="text-center">Create Your First Agent</DialogTitle>
              <DialogDescription className="text-center">
                Agents are AI assistants that live in your workspace. Create one to get started.
              </DialogDescription>
            </DialogHeader>
            <form className="contents" onSubmit={handleCreateAgent}>
              <DialogPanel>
                <div className="space-y-4">
                  <Field>
                    <FieldLabel>Name</FieldLabel>
                    <Input
                      type="text"
                      value={agentName}
                      onChange={(e) => setAgentName((e.target as HTMLInputElement).value)}
                      placeholder="e.g. Design Assistant, Code Reviewer..."
                      required
                      autoFocus
                    />
                  </Field>

                  <Field>
                    <FieldLabel>
                      Description <span className="text-muted-foreground font-normal">(optional)</span>
                    </FieldLabel>
                    <Input
                      type="text"
                      value={agentDescription}
                      onChange={(e) => setAgentDescription((e.target as HTMLInputElement).value)}
                      placeholder="What does this agent do?"
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Model</FieldLabel>
                    <Select
                      value={selectedModel}
                      onValueChange={(val) => {
                        if (val) setAgentModel((val as typeof selectedModel).value);
                      }}
                      items={MODEL_ITEMS}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectPopup>
                        {MODEL_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>
                      Instructions <span className="text-muted-foreground font-normal">(optional)</span>
                    </FieldLabel>
                    <Textarea
                      value={agentPrompt}
                      onChange={(e) => setAgentPrompt((e.target as HTMLTextAreaElement).value)}
                      placeholder="Tell the agent how to behave, what it's good at..."
                    />
                  </Field>

                  {agentError && (
                    <p className="text-sm text-destructive">{agentError}</p>
                  )}
                </div>
              </DialogPanel>
              <DialogFooter variant="bare">
                <Button variant="ghost" type="button" onClick={handleSkip}>
                  Skip for now
                </Button>
                <Button type="submit" loading={creatingAgent} disabled={!agentName.trim()}>
                  Create Agent
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}
