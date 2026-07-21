"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { normalizeWebsite } from "@/lib/workspace-context";

type OnboardingStep = "company" | "customers" | "goals";

interface ServerContext {
  id: string;
  slug: string;
  company_name: string | null;
  company_website: string | null;
  company_description: string | null;
  icp: string | null;
  niche: string | null;
  agent_goals: string | null;
  current_workflow: string | null;
  context_notes: string | null;
  onboarding_completed_at: string | null;
}

function isComplete(server: ServerContext) {
  return Boolean(
    server.company_name &&
      server.company_website &&
      server.company_description &&
      server.icp &&
      server.niche &&
      server.agent_goals &&
      server.onboarding_completed_at,
  );
}

function OnboardingContent() {
  const [server, setServer] = useState<ServerContext | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [icp, setIcp] = useState("");
  const [niche, setNiche] = useState("");
  const [agentGoals, setAgentGoals] = useState("");
  const [currentWorkflow, setCurrentWorkflow] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState<OnboardingStep>("company");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedServerId = searchParams.get("server");

  const companyComplete =
    companyName.trim() && companyWebsite.trim() && companyDescription.trim();
  const customersComplete = icp.trim() && niche.trim();
  const goalsComplete = agentGoals.trim();

  function goNext() {
    setError("");

    if (step === "company") {
      if (!companyComplete) {
        setError("Company name, website, and description are required.");
        return;
      }

      setStep("customers");
      return;
    }

    if (step === "customers") {
      if (!customersComplete) {
        setError("Ideal customer profile and niche are required.");
        return;
      }

      setStep("goals");
    }
  }

  function goBack() {
    setError("");
    setStep(step === "goals" ? "customers" : "company");
  }

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: memberships } = await supabase
        .from("server_members")
        .select("server_id")
        .eq("member_id", user.id)
        .eq("member_type", "human");

      if (!memberships || memberships.length === 0) {
        setChecking(false);
        return;
      }

      const targetServerId = requestedServerId || memberships[0].server_id;
      const { data: firstServer } = await supabase
        .from("servers")
        .select(
          "id, slug, company_name, company_website, company_description, icp, niche, agent_goals, current_workflow, context_notes, onboarding_completed_at",
        )
        .eq("id", targetServerId)
        .single();

      if (!firstServer) {
        setChecking(false);
        return;
      }

      if (isComplete(firstServer as ServerContext)) {
        router.replace(`/s/${firstServer.slug}`);
        return;
      }

      const context = firstServer as ServerContext;
      setServer(context);
      setCompanyName(context.company_name || "");
      setCompanyWebsite(context.company_website || "");
      setCompanyDescription(context.company_description || "");
      setIcp(context.icp || "");
      setNiche(context.niche || "");
      setAgentGoals(context.agent_goals || "");
      setCurrentWorkflow(context.current_workflow || "");
      setContextNotes(context.context_notes || "");
      setChecking(false);
    }

    load();
  }, [requestedServerId, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (
      !companyName.trim() ||
      !companyWebsite.trim() ||
      !companyDescription.trim() ||
      !icp.trim() ||
      !niche.trim() ||
      !agentGoals.trim()
    ) {
      setError("Company name, website, description, ICP, niche, and agent goals are required.");
      return;
    }

    setSaving(true);

    try {
      let targetServer = server;

      if (!targetServer) {
        const createRes = await fetch("/api/servers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: companyName.trim(),
            slug: companyName
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
            description: companyDescription.trim(),
            company_name: companyName.trim(),
            company_website: normalizeWebsite(companyWebsite),
            company_description: companyDescription.trim(),
            icp: icp.trim(),
            niche: niche.trim(),
            agent_goals: agentGoals.trim(),
            current_workflow: currentWorkflow.trim(),
            context_notes: contextNotes.trim(),
          }),
        });

        if (!createRes.ok) {
          const data = await createRes.json();
          throw new Error(data.error || "Failed to create workspace");
        }

        const { server: createdServer, apiKey } = await createRes.json();
        if (apiKey) {
          sessionStorage.setItem("scout_setup_key", apiKey);
        }
        router.push(`/s/${createdServer.slug}?setup=true`);
        return;
      }

      const res = await fetch(`/api/servers/${targetServer.id}/context`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName.trim(),
          company_website: normalizeWebsite(companyWebsite),
          company_description: companyDescription.trim(),
          icp: icp.trim(),
          niche: niche.trim(),
          agent_goals: agentGoals.trim(),
          current_workflow: currentWorkflow.trim(),
          context_notes: contextNotes.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save company context");
      }

      router.push(`/s/${targetServer.slug}?setup=true`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save company context");
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-xl mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Tell Scout about your company</CardTitle>
            <CardDescription>
              This becomes shared context for every agent in your workspace.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardPanel>
              <div className="mb-6 grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground">
                {[
                  ["company", "Company"],
                  ["customers", "Customers"],
                  ["goals", "Agent goals"],
                ].map(([value, label], index) => {
                  const activeIndex = ["company", "customers", "goals"].indexOf(step);
                  return (
                    <div
                      key={value}
                      className={`rounded-md px-3 py-2 text-center ${
                        index <= activeIndex ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>

              <div className="space-y-4">
                {step === "company" && (
                  <>
                    <Field>
                      <FieldLabel>Company name</FieldLabel>
                      <Input
                        value={companyName}
                        onChange={(e) => setCompanyName((e.target as HTMLInputElement).value)}
                        placeholder="Acme Inc"
                        required
                        autoFocus
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Company website</FieldLabel>
                      <Input
                        value={companyWebsite}
                        onChange={(e) => setCompanyWebsite((e.target as HTMLInputElement).value)}
                        placeholder="acme.com"
                        required
                      />
                    </Field>

                    <Field>
                      <FieldLabel>What does the company do?</FieldLabel>
                      <Textarea
                        value={companyDescription}
                        onChange={(e) => setCompanyDescription((e.target as HTMLTextAreaElement).value)}
                        placeholder="A short, plain-English description of your product, market, and customers."
                        required
                      />
                    </Field>
                  </>
                )}

                {step === "customers" && (
                  <>
                    <Field>
                      <FieldLabel>Ideal customer profile</FieldLabel>
                      <Textarea
                        value={icp}
                        onChange={(e) => setIcp((e.target as HTMLTextAreaElement).value)}
                        placeholder="Who should your agents research, qualify, or contact?"
                        required
                        autoFocus
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Niche or market</FieldLabel>
                      <Input
                        value={niche}
                        onChange={(e) => setNiche((e.target as HTMLInputElement).value)}
                        placeholder="B2B SaaS sales teams"
                        required
                      />
                    </Field>

                    <Field>
                      <FieldLabel>
                        Current workflow/tools <span className="text-muted-foreground font-normal">(optional)</span>
                      </FieldLabel>
                      <Input
                        value={currentWorkflow}
                        onChange={(e) => setCurrentWorkflow((e.target as HTMLInputElement).value)}
                        placeholder="HubSpot, Clay, Apollo, Slack..."
                      />
                    </Field>
                  </>
                )}

                {step === "goals" && (
                  <>
                    <Field>
                      <FieldLabel>What should Scout agents help with?</FieldLabel>
                      <Textarea
                        value={agentGoals}
                        onChange={(e) => setAgentGoals((e.target as HTMLTextAreaElement).value)}
                        placeholder="Research accounts, draft outreach, qualify leads, coordinate approvals..."
                        required
                        autoFocus
                      />
                      <FieldDescription>
                        Agents will use this to make their research, recommendations, and handoffs more specific.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <FieldLabel>
                        Extra context <span className="text-muted-foreground font-normal">(optional)</span>
                      </FieldLabel>
                      <Textarea
                        value={contextNotes}
                        onChange={(e) => setContextNotes((e.target as HTMLTextAreaElement).value)}
                        placeholder="Tone, constraints, approvals, qualification rules, or anything agents should avoid."
                      />
                    </Field>
                  </>
                )}

                {error && (
                  <Alert variant="error">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
            </CardPanel>
            <CardFooter>
              <div className="flex w-full gap-2">
                {step !== "company" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={goBack}
                  >
                    Back
                  </Button>
                )}
                {step !== "goals" ? (
                  <Button type="button" onClick={goNext} className="flex-1">
                    Continue
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    loading={saving}
                    disabled={!goalsComplete}
                    className="flex-1"
                  >
                    Save and enter workspace
                  </Button>
                )}
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-background">
          <div className="text-sm text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
