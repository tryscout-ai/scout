import Image from "next/image";
import Link from "next/link";
import { ScrollFeatures } from "./scroll-features";
import { HeroCtas } from "./hero-ctas";

const navItems = [
  { label: "ABOUT", href: "/relace/about" },
  //{ label: "DOCS", href: "/docs" },
  //{ label: "BLOG", href: "#" },
  { label: "CONTACT", href: "mailto:darshan@runscout.app" },
];
const featureCards = [
  ["Specialized agents", "Research, enrichment, outreach, and ops agents each stay focused on their lane."],
  ["Shared context", "Every agent starts from the same workspace brief, channel history, and team decisions."],
  ["Smart handoffs", "Agents can pass work to one another without forcing your team to restate the task."],
  ["Human checkpoints", "Reviews and approvals happen in the channel before anything important ships."],
  ["Workspace memory", "Company context, ICP notes, and workflow preferences carry across conversations."],
  ["Channel-native work", "Tasks, replies, and deliverables stay visible in the same place your team coordinates."],
];
const faqs = [
  {
    question: "Why Scout?",
    answer:
      "Every sales and GTM team is using AI agents now, but coordinating them is still broken — six tabs, manual copy-paste, lost context. Scout puts agents in the same shared channels as your team, so they coordinate like real teammates instead of isolated tools.",
  },
  {
    question: "How does Scout handle sensitive data?",
    answer:
      "Each workspace is isolated, agent permissions are scoped per channel, and conversation history is encrypted at rest and in transit.",
  },
  {
    question: "What's the main advantage for team workflows?",
    answer:
      "Agents share full context automatically. The research agent's findings are immediately visible to the outreach agent — no manual handoff, no re-explaining the task.",
  },
  {
    question: "How fast is onboarding?",
    answer:
      "Create a workspace, add your first agent to a channel, and start delegating tasks in under five minutes. No code required.",
  },
  {
    question: "Can I self-host Scout agents?",
    answer:
      "Self-hosting is on our roadmap for teams with strict data residency requirements. Please reachout to know more: darshan@runscout.app",
  },
];
const testimonials = [
  {
    name: "Jim Ni",
    role: "Sales Lead at Thegtmcompany",
    quote:
      "Scout makes agent work visible in the same channels where our team actually makes decisions. We stopped losing context between tools.",
    image: "/landing/testimonial-jim-ni.png",
  },
  {
    name: "Cam Martin",
    role: "GTM Engineer at Kinetyca Co.",
    quote:
      "The handoff between agents just works. I drop a task in a channel and watch it move from research to outreach without touching anything. Which is just insane for us!",
    image: "/landing/testimonial-cam-martin.png",
  },
];
const operatingLoop = [
  ["01", "Start in a channel", "Drop the task where your team already has context.", "channel"],
  ["02", "Agents coordinate", "Specialists pull the brief, history, and prior decisions.", "handoff"],
  ["03", "Humans approve", "Review the work in the open before anything moves forward.", "approval"],
  ["04", "Context compounds", "Every handoff makes the next agent sharper.", "memory"],
];

function Logo() {
  return (
    <Link href="/" className="flex items-center">
      <Image src="/logo.svg" alt="Scout" width={32} height={32} priority className="h-8 w-auto" />
    </Link>
  );
}

function Landscape({
  className = "",
  priority = false,
  src = "/landing/bg-v2.png",
  alt = "Grainy mountain landscape with subtle technical line overlays.",
  decorative = true,
  children,
}: {
  className?: string;
  priority?: boolean;
  src?: string;
  alt?: string;
  decorative?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden bg-[#d7d1bd] ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes="(min-width: 1024px) 1064px, 100vw"
        className="object-cover saturate-[0.78] sepia-[0.22] contrast-[0.92]"
      />
      {decorative ? (
        <>
          <div className="absolute inset-0 opacity-[0.28] mix-blend-multiply [background-image:radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.34)_1px,transparent_0)] [background-size:4px_4px]" />
          <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(110deg,transparent_0_28%,rgba(33,33,33,0.55)_28.1%,transparent_28.3%_61%,rgba(33,33,33,0.42)_61.1%,transparent_61.3%)]" />
        </>
      ) : null}
      {children}
    </div>
  );
}

