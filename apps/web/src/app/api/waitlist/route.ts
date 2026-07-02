import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_LENGTHS = {
  fullName: 160,
  workEmail: 320,
  company: 180,
  role: 160,
  note: 1200,
  source: 120,
};

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const honeypot = clean(payload.website, 200);

  if (honeypot) {
    return NextResponse.json({ ok: true });
  }

  const fullName = clean(payload.fullName, MAX_LENGTHS.fullName);
  const workEmail = clean(payload.workEmail, MAX_LENGTHS.workEmail).toLowerCase();
  const company = clean(payload.company, MAX_LENGTHS.company);
  const role = clean(payload.role, MAX_LENGTHS.role);
  const note = clean(payload.note, MAX_LENGTHS.note);
  const source = clean(payload.source, MAX_LENGTHS.source) || "landing";

  if (!fullName || !workEmail || !company || !role) {
    return NextResponse.json(
      { error: "Full name, work email, company, and role are required." },
      { status: 400 },
    );
  }

  if (!isValidEmail(workEmail)) {
    return NextResponse.json(
      { error: "Please enter a valid work email." },
      { status: 400 },
    );
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("waitlist_submissions").insert({
      full_name: fullName,
      work_email: workEmail,
      company,
      role,
      note: note || null,
      source,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save waitlist submission.",
      },
      { status: 500 },
    );
  }
}
