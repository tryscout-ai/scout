"use client";

import {
  BotIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  HashIcon,
  LayoutDashboardIcon,
  PlugIcon,
  RefreshCwIcon,
  WorkflowIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SlackWorkspace {
  id: string;
  slack_team_name: string | null;
  slack_team_id: string;
  install_status: string;
}

interface SlackAgent {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  model: string;
  status: string;
}

interface SlackAgentApp {
  id: string;
  agent_id: string;
  slack_app_id: string | null;
  slack_bot_user_id: string | null;
  slack_app_name: string;
  install_url: string | null;
  install_status: "pending_manifest" | "pending_install" | "installed" | "error";
  last_error: string | null;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
}

interface SlackHome {
  server: { id: string; name: string; slug: string };
  workspace: SlackWorkspace | null;
  agents: SlackAgent[];
  agentApps: SlackAgentApp[];
  channelMappings: Array<{ id: string; slack_channel_id: string; scout_channel_id: string }>;
  taskCount: number;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "installed" || status === "connected") {
    return <Badge variant="success">Connected</Badge>;
  }
  if (status === "error") return <Badge variant="error">Needs attention</Badge>;
  return <Badge variant="warning">Pending</Badge>;
}

export default function SlackPage() {
  const [activeView, setActiveView] = useState<"dashboard" | "agents">("dashboard");
  const [home, setHome] = useState<SlackHome | null>(null);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    display_name: "",
    description: "",
    system_prompt: "",
    model: "opus",
  });
  const [selectedChannels, setSelectedChannels] = useState<Record<string, string>>({});

  async function loadHome() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/slack/agents");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load Slack workspace");
      setHome(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Slack workspace");
    } finally {
      setLoading(false);
    }
  }

  async function loadChannels() {
    try {
      const res = await fetch("/api/slack/channels");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load channels");
      setChannels(data.channels || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load channels");
    }
  }

  useEffect(() => {
    loadHome();
  }, []);

  useEffect(() => {
    if (home?.workspace) loadChannels();
  }, [home?.workspace?.id]);

  const appsByAgent = useMemo(() => {
    const map = new Map<string, SlackAgentApp>();
    for (const app of home?.agentApps || []) map.set(app.agent_id, app);
    return map;
  }, [home?.agentApps]);

  const installedCount = (home?.agentApps || []).filter((app) => app.install_status === "installed").length;
  const mappedCount = home?.channelMappings.length || 0;

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/slack/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, returnTo: window.location.href }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create agent");
      setForm({ display_name: "", description: "", system_prompt: "", model: "opus" });
      await loadHome();
      if (data.app?.install_url) window.location.href = data.app.install_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setSubmitting(false);
    }
  }

  async function mapChannel(agentId: string) {
    const channelId = selectedChannels[agentId];
    const channel = channels.find((item) => item.id === channelId);
    if (!channel) return;

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/slack/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          slack_channel_id: channel.id,
          slack_channel_name: channel.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not onboard channel");
      await loadHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not onboard channel");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !home) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading Slack workspace...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background p-2">
      <aside className="flex w-64 shrink-0 flex-col border-border border-r px-3 py-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <WorkflowIcon className="size-4" />
          </div>
          <div>
            <div className="font-semibold text-foreground text-sm">Scout for Slack</div>
            <div className="text-muted-foreground text-xs">Hackathon workspace</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          <button
            className={`flex h-9 items-center gap-2 rounded-lg px-2 text-left text-sm ${activeView === "dashboard" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
            onClick={() => setActiveView("dashboard")}
            type="button"
          >
            <LayoutDashboardIcon className="size-4" />
            Dashboard
          </button>
          <button
            className={`flex h-9 items-center gap-2 rounded-lg px-2 text-left text-sm ${activeView === "agents" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
            onClick={() => setActiveView("agents")}
            type="button"
          >
            <BotIcon className="size-4" />
            Agents
          </button>
        </nav>

        <div className="mt-auto px-2 text-muted-foreground text-xs">
          Existing Scout chat stays at{" "}
          {home?.server ? (
            <Link className="text-foreground underline-offset-4 hover:underline" href={`/s/${home.server.slug}`}>
              /s/{home.server.slug}
            </Link>
          ) : (
            "the workspace"
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-7">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-semibold text-2xl text-foreground">
                {activeView === "dashboard" ? "Slack Dashboard" : "Slack Agents"}
              </h1>
              <p className="mt-1 text-muted-foreground text-sm">
                Connect a workspace, onboard agent bots, and map them into Slack channels.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={loadHome} size="sm" variant="outline">
                <RefreshCwIcon />
                Refresh
              </Button>
              <Button
                onClick={() => {
                  window.location.href = `/api/slack/oauth/start?returnTo=${encodeURIComponent(window.location.href)}`;
                }}
                size="sm"
                type="button"
              >
                <PlugIcon />
                Connect Slack
              </Button>
            </div>
          </header>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive-foreground text-sm">
              {error}
            </div>
          )}

          {activeView === "dashboard" ? (
            <section className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">Workspace</span>
                  {home?.workspace ? <StatusBadge status={home.workspace.install_status} /> : <Badge variant="warning">Not connected</Badge>}
                </div>
                <div className="font-medium text-foreground">
                  {home?.workspace?.slack_team_name || "Connect Slack"}
                </div>
                <div className="mt-1 text-muted-foreground text-xs">
                  {home?.workspace?.slack_team_id || "OAuth install required"}
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
                  <BotIcon className="size-4" />
                  Agent bots
                </div>
                <div className="font-semibold text-2xl text-foreground">{installedCount}</div>
                <div className="mt-1 text-muted-foreground text-xs">installed of {home?.agents.length || 0}</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
                  <HashIcon className="size-4" />
                  Channels
                </div>
                <div className="font-semibold text-2xl text-foreground">{mappedCount}</div>
                <div className="mt-1 text-muted-foreground text-xs">mapped into Scout</div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <div className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
                  <UsersIcon className="size-4" />
                  Tasks
                </div>
                <div className="font-semibold text-2xl text-foreground">{home?.taskCount || 0}</div>
                <div className="mt-1 text-muted-foreground text-xs">created from Slack</div>
              </div>
            </section>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
              <form className="flex flex-col gap-4 rounded-lg border bg-card p-4" onSubmit={createAgent}>
                <div>
                  <h2 className="font-medium text-foreground">Create agent bot</h2>
                  <p className="mt-1 text-muted-foreground text-sm">
                    Scout creates the agent, then creates a Slack app manifest for its dedicated bot.
                  </p>
                </div>
                <label className="flex flex-col gap-1.5 text-sm">
                  Display name
                  <Input
                    onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
                    placeholder="Project Manager"
                    value={form.display_name}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  Description
                  <Input
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                    placeholder="Coordinates execution and handoffs"
                    value={form.description}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  System prompt
                  <Textarea
                    onChange={(event) => setForm((prev) => ({ ...prev, system_prompt: event.target.value }))}
                    placeholder="You are responsible for..."
                    value={form.system_prompt}
                  />
                </label>
                <Button disabled={!home?.workspace || !form.display_name.trim()} loading={submitting} type="submit">
                  <BotIcon />
                  Create and install
                </Button>
              </form>

              <section className="flex flex-col gap-3">
                {(home?.agents || []).map((agent) => {
                  const app = appsByAgent.get(agent.id);
                  const selectedChannel = selectedChannels[agent.id] || "";
                  return (
                    <div className="rounded-lg border bg-card p-4" key={agent.id}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-foreground">{agent.display_name}</h3>
                            {app ? <StatusBadge status={app.install_status} /> : <Badge variant="warning">No Slack app</Badge>}
                          </div>
                          <p className="mt-1 text-muted-foreground text-sm">{agent.description || agent.name}</p>
                        </div>
                        {app?.install_url && app.install_status !== "installed" && (
                          <Button render={<a href={app.install_url} />} size="sm">
                            <ExternalLinkIcon />
                            Install bot
                          </Button>
                        )}
                        {app?.install_status === "installed" && (
                          <div className="flex items-center gap-1 text-success-foreground text-sm">
                            <CheckCircle2Icon className="size-4" />
                            {app.slack_bot_user_id}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <select
                          className="h-8 min-w-56 rounded-lg border border-input bg-background px-2 text-sm"
                          onChange={(event) =>
                            setSelectedChannels((prev) => ({ ...prev, [agent.id]: event.target.value }))
                          }
                          value={selectedChannel}
                        >
                          <option value="">Choose Slack channel</option>
                          {channels.map((channel) => (
                            <option key={channel.id} value={channel.id}>
                              #{channel.name}{channel.is_private ? " (private)" : ""}
                            </option>
                          ))}
                        </select>
                        <Button
                          disabled={!selectedChannel || submitting || app?.install_status !== "installed"}
                          onClick={() => mapChannel(agent.id)}
                          size="sm"
                          variant="outline"
                        >
                          <HashIcon />
                          Onboard channel
                        </Button>
                      </div>
                      {app?.last_error && <p className="mt-3 text-destructive-foreground text-sm">{app.last_error}</p>}
                    </div>
                  );
                })}

                {home?.agents.length === 0 && (
                  <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
                    Connect Slack, then create the first agent bot for the workspace.
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
