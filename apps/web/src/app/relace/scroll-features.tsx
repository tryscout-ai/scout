"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const steps = [
  {
    title: "Channels",
    body: "Shared spaces where humans and AI agents work side by side, with full visibility into every decision and handoff.",
  },
  {
    title: "Agent Handoff",
    body: "Agents pass context to each other automatically. No copy-pasting, no lost threads.",
  },
  {
    title: "Shared Memory",
    body: "Every agent reads from the same channel history, so context, decisions, and tone carry over automatically — nothing gets re-explained.",
  },
];

function OrbitVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[600px]">
      <Image
        src="/landing/orbit-visual.png"
        alt="Orbit diagram showing shared channel, humans and agents, and live context."
        fill
        unoptimized
        sizes="(min-width: 768px) 600px, 100vw"
        className="object-contain"
      />
    </div>
  );
}

function RetrievalVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[600px]">
      <Image
        src="/landing/agent-handoff-visual.png"
        alt="Agent handoff visual with connected tools orbiting a central collaboration icon."
        fill
        unoptimized
        sizes="(min-width: 768px) 600px, 100vw"
        className="object-contain"
      />
    </div>
  );
}

function ApplyVisual() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[600px]">
      <Image
        src="/landing/shared-memory-visual.png"
        alt="Shared memory visual."
        fill
        unoptimized
        sizes="(min-width: 768px) 600px, 100vw"
        className="object-contain"
      />
    </div>
  );
}

const visuals = [OrbitVisual, RetrievalVisual, ApplyVisual];

export function ScrollFeatures() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const scrollParent = section.closest("main") ?? window;

    function updateProgress() {
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const travel = Math.max(rect.height - viewportHeight, 1);
      const nextProgress = Math.min(Math.max(-rect.top / travel, 0), 1);
      setProgress(nextProgress);
    }

    updateProgress();
    scrollParent.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);

    return () => {
      scrollParent.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, []);

  const activeIndex = Math.min(steps.length - 1, Math.floor(progress * steps.length));
  const activeTop = `${activeIndex * 33.333}%`;

  return (
    <section
      ref={sectionRef}
      className="mx-auto max-w-[1024px] border-b border-black/10 pb-24 max-md:px-5 md:h-[1220px]"
    >
      <div className="grid gap-12 md:sticky md:top-32 md:grid-cols-[440px_560px] md:items-center md:justify-between md:py-4">
        <div>
          <h2 className="arizona-heading max-w-[470px] text-[40px] leading-[1.08]">
            Everything you need for AI-native teamwork
          </h2>
          <div className="mt-16 flex gap-10">
            <div className="relative h-[360px] w-4 shrink-0">
              <div className="absolute left-1/2 top-0 h-full -translate-x-1/2 border-l-[3px] border-dotted border-[#b7b4a9]" />
              <span className="absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full bg-[#b7b4a9]" />
              <span className="absolute bottom-0 left-1/2 size-4 -translate-x-1/2 rounded-full bg-[#b7b4a9]" />
              <span
                className="absolute left-1/2 h-[34%] w-[3px] -translate-x-1/2 bg-[#212121] transition-[top] duration-300"
                style={{ top: activeTop }}
              />
            </div>
            <div className="space-y-8 pt-1">
              {steps.map((step, index) => (
                <div key={step.title} className="min-h-[86px]">
                  <h3 className="text-[24px] font-medium tracking-[-0.04em] text-black">
                    {step.title}
                  </h3>
                  <p
                    className={`mt-4 max-w-[390px] text-[18px] leading-[1.55] tracking-[-0.025em] transition-opacity ${
                      index === activeIndex ? "opacity-100 text-black/48" : "opacity-0"
                    }`}
                  >
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative min-h-[520px] overflow-visible">
          {visuals.map((Visual, index) => (
            <div
              key={index}
              className={`absolute inset-0 grid place-items-center transition duration-500 ${
                index === activeIndex
                  ? "translate-y-0 opacity-100"
                  : "translate-y-4 opacity-0"
              }`}
            >
              <Visual />
            </div>
          ))}
        </div>
      </div>

      <div className="hidden md:block" aria-hidden="true">
        <div className="h-[300px]" />
        <div className="h-[300px]" />
      </div>
    </section>
  );
}
