export interface WorkspaceContextInput {
  company_name?: unknown;
  company_website?: unknown;
  company_description?: unknown;
  icp?: unknown;
  niche?: unknown;
  agent_goals?: unknown;
  current_workflow?: unknown;
  context_notes?: unknown;
}

export interface WorkspaceContext {
  company_name: string;
  company_website: string;
  company_description: string;
  icp: string;
  niche: string;
  agent_goals: string;
  current_workflow: string | null;
  context_notes: string | null;
}

export const REQUIRED_WORKSPACE_CONTEXT_FIELDS = [
  "company_name",
  "company_website",
  "company_description",
  "icp",
  "niche",
  "agent_goals",
] as const;

const FIELD_LIMITS: Record<keyof WorkspaceContext, number> = {
  company_name: 160,
  company_website: 240,
  company_description: 1200,
  icp: 1200,
  niche: 600,
  agent_goals: 1600,
  current_workflow: 1200,
  context_notes: 1600,
};

function clean(value: unknown, limit: number) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

export function normalizeWorkspaceContext(input: WorkspaceContextInput): WorkspaceContext {
  const currentWorkflow = clean(input.current_workflow, FIELD_LIMITS.current_workflow);
  const contextNotes = clean(input.context_notes, FIELD_LIMITS.context_notes);

  return {
    company_name: clean(input.company_name, FIELD_LIMITS.company_name),
    company_website: clean(input.company_website, FIELD_LIMITS.company_website),
    company_description: clean(input.company_description, FIELD_LIMITS.company_description),
    icp: clean(input.icp, FIELD_LIMITS.icp),
    niche: clean(input.niche, FIELD_LIMITS.niche),
    agent_goals: clean(input.agent_goals, FIELD_LIMITS.agent_goals),
    current_workflow: currentWorkflow || null,
    context_notes: contextNotes || null,
  };
}

export function getMissingWorkspaceContextFields(context: WorkspaceContext) {
  return REQUIRED_WORKSPACE_CONTEXT_FIELDS.filter((field) => !context[field]);
}

export function isWorkspaceContextComplete(context: WorkspaceContext) {
  return getMissingWorkspaceContextFields(context).length === 0;
}

export function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
