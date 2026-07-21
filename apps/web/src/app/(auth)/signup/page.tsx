"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardPanel, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { normalizeWebsite } from "@/lib/workspace-context";

type SignupStep = "account" | "company" | "goals";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [icp, setIcp] = useState("");
  const [niche, setNiche] = useState("");
  const [agentGoals, setAgentGoals] = useState("");
  const [currentWorkflow, setCurrentWorkflow] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [step, setStep] = useState<SignupStep>("account");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const accountComplete = email.trim() && password.length >= 6 && displayName.trim();
  const companyComplete =
    companyName.trim() && companyWebsite.trim() && companyDescription.trim();
  const goalsComplete = icp.trim() && niche.trim() && agentGoals.trim();

  function goNext() {
    setError(null);
    if (step === "account") {
      if (!accountComplete) {
        setError("Display name, email, and a password of at least 6 characters are required.");
        return;
      }
      setStep("company");
      return;
    }

    if (step === "company") {
      if (!companyComplete) {
        setError("Company name, website, and description are required.");
        return;
      }
      setStep("goals");
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!goalsComplete) {
      setError("ICP, niche, and agent goals are required.");
      return;
    }

    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          display_name: displayName.trim(),
          company_name: companyName.trim(),
          company_website: normalizeWebsite(companyWebsite),
          company_description: companyDescription.trim(),
          icp: icp.trim(),
          niche: niche.trim(),
          agent_goals: agentGoals.trim(),
          current_workflow: currentWorkflow.trim(),
          context_notes: contextNotes.trim(),
        },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-full max-w-xl mx-4">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Scout</CardTitle>
            <CardDescription>
              Give your agents the company context they need from day one.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSignup}>
            <CardPanel>
              <div className="mb-6 grid grid-cols-3 gap-2 text-xs font-medium text-muted-foreground">
                {["Account", "Company", "Agent goals"].map((label, index) => {
                  const activeIndex = ["account", "company", "goals"].indexOf(step);
                  return (
                    <div
                      key={label}
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
                {step === "account" && (
                  <>
                    <Field>
                      <FieldLabel>Display name</FieldLabel>
                      <Input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
                        placeholder="Your name"
                        required
                        autoFocus
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Work email</FieldLabel>
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
                        required
                        placeholder="you@company.com"
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Password</FieldLabel>
                      <Input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                        required
                        minLength={6}
                        placeholder="At least 6 characters"
                      />
                    </Field>
                  </>
                )}

                {step === "company" && (
                  <>
                    <Field>
                      <FieldLabel>Company name</FieldLabel>
                      <Input
                        type="text"
                        value={companyName}
                        onChange={(e) => setCompanyName((e.target as HTMLInputElement).value)}
                        required
                        autoFocus
                        placeholder="Acme Inc"
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Company website</FieldLabel>
                      <Input
                        type="text"
                        value={companyWebsite}
                        onChange={(e) => setCompanyWebsite((e.target as HTMLInputElement).value)}
                        required
                        placeholder="acme.com"
                      />
                    </Field>

                    <Field>
                      <FieldLabel>What does the company do?</FieldLabel>
                      <Textarea
                        value={companyDescription}
                        onChange={(e) => setCompanyDescription((e.target as HTMLTextAreaElement).value)}
                        required
                        placeholder="A short, plain-English description of your product, market, and customers."
                      />
                    </Field>
                  </>
                )}

                {step === "goals" && (
                  <>
                    <Field>
                      <FieldLabel>Ideal customer profile</FieldLabel>
                      <Textarea
                        value={icp}
                        onChange={(e) => setIcp((e.target as HTMLTextAreaElement).value)}
                        required
                        autoFocus
                        placeholder="Who should your agents research, qualify, or contact?"
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Niche or market</FieldLabel>
                      <Input
                        type="text"
                        value={niche}
                        onChange={(e) => setNiche((e.target as HTMLInputElement).value)}
                        required
                        placeholder="e.g. B2B SaaS sales teams, RevOps agencies, vertical AI startups"
                      />
                    </Field>

                    <Field>
                      <FieldLabel>What should Scout agents help with?</FieldLabel>
                      <Textarea
                        value={agentGoals}
                        onChange={(e) => setAgentGoals((e.target as HTMLTextAreaElement).value)}
                        required
                        placeholder="Describe the jobs you want agents to do: research, outreach, CRM updates, qualification, handoffs..."
                      />
                    </Field>

                    <Field>
                      <FieldLabel>
                        Current workflow/tools <span className="text-muted-foreground font-normal">(optional)</span>
                      </FieldLabel>
                      <Input
                        type="text"
                        value={currentWorkflow}
                        onChange={(e) => setCurrentWorkflow((e.target as HTMLInputElement).value)}
                        placeholder="HubSpot, Clay, Apollo, Slack, spreadsheets..."
                      />
                    </Field>

                    <Field>
                      <FieldLabel>
                        Extra context <span className="text-muted-foreground font-normal">(optional)</span>
                      </FieldLabel>
                      <Textarea
                        value={contextNotes}
                        onChange={(e) => setContextNotes((e.target as HTMLTextAreaElement).value)}
                        placeholder="Anything agents should know about tone, constraints, data quality, approvals, or edge cases."
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
            <CardFooter className="flex-col gap-4">
              <div className="flex w-full gap-2">
                {step !== "account" && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => setStep(step === "goals" ? "company" : "account")}
                  >
                    Back
                  </Button>
                )}
                {step !== "goals" ? (
                  <Button type="button" onClick={goNext} className="flex-1">
                    Continue
                  </Button>
                ) : (
                  <Button type="submit" loading={loading} className="flex-1">
                    Create account
                  </Button>
                )}
              </div>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                >
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
