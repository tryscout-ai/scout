// "use client";

// import { useState } from "react";
// import { useRouter } from "next/navigation";
// import {
//   Dialog,
//   DialogPopup,
//   DialogHeader,
//   DialogTitle,
//   DialogDescription,
//   DialogPanel,
//   DialogFooter,
// } from "@/components/ui/dialog";
// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { Textarea } from "@/components/ui/textarea";
// import {
//   Select,
//   SelectTrigger,
//   SelectValue,
//   SelectPopup,
//   SelectItem,
// } from "@/components/ui/select";
// import { Field, FieldLabel } from "@/components/ui/field";
// import { TerminalIcon } from "lucide-react";

// interface SetupWizardProps {
//   serverId: string;
//   serverSlug: string;
//   onComplete: () => void;
// }

// const MODEL_ITEMS = [
//   { value: "opus", label: "Opus — Most capable" },
//   { value: "sonnet", label: "Sonnet — Balanced" },
//   { value: "haiku", label: "Haiku — Fastest" },
// ];

// type Step = "connect" | "connected" | "create-agent";

// export function SetupWizard({ serverId, serverSlug, onComplete }: SetupWizardProps) {
//   const [step] = useState<Step>("create-agent");

//   // Create agent form
//   const [agentName, setAgentName] = useState("");
//   const [agentDescription, setAgentDescription] = useState("");
//   const [agentModel, setAgentModel] = useState("sonnet");
//   const [agentPrompt, setAgentPrompt] = useState("");
//   const [creatingAgent, setCreatingAgent] = useState(false);
//   const [agentError, setAgentError] = useState("");

//   const router = useRouter();

//   function handleDownloadBridge() {
//     window.open("/api/download/bridge", "_blank");
//   }

//   async function handlePairBridge() {
//     if (!apiKey) return;

//     setPairing(true);
//     setPairError("");

//     try {
//       const res = await fetch("http://localhost:42137/pair", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           serverUrl,
//           apiKey,
//         }),
//       });

//       if (!res.ok) {
//         const body = await res.json().catch(() => null);
//         throw new Error(body?.error || "Scout Bridge is not running yet.");
//       }
//     } catch (err) {
//       setPairError(
//         err instanceof Error
//           ? err.message
//           : "Scout Bridge is not running yet."
//       );
//     } finally {
//       setPairing(false);
//     }
//   }

//   async function handleCreateAgent(e: React.FormEvent) {
//     e.preventDefault();
//     if (!agentName.trim()) return;

//     setCreatingAgent(true);
//     setAgentError("");

//     try {
//       const res = await fetch("/api/agents", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({
//           display_name: agentName.trim(),
//           description: agentDescription.trim() || undefined,
//           model: agentModel,
//           system_prompt: agentPrompt.trim() || undefined,
//           server_id: serverId,
//         }),
//       });

//       if (!res.ok) {
//         const data = await res.json();
//         throw new Error(data.error || "Failed to create agent");
//       }

//       const { agent, channel } = await res.json();
//       // Navigate to the agent's DM
//       if (channel?.id) {
//         router.push(`/s/${serverSlug}/dm/${channel.id}`);
//       }
//       onComplete();
//     } catch (err) {
//       setAgentError(err instanceof Error ? err.message : "Failed to create agent");
//       setCreatingAgent(false);
//     }
//   }

//   function handleSkip() {
//     onComplete();
//   }

//   const selectedModel = MODEL_ITEMS.find((m) => m.value === agentModel) ?? MODEL_ITEMS[1];

//   return (
//     <Dialog open onOpenChange={(open) => { if (!open) handleSkip(); }}>
//       <DialogPopup showCloseButton={false} className="max-w-md">

//         {step === "connect" && (
//           <>
//             <DialogHeader>
//               <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-2">
//                 <MonitorIcon className="size-6" />
//               </div>
//               <DialogTitle className="text-center">Connect Your Machine</DialogTitle>
//               <DialogDescription className="text-center">
//                 Download and open Scout Bridge to connect this computer.
//                 Make sure <a href="https://docs.anthropic.com/en/docs/claude-code/overview" target="_blank" rel="noopener" className="underline underline-offset-2">Claude Code</a> is installed first.
//               </DialogDescription>
//               <DialogPanel>
//                 <div className="space-y-4">
//                   <Field>
//                     <FieldLabel>Name</FieldLabel>
//                     <Input
//                       type="text"
//                       value={agentName}
//                       onChange={(e) => setAgentName((e.target as HTMLInputElement).value)}
//                       placeholder="e.g. Design Assistant, Code Reviewer..."
//                       required
//                       autoFocus
//                     />
//                   </Field>

//                   <Field>
//                     <FieldLabel>
//                       Description <span className="text-muted-foreground font-normal">(optional)</span>
//                     </FieldLabel>
//                     <Input
//                       type="text"
//                       value={agentDescription}
//                       onChange={(e) => setAgentDescription((e.target as HTMLInputElement).value)}
//                       placeholder="What does this agent do?"
//                     />
//                   </Field>

//                   <Field>
//                     <FieldLabel>Model</FieldLabel>
//                     <Select
//                       value={selectedModel}
//                       onValueChange={(val) => {
//                         if (val) setAgentModel((val as typeof selectedModel).value);
//                       }}
//                       items={MODEL_ITEMS}
//                     >
//                       <SelectTrigger>
//                         <SelectValue placeholder="Select a model" />
//                       </SelectTrigger>
//                       <SelectPopup>
//                         {MODEL_ITEMS.map((item) => (
//                           <SelectItem key={item.value} value={item}>
//                             {item.label}
//                           </SelectItem>
//                         ))}
//                       </SelectPopup>
//                     </Select>
//                   </Field>

//                   <Field>
//                     <FieldLabel>
//                       Instructions <span className="text-muted-foreground font-normal">(optional)</span>
//                     </FieldLabel>
//                     <Textarea
//                       value={agentPrompt}
//                       onChange={(e) => setAgentPrompt((e.target as HTMLTextAreaElement).value)}
//                       placeholder="Tell the agent how to behave, what it's good at..."
//                     />
//                   </Field>

//                   {agentError && (
//                     <p className="text-sm text-destructive">{agentError}</p>
//                   )}
//                 </div>
//               </DialogPanel>
//               <DialogFooter variant="bare">
//                 <Button variant="ghost" type="button" onClick={handleSkip}>
//                   Skip for now
//                 </Button>
//                 <Button type="submit" loading={creatingAgent} disabled={!agentName.trim()}>
//                   Create Agent
//                 </Button>
//               </DialogFooter>
//             </form>
//           </>
//         )}
//       </DialogPopup>
//     </Dialog>
//   );
// }
"use client";

interface SetupWizardProps {
  serverId: string;
  serverSlug: string;
  onComplete: () => void;
}

export function SetupWizard(_: SetupWizardProps) {
  return null;
}