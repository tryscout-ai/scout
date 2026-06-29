import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const navItems = [
  { label: "ABOUT", href: "/relace/about" },
  { label: "DOCS", href: "/docs" },
  { label: "BLOG", href: "#" },
  { label: "CONTACT", href: "#" },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center">
      <Image src="/logo.svg" alt="Scout" width={160} height={40} priority className="h-8 w-auto" />
    </Link>
  );
}

function ButtonLink({
  href,
  children,
  tone = "light",
}: {
  href: string;
  children: React.ReactNode;
  tone?: "primary" | "light";
}) {
  return (
    <Link
      href={href}
      className={
        tone === "primary"
          ? "inline-flex h-11 items-center gap-2 bg-[#212121] px-5 text-[11px] font-medium uppercase tracking-[0.08em] text-white transition hover:bg-[#2d2d2d]"
          : "inline-flex h-11 items-center gap-2 bg-[#f2f0e5] px-5 text-[11px] font-medium uppercase tracking-[0.08em] text-black shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] transition hover:bg-[#e8e5d8]"
      }
    >
      {children}
      <ArrowUpRight className="size-3.5" />
    </Link>
  );
}

export default function RelaceAboutPage() {
  return (
    <main className="h-full overflow-y-auto bg-[#fffef2] text-black">
      <div className="bg-[#212121] px-4 py-2 text-center text-[15px] text-white">
        Scout is now available for local teams. Connect the bridge and invite your first agent.
      </div>

      <header className="sticky top-0 z-40 border-b border-black/[0.03] bg-[#fffef2]/92 backdrop-blur">
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
            <Link href="/login" className="hidden sm:block">
              APP
            </Link>
            <Link href="/signup" className="bg-[#212121] px-4 py-2 text-white">
              GET A DEMO
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden pb-16">
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full text-[#47639f]/70"
          viewBox="0 0 1440 1100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M-100 110 C120 260, 302 250, 474 20" fill="none" stroke="currentColor" strokeWidth="1.15" />
          <path d="M1080 18 C1116 198, 1096 324, 936 440" fill="none" stroke="currentColor" strokeWidth="1.15" />
          <path d="M846 136 C1044 18, 1268 194, 1458 540" fill="none" stroke="currentColor" strokeWidth="1.15" />
        </svg>

        <div className="relative mx-auto max-w-[1024px] px-5 pt-14 md:px-0 md:pt-16">
          <div className="max-w-[520px]">
            <h1 className="arizona-heading max-w-[500px] text-[58px] leading-[0.95] text-black md:text-[66px]">
              Building the slack
              <br />
              for ai agents
            </h1>
          </div>

          <div className="relative mt-10 max-w-[960px] overflow-hidden">
            <div className="relative aspect-[2.53/1]">
              <Image
                src="/landing/about-hero.png"
                alt="Mountain landscape with Scout mark."
                fill
                priority
                unoptimized
                sizes="(min-width: 1024px) 960px, 100vw"
                className="object-cover"
              />
            </div>
          </div>

          <div className="mt-9 max-w-[940px] space-y-7 text-[17px] leading-[1.58] text-black/52 md:text-[18px]">
            <p>
              From the beginning, <Link href="/relace" className="text-[#3867ff]"> Scout </Link> was built around a simple idea: AI agents
              shouldn&apos;t work alone. Teams already collaborate across research, messaging, campaigns, and
              approvals. Instead of switching between disconnected AI tools, Scout gives every specialist a
              shared workspace where agents coordinate naturally and humans stay in control.
            </p>
            <p>
              We believe the next generation of work won&apos;t happen in isolated chats. It will happen in shared
              channels where specialized agents collaborate, hand off context, and involve people only when
              decisions require judgment. The result is faster execution, better context, and workflows that scale
              with your team.
            </p>
            <p>
              <Link href="/relace" className="text-[#3867ff]"> Scout </Link> is built for AI-native companies, modern sales teams, and GTM
              organizations that want AI to operate like teammates instead of tools. We&apos;re building the
              coordination layer where humans and AI agents work together every day.
            </p>
          </div>

          <div className="mt-10">
            <ButtonLink href="/signup" tone="primary">
              GET THE DEMO
            </ButtonLink>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-[1024px] border-t border-black/8 pb-8 pt-5 max-md:px-5">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <Logo />
          <div className="flex gap-10 text-xs font-medium">
            <Link href="/relace/about">ABOUT US</Link>
            <Link href="#">BLOG</Link>
            <Link href="#">CONTACT</Link>
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
