"use client";

import Image from "next/image";
import { ArrowUpRight, CheckCircle2, X } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type FormState = {
  fullName: string;
  workEmail: string;
  company: string;
  role: string;
  note: string;
  website: string;
};

type SubmitState = "idle" | "loading" | "success" | "error";

const emptyForm: FormState = {
  fullName: "",
  workEmail: "",
  company: "",
  role: "",
  note: "",
  website: "",
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function HeroCtas({
  demoUrl,
  source,
  className = "",
}: {
  demoUrl: string;
  source: "hero" | "footer";
  className?: string;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const formIsValid =
    form.fullName.trim().length > 1 &&
    isValidEmail(form.workEmail.trim()) &&
    form.company.trim().length > 1 &&
    form.role.trim().length > 1;

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (submitState === "error") {
      setSubmitState("idle");
      setErrorMessage("");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formIsValid) {
      setSubmitState("error");
      setErrorMessage("Please fill out the required fields with a valid work email.");
      return;
    }

    setSubmitState("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          workEmail: form.workEmail,
          company: form.company,
          role: form.role,
          note: form.note,
          source: `landing_${source}`,
          website: form.website,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to join the waitlist right now.");
      }

      setForm(emptyForm);
      setSubmitState("success");
    } catch (error) {
      setSubmitState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to join the waitlist right now.",
      );
    }
  }

  return (
    <div className={`flex flex-wrap gap-4 ${className}`}>
      <a
        href={demoUrl}
        className="inline-flex h-12 items-center gap-3 bg-[#212121] px-6 text-base font-medium text-white shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition hover:bg-[#2d2d2d]"
      >
        Book a demo
        <ArrowUpRight className="size-4" />
      </a>

      <Dialog>
        <DialogTrigger className="inline-flex h-12 items-center gap-3 bg-white px-6 text-base font-medium text-black shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] transition hover:bg-[#f4f4ef]">
          Join waitlist
          <ArrowUpRight className="size-4" />
        </DialogTrigger>
        <DialogPopup
          bottomStickOnMobile={false}
          className="max-h-[92vh] max-w-[980px] overflow-hidden rounded-none border-0 bg-[#fbfbf7] p-0 text-black shadow-2xl md:grid md:grid-cols-[1.05fr_0.95fr]"
          showCloseButton={false}
        >
          <div className="relative max-h-[92vh] overflow-y-auto px-6 py-8 sm:px-10 md:px-12 md:py-10">
            <Image
              src="/logo.svg"
              alt="Scout"
              width={108}
              height={32}
              className="h-8 w-auto"
            />
            <DialogClose
              aria-label="Close waitlist form"
              className="absolute right-5 top-5 inline-flex size-10 items-center justify-center bg-[#212121] text-white transition hover:bg-black md:hidden"
            >
              <X className="size-5" />
            </DialogClose>

            {submitState === "success" ? (
              <div className="flex min-h-[440px] flex-col justify-center">
                <CheckCircle2 className="size-12 text-[#212121]" />
                <DialogTitle className="arizona-heading mt-6 text-[48px] font-normal leading-[1.02]">
                  You're on the list.
                </DialogTitle>
                <DialogDescription className="mt-5 max-w-[440px] text-lg leading-7 text-black/55">
                  Thanks for joining the Scout waitlist. We'll reach out as new
                  workspace slots open for early teams.
                </DialogDescription>
                <DialogClose className="mt-8 inline-flex h-12 w-fit items-center bg-[#212121] px-6 text-xs font-medium uppercase tracking-[0.08em] text-white transition hover:bg-[#2d2d2d]">
                  Close
                </DialogClose>
              </div>
            ) : (
              <>
                <DialogTitle className="arizona-heading mt-14 text-[48px] font-normal leading-[1.02] sm:text-[56px]">
                  Join the Scout waitlist
                </DialogTitle>
                <DialogDescription className="mt-4 max-w-[520px] text-lg leading-7 text-black/55">
                  Tell us where agents could help your team. We'll use this to
                  prioritize early access and onboarding.
                </DialogDescription>

                <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
                  <input
                    aria-hidden="true"
                    autoComplete="off"
                    className="hidden"
                    name="website"
                    tabIndex={-1}
                    value={form.website}
                    onChange={(event) => updateField("website", event.target.value)}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      className="h-14 border border-black/10 bg-white px-5 text-base outline-none placeholder:text-black/40 focus:ring-1 focus:ring-[#212121]"
                      name="fullName"
                      placeholder="Full name*"
                      value={form.fullName}
                      onChange={(event) => updateField("fullName", event.target.value)}
                    />
                    <input
                      className="h-14 border border-black/10 bg-white px-5 text-base outline-none placeholder:text-black/40 focus:ring-1 focus:ring-[#212121]"
                      name="role"
                      placeholder="Role*"
                      value={form.role}
                      onChange={(event) => updateField("role", event.target.value)}
                    />
                  </div>
                  <input
                    className="h-14 w-full border border-black/10 bg-white px-5 text-base outline-none placeholder:text-black/40 focus:ring-1 focus:ring-[#212121]"
                    name="workEmail"
                    placeholder="Email*"
                    type="email"
                    value={form.workEmail}
                    onChange={(event) => updateField("workEmail", event.target.value)}
                  />
                  <input
                    className="h-14 w-full border border-black/10 bg-white px-5 text-base outline-none placeholder:text-black/40 focus:ring-1 focus:ring-[#212121]"
                    name="company"
                    placeholder="Company*"
                    value={form.company}
                    onChange={(event) => updateField("company", event.target.value)}
                  />
                  <textarea
                    className="min-h-28 w-full resize-none border border-black/10 bg-white px-5 py-4 text-base outline-none placeholder:text-black/40 focus:ring-1 focus:ring-[#212121]"
                    name="note"
                    placeholder="What would you like agents to help with? (optional)"
                    value={form.note}
                    onChange={(event) => updateField("note", event.target.value)}
                  />

                  {errorMessage ? (
                    <p className="text-sm text-red-700">{errorMessage}</p>
                  ) : null}

                  <button
                    className="inline-flex h-12 w-full items-center justify-center bg-[#212121] px-6 text-xs font-medium uppercase tracking-[0.08em] text-white transition hover:bg-[#2d2d2d] disabled:cursor-not-allowed disabled:bg-black/25"
                    disabled={submitState === "loading"}
                    type="submit"
                  >
                    {submitState === "loading" ? "Joining..." : "Join Waitlist"}
                  </button>
                </form>
              </>
            )}
          </div>

          <div className="relative hidden min-h-[620px] overflow-hidden bg-[#212121] md:block">
            <Image
              src="/landing/bg-v2.png"
              alt="Scout mountain landscape"
              fill
              sizes="420px"
              className="object-cover opacity-70 saturate-[0.8] sepia-[0.18]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            <DialogClose
              aria-label="Close waitlist form"
              className="absolute right-5 top-5 inline-flex size-12 items-center justify-center bg-white/18 text-white backdrop-blur-sm transition hover:bg-white/28"
            >
              <X className="size-7" />
            </DialogClose>
            <div className="absolute bottom-10 left-10 right-10 text-white">
              <p className="text-xs uppercase tracking-[0.28em] text-white/60">
                Early access
              </p>
              <p className="mt-3 text-2xl leading-snug">
                Shared channels for humans and AI agents working side by side.
              </p>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
