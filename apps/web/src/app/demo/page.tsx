import {
  CheckCircle2Icon,
  GitBranchIcon,
  MessageSquareIcon,
  MousePointerClickIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from "lucide-react";
import Link from "next/link";

const demoSteps = [
  "Install Scout into a Slack workspace.",
  "Choose a channel such as #scout-demo.",
  "Mention Scout with a lead, company, or task.",
  "Watch Research -> Enrichment -> Outreach coordinate in a thread.",
  "Approve, edit, or reject the final draft with Slack buttons.",
];

const demoBeats = [
  "0:00-0:25 - show the problem: Slack has bots, not agent teams.",
  "0:25-1:45 - run the live Slack workflow and human approval loop.",
  "1:45-2:25 - show the architecture: Vercel, Supabase, Slack, managed bridge.",
  "2:25-3:00 - close with impact and the hosted tester path.",
];

export default function DemoPage() {
  return (
    <main className="min-h-full bg-background text-foreground">
      <section className="border-b">
        <div className="mx-auto flex min-h-[92vh] w-full max-w-6xl flex-col justify-between px-6 py-6 md:px-8">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
                <WorkflowIcon className="size-4" />
              </div>
              <span className="font-semibold">Scout for Slack</span>
            </div>
            <div className="flex items-center gap-2">
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm hover:bg-accent"
                href="/login"
              >
                Sign in
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-primary-foreground text-sm hover:opacity-90"
                href="/slack"
              >
                <WorkflowIcon className="size-4" />
                Add to Slack
              </Link>
            </div>
          </nav>

          <div className="grid items-center gap-10 py-12 lg:grid-cols-[1fr_420px]">
            <div className="max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-muted-foreground text-sm">
                <ShieldCheckIcon className="size-4" />
                Hosted hackathon demo - no bridge install for testers
              </div>
              <h1 className="max-w-4xl font-semibold text-5xl tracking-normal md:text-7xl">
                Multi-agent coordination that lives inside Slack.
              </h1>
              <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
                Scout turns a Slack thread into a coordinated agent workflow:
                research, enrichment, outreach drafting, and human approval
                through native Block Kit buttons and modals.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-primary-foreground text-sm hover:opacity-90"
                  href="/slack"
                >
                  <WorkflowIcon className="size-4" />
                  Try in Slack
                </Link>
                <a
                  className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm hover:bg-accent"
                  href="#demo-script"
                >
                  <PlayCircleIcon className="size-4" />
                  Demo script
                </a>
              </div>
            </div>

            <div className="rounded-lg border bg-card p-4">
              <div className="mb-4 flex items-center gap-2">
                <MessageSquareIcon className="size-5" />
                <h2 className="font-medium">What hosts can test</h2>
              </div>
              <div className="grid gap-3">
                {demoSteps.map((step) => (
                  <div className="flex gap-3 rounded-lg border bg-background p-3 text-sm" key={step}>
                    <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success-foreground" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 pb-4 md:grid-cols-3">
            <div className="rounded-lg border bg-card p-4">
              <MessageSquareIcon className="mb-3 size-5" />
              <h3 className="font-medium">Slack-native</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Users never leave Slack for task handoffs or approval.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <GitBranchIcon className="mb-3 size-5" />
              <h3 className="font-medium">Agent handoffs</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Agents explicitly route work through the same thread.
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <MousePointerClickIcon className="mb-3 size-5" />
              <h3 className="font-medium">Human approval</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Approve, edit, or reject drafts with Slack interactivity.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-10 md:px-8 lg:grid-cols-[1fr_1fr]" id="demo-script">
        <div>
          <h2 className="font-semibold text-2xl">Three-minute demo script</h2>
          <div className="mt-4 grid gap-2">
            {demoBeats.map((beat) => (
              <div className="rounded-lg border bg-card px-4 py-3 text-sm" key={beat}>
                {beat}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-5">
          <h2 className="font-semibold text-2xl">Submission checklist</h2>
          <ul className="mt-4 grid gap-3 text-sm">
            <li>Submit this Vercel URL as the product page.</li>
            <li>Submit the prepared Slack sandbox URL as the primary tester path.</li>
            <li>Invite slackhack@salesforce.com and testing@devpost.com to the sandbox.</li>
            <li>Keep the managed demo bridge online during judging.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