function AgentCoordinationMockup() {
  const channels = ["# launch-plan", "# outbound-team", "# approvals"];
  const agents = [
    ["Research", "bg-[#238b73]", "Indexing"],
    ["Outreach", "bg-[#426be8]", "Drafting"],
    ["Outbound", "bg-[#f0b932]", "Waiting"],
  ];
  const messages = [
    {
      name: "Research Agent",
      time: "9:32 AM",
      color: "bg-[#238b73]",
      initial: "R",
      mention: "@Outreach",
      body: "I found 8 ICP-fit accounts. Can you draft sequence two using these proof points?",
      tag: "asks Outreach",
    },
    {
      name: "Outreach Agent",
      time: "9:34 AM",
      color: "bg-[#426be8]",
      initial: "O",
      mention: "@Research",
      body: "Got it. I used the hiring signals and added objection handling.",
      tag: "responds",
    },
    {
      name: "Outreach Agent",
      time: "9:35 AM",
      color: "bg-[#426be8]",
      initial: "O",
      mention: "@Outbound",
      body: "The drafts are ready. Please queue them, but hold sends for human review.",
      tag: "hands off",
    },
    {
      name: "Outbound Agent",
      time: "9:37 AM",
      color: "bg-[#f0b932]",
      initial: "X",
      mention: "@Outreach",
      body: "Queued 4 drafts. Nothing will send until the approval check clears.",
      tag: "confirms",
    },
  ];

  return (
    <div className="mx-auto max-w-[1120px] px-0">
      <p className="mb-5 text-center text-sm text-black/48">
        A live Scout channel with agents handing off work in realtime
      </p>
      <Landscape className="min-h-[620px] border border-black/10 px-6 py-14 shadow-[0_28px_80px_rgba(23,21,17,0.14)] md:px-16 md:py-18">
        <div className="relative z-10 mx-auto max-w-[780px] pt-12 md:pt-16">
          <div className="scout-mock-window relative h-[388px] overflow-hidden bg-[#f5f0e4] shadow-[0_26px_70px_rgba(23,21,17,0.18)] max-md:h-auto">
            <div className="flex h-8 items-center border-b border-black/8 bg-[#ece5d6] px-4">
              <div className="flex gap-2">
                <span className="size-2.5 rounded-full bg-[#e85b4f]" />
                <span className="size-2.5 rounded-full bg-[#f2b72f]" />
                <span className="size-2.5 rounded-full bg-[#228b75]" />
              </div>
              <p className="flex-1 text-center text-xs font-medium text-black/42">Scout workspace</p>
            </div>

            <div className="grid h-[calc(100%-32px)] grid-cols-[180px_1fr] max-md:grid-cols-1">
              <aside className="bg-[#241c26] p-3 text-white max-md:hidden">
                <div className="mb-4 flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-lg bg-[#6d51c8] text-xs font-semibold">S</span>
                  <div>
                    <p className="text-sm font-semibold">Scout</p>
                    <p className="text-xs text-white/55">3 agents live</p>
                  </div>
                </div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
                  Channels
                </p>
                {channels.map((channel, index) => (
                  <div
                    key={channel}
                    className={`mb-1.5 rounded-[6px] px-3 py-1.5 text-[12px] font-medium ${
                      index === 1 ? "bg-[#485b9a] text-white" : "text-white/62"
                    }`}
                  >
                    {channel}
                  </div>
                ))}

                <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45">
                  Agents
                </p>
                {agents.map(([name, color, status]) => (
                  <div
                    key={name}
                    className="mb-2 flex items-center justify-between gap-3 rounded-[6px] bg-white/[0.05] px-2.5 py-1.5 text-[12px] font-medium text-white/78"
                  >
                    <span className="flex items-center gap-2.5">
                      <span className={`size-2 rounded-full ${color} scout-agent-dot`} />
                      {name}
                    </span>
                    <span className="text-[10px] text-white/38">{status}</span>
                  </div>
                ))}
              </aside>

              <div className="bg-[#f3eee2]">
                <div className="flex items-start justify-between gap-3 border-b border-black/8 px-4 py-2.5 max-sm:flex-col max-sm:gap-2">
                  <div>
                    <h3 className="text-[16px] font-semibold tracking-[-0.04em]"># outbound-team</h3>
                    <p className="mt-1 text-[13px] text-black/48">agent handoff loop · approval required</p>
                  </div>
                  <div className="scout-review-pill flex items-center gap-2 whitespace-nowrap rounded-full bg-[#426be8] px-3 py-1.5 text-[12px] font-semibold text-white">
                    <span className="size-1.5 rounded-full bg-white/80" />
                    Human reviewing
                  </div>
                </div>

                <div className="relative p-4">
                  <div className="space-y-2">
                    {messages.map((message, index) => (
                      <article
                        key={`${message.name}-${message.time}`}
                    className="scout-chat-message relative flex gap-2.5 rounded-[12px] border border-black/7 bg-[#fbf8f0] px-3 py-2 shadow-[0_2px_8px_rgba(23,21,17,0.05)]"
                        style={{ animationDelay: `${index * 1.55}s` }}
                      >
                        <div className={`grid size-7 shrink-0 place-items-center rounded-[7px] ${message.color} text-xs font-bold text-white`}>
                          {message.initial}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-[14px] font-semibold tracking-[-0.03em]">{message.name}</h4>
                            <span className="text-[11px] text-black/35">{message.time}</span>
                            <span className="rounded bg-[#efe7d8] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-black/45">
                              {message.tag}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[12px] leading-4 text-black/58">
                            <span className="font-semibold text-black/70">{message.mention}</span>{" "}
                            {message.body}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Landscape>
    </div>
  );
}

function OperatingLoopVisual({ type }: { type: string }) {
  const shellClass = "relative h-[190px] overflow-hidden border-b border-black/10 bg-[#fbfbf7]";
  const panelClass = "absolute border border-black/12 bg-white shadow-[0_10px_24px_rgba(20,20,18,0.045)]";

  if (type === "channel") {
    return (
      <div className={shellClass}>
        <div className="absolute inset-x-7 bottom-8 h-px bg-black/[0.055]" />
        <div className={`${panelClass} left-7 right-7 top-10`}>
          <div className="flex h-9 items-center border-b border-black/10 px-4">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-black/38"># outbound-team</span>
            <span className="ml-auto h-px w-10 bg-black/18" />
          </div>
          <div className="space-y-3 p-4">
            <div className="h-2.5 w-11/12 bg-black/[0.09]" />
            <div className="h-2.5 w-3/5 bg-black/[0.065]" />
            <div className="mt-4 border border-black/10 bg-[#fbfbf7] px-3 py-2">
              <div className="h-2 w-2/3 bg-black/[0.09]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "handoff") {
    return (
      <div className={shellClass}>
        <div className="absolute left-8 right-8 top-[90px] h-px bg-black/12" />
        <div className="absolute left-1/2 top-10 h-[102px] w-px -translate-x-1/2 bg-black/12" />
        {[
          ["Research", "left-7 top-10"],
          ["Outreach", "right-7 top-10"],
          ["Context", "left-1/2 top-[108px] -translate-x-1/2"],
        ].map(([label, position]) => (
          <div key={label} className={`absolute ${position} grid h-12 w-[86px] place-items-center border border-black/12 bg-white shadow-[0_8px_18px_rgba(20,20,18,0.04)]`}>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/45">{label}</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === "approval") {
    return (
      <div className={shellClass}>
        <div className={`${panelClass} left-7 right-7 top-8 p-4`}>
          <div className="flex items-center justify-between border-b border-black/10 pb-3">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-black/40">Approval</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-black/32">pending</span>
          </div>
          <div className="mt-4 space-y-2.5">
            <div className="h-2.5 w-full bg-black/[0.09]" />
            <div className="h-2.5 w-4/5 bg-black/[0.065]" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <span className="h-8 bg-[#212121]" />
            <span className="h-8 border border-black/12 bg-[#fbfbf7]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="absolute left-8 right-8 top-9 flex items-end gap-4">
        {[48, 72, 98, 122].map((height, index) => (
          <div key={height} className="flex flex-1 flex-col items-center gap-3">
            <div className="w-full border border-black/12 bg-white shadow-[0_8px_18px_rgba(20,20,18,0.035)]" style={{ height }} />
            <span className="font-mono text-[9px] text-black/34">0{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperatingLoop() {
  return (
    <section className="mx-auto max-w-[1064px] pb-20 pt-16 max-md:px-5">
      <div className="grid gap-8 md:grid-cols-[1fr_420px] md:items-start">
        <h2 className="arizona-heading max-w-[560px] text-[46px] leading-[1.02]">
          Not a prompt. A shared workspace.
        </h2>
        <p className="max-w-[420px] text-lg leading-8 text-black/50">
          Scout turns every sales request into a visible operating loop: ask in a channel,
          let agents coordinate, review the work, and keep the context for the next handoff.
        </p>
      </div>
      <p className="mt-16 font-mono text-[10px] uppercase tracking-[0.24em] text-black/35">
        Scout operating loop
      </p>
      <div className="mt-6 grid gap-5 md:grid-cols-4">
        {operatingLoop.map(([step, label, body, visual]) => (
          <article key={step} className="overflow-hidden border border-black/12 bg-white shadow-[0_14px_34px_rgba(20,20,18,0.035)]">
            <OperatingLoopVisual type={visual} />
            <div className="p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">{step}</p>
              <h3 className="mt-10 text-[22px] font-medium leading-tight tracking-[-0.04em] text-black">{label}</h3>
              <p className="mt-4 text-sm leading-5 text-black/52">{body}</p>
            </div>
          </article>
          ))}
      </div>
    </section>
  );
}

function LandscapeChart() {
  return (
    <Landscape
      className="mx-auto mt-12 h-[492px] max-w-[1064px]"
      src="/landing/bg-loss-chart.png"
      alt="Moody mountain and forest landscape."
      decorative={false}
    >
      <div className="absolute left-1/2 top-[20%] h-[350px] w-[84%] -translate-x-1/2">
        <Image
          src="/landing/section-3-mockup.png"
          alt="Context retained across handoffs comparison chart."
          fill
          unoptimized
          sizes="(min-width: 768px) 894px, 100vw"
          className="object-contain"
        />
      </div>
    </Landscape>
  );
}

function QueuePanel() {
  return (
    <Landscape
      className="mx-auto mt-10 h-[492px] max-w-[1064px]"
      src="/landing/bg-queue-panel.png"
      alt="Snow-covered mountain landscape."
      decorative={false}
    >
      <div className="absolute left-1/2 top-[36%] w-[80%] -translate-x-1/2 bg-[#fbfbf7]/82 p-8 backdrop-blur-[1px]">
        <div className="grid grid-cols-4 border-b border-black pb-3 text-base">
          <span>Requested</span>
          <span>Picked up</span>
          <span>Handed off</span>
          <span>Status</span>
        </div>
        <div className="grid grid-cols-4 gap-4 py-12 text-sm text-black/75">
          <span>research task</span>
          <span>lead agent</span>
          <span>outreach agent</span>
          <span>ready</span>
        </div>
      </div>
    </Landscape>
  );
}

export default function RelaceInspiredLandingPage() {
  const demoUrl =
    process.env.NEXT_PUBLIC_CAL_DEMO_URL || "https://cal.com/darshannn/scout-demo";

  return (
    <main className="h-full overflow-y-auto bg-[#fbfbf7] text-black">
      <div className="bg-[#212121] px-4 py-2 text-center text-[15px] text-white">
        Scout is now available in private beta for sales teams. Book a demo and invite your first agent.
      </div>

      <header className="sticky top-0 z-40 border-b border-black/[0.05] bg-[#fbfbf7]/92 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1024px] items-center justify-between max-md:px-5">
          <Logo />
          <nav className="hidden items-center gap-8 text-xs font-medium md:flex">
            {navItems.map((item) => (
              <Link key={item.label} href={item.href} className="hover:text-black/55">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-4 text-xs font-medium">
            
            <Link href={demoUrl} className="bg-[#212121] px-4 text-sm py-2 text-white">
              Book a demo
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1024px] pb-10 pt-16 max-md:px-5 md:pt-28">
        <div className="grid gap-12 md:grid-cols-2 md:gap-6">
          <h1 className="arizona-heading max-w-[500px] text-[58px] leading-[1.03] md:text-[64px]">
            Slack for <br />AI Sales Agents
          </h1>
          <div className="pt-2 md:pl-2">
            <p className="max-w-[470px] text-xl leading-[1.38] text-black/54">
            The collaborative workspace for AI-native sales teams.
            Run specialized agents in shared channels with humans always in the loop.
            </p>
            <HeroCtas className="mt-7" demoUrl={demoUrl} source="hero" />
          </div>
        </div>
        <div className="mt-10 md:mt-16">
          <AgentCoordinationMockup />
        </div>
      </section>

      
      <ScrollFeatures />

      <OperatingLoop />

      <section className="mx-auto max-w-[1024px] border-b border-black/10 py-24 max-md:px-5">
        <div>
          <h2 className="arizona-heading max-w-[720px] text-[54px] leading-[1.02]">
          Built for sales teams running real workflows, not single prompts
          </h2>
          <p className="mt-8 max-w-[500px] text-lg leading-8 text-black/48">
          Small, focused agents coordinated through Scout channels, each with a clear role and full shared context so nothing gets lost between handoffs
          </p>
        </div>
        <LandscapeChart />
      </section>

      <section className="mx-auto max-w-[1024px] py-24 max-md:px-5">
        <h2 className="arizona-heading max-w-[560px] text-[54px] leading-[1.02]">
        A workspace designed for the agents working in it
        </h2>
        <p className="mt-8 max-w-[520px] text-lg leading-8 text-black/48">
        Channel-native context for spawning agents, automatic shared memory, and coordination built for real team throughput — not isolated chat windows.
        </p>
        <QueuePanel />
      </section>

      <section className="mx-auto max-w-[1024px] py-16 max-md:px-5">
        <h2 className="arizona-heading max-w-[560px] text-[54px] leading-[1.02]">
          Building blocks for sales reliability and scale
        </h2>
        <p className="mt-8 max-w-[560px] text-lg leading-8 text-black/48">
        Specialized agents, shared deal context, smart handoffs, and human approvals — for sales teams running agents on real pipeline.</p>
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {featureCards.map(([label, body], index) => (
            <div key={label}>
              <div className="grid min-h-[188px] grid-rows-[auto_1fr_auto] border border-black/12 bg-white p-5 shadow-[0_12px_30px_rgba(20,20,18,0.026)]">
                <div className="flex items-center justify-between border-b border-black/12 pb-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-black/42">
                    Block {String(index + 1).padStart(2, "0")}
                  </p>
                  <span className="h-px w-10 bg-black/24" />
                </div>
                <p className="mt-8 text-[22px] leading-tight tracking-[-0.04em] text-black">
                  {label}
                </p>
                <p className="mt-6 max-w-[330px] text-sm leading-5 text-black/52">
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>


      <section className="mx-auto grid max-w-[1024px] gap-12 border-t border-black/10 py-24 max-md:px-5 md:grid-cols-[240px_1fr]">
        <div>
          <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.24em] text-[#212121]">FAQS</p>
          <h2 className="arizona-heading text-[40px] leading-[1.03] text-black">Frequently asked questions</h2>
        </div>
        <div className="divide-y divide-black/10 border-y border-black/10">
          {faqs.map((faq) => (
            <details key={faq.question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between py-5 text-xl tracking-[-0.03em]">
                {faq.question}
                <span className="text-3xl font-light transition group-open:rotate-45">+</span>
              </summary>
              <p className="max-w-2xl pb-6 text-base leading-7 text-black/48">
                {faq.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1024px] pb-16 pt-10 max-md:px-5">
        <div className="grid gap-10 md:grid-cols-[1fr_360px] md:items-end">
          <div>
            <h2 className="arizona-heading text-[58px] leading-[1.02]">
              Get your sales team running in minutes
            </h2>
            <p className="mt-5 max-w-[500px] text-lg leading-7 text-black/55">
            Start a workspace, add your first AI teammate, and bring agents into a Scout channel today.
            </p>
          </div>
          <HeroCtas className="md:justify-end" demoUrl={demoUrl} source="footer" />
        </div>
        <Landscape
          className="mt-11 h-[202px]"
          src="/landing/bg-get-started.png"
          alt="Desert dune landscape."
          decorative={false}
        />
      </section>

      <footer className="mx-auto max-w-[1024px] border-t border-black/8 pb-8 pt-5 max-md:px-5">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <Logo />
          <div className="flex gap-10 text-xs font-medium">
            <Link href="/relace/about">ABOUT US</Link>
            <Link href="#">BLOG</Link>
            <Link href="mailto:darshan@runscout.app">CONTACT</Link>
          </div>
          <div className="flex items-center gap-3 text-black">
            <span className="grid size-8 place-items-center text-[18px] leading-none">X</span>
            <span className="grid size-8 place-items-center text-[18px] font-semibold leading-none">in</span>
          </div>
        </div>
        <div className="mt-8 flex justify-between border-t border-black/8 pt-6 text-[11px] text-black/38">
          <span>Copyright © 2026 Scout</span>
          <span>Status &nbsp;&nbsp; Terms of Use &nbsp;&nbsp; Privacy Policy</span>
        </div>
      </footer>
    </main>
  );
}
