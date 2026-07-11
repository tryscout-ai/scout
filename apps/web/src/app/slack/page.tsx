"use client";

import {
  BotIcon,
  CheckCircle2Icon,
  CopyIcon,
  ExternalLinkIcon,
  HashIcon,
  LayoutDashboardIcon,
  PlayCircleIcon,
  PencilIcon,
  PlugIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  WorkflowIcon,
  UsersIcon,
  XIcon,
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
  system_prompt: string | null;
  model: string;
  status: string;
  scout_channels?: Array<{ id: string; name: string }>;
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
  bridgeKey: {
    key_prefix: string;
    key_value: string | null;
    last_used_at: string | null;
    online: boolean;
  };
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
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [editingPromptAgentId, setEditingPromptAgentId] = useState<string | null>(null);
  const [savingPromptAgentId, setSavingPromptAgentId] = useState<string | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [copiedBridgeCommand, setCopiedBridgeCommand] = useState(false);
  const [demoChannelId, setDemoChannelId] = useState("");
  const [demoSubmitting, setDemoSubmitting] = useState(false);
  const [serverUrl] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin
  );
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
  const slackButtonLabel = home?.workspace ? "Reconnect Slack" : "Connect Slack";
  const isLocalServer = serverUrl.includes("localhost") || serverUrl.includes("127.0.0.1");
  const slackBridgeCommand = home?.bridgeKey?.key_value
    ? isLocalServer
      ? "pnpm dev:slack:bridge"
      : [
          "npx @scout-ai/scout-bridge@0.1.6",
          serverUrl ? `--server-url ${serverUrl}` : "",
          `--api-key ${home.bridgeKey.key_value}`,
        ].filter(Boolean).join(" ")
    : "";

  async function copySlackBridgeCommand() {
    if (!slackBridgeCommand) return;
    await navigator.clipboard.writeText(slackBridgeCommand);
    setCopiedBridgeCommand(true);
    setTimeout(() => setCopiedBridgeCommand(false), 2000);
  }

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

  async function setupDemoChannel() {
    const channel = channels.find((item) => item.id === demoChannelId);
    if (!channel) return;

    setDemoSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/slack/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demo: true,
          slack_channel_id: channel.id,
          slack_channel_name: channel.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not set up hosted demo");
      await loadHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up hosted demo");
    } finally {
      setDemoSubmitting(false);
    }
  }

  function startEditingPrompt(agent: SlackAgent) {
    setEditingPromptAgentId(agent.id);
    setPromptDrafts((prev) => ({
      ...prev,
      [agent.id]: agent.system_prompt || "",
    }));
  }

  function cancelEditingPrompt(agentId: string) {
    setEditingPromptAgentId(null);
    setPromptDrafts((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }

  async function saveSystemPrompt(agent: SlackAgent) {
    setSavingPromptAgentId(agent.id);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_prompt: promptDrafts[agent.id] || "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update system prompt");
      cancelEditingPrompt(agent.id);
      await loadHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update system prompt");
    } finally {
      setSavingPromptAgentId(null);
    }
  }

  async function deleteAgent(agent: SlackAgent) {
    const confirmed = window.confirm(
      `Delete ${agent.display_name}? This removes the Scout agent and local Slack mapping records, but does not uninstall the Slack app from your Slack workspace.`
    );
    if (!confirmed) return;

    setDeletingAgentId(agent.id);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete agent");
      setSelectedChannels((prev) => {
        const next = { ...prev };
        delete next[agent.id];
        return next;
      });
      await loadHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete agent");
    } finally {
      setDeletingAgentId(null);
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
	                Connect Slack, choose one channel, and launch a hosted multi-agent demo without installing a bridge.
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
                {slackButtonLabel}
              </Button>
            </div>
          </header>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive-foreground text-sm">
              {error}
            </div>
          )}

          {activeView === "dashboard" ? (
            <>
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

	              <section className="rounded-lg border bg-card p-4">
	                <div className="flex flex-wrap items-start justify-between gap-4">
	                  <div className="max-w-2xl">
	                    <div className="mb-2 flex items-center gap-2">
	                      <h2 className="font-medium text-foreground">Hosted Slack demo</h2>
	                      {home?.bridgeKey.online ? <Badge variant="success">Managed bridge online</Badge> : <Badge variant="warning">Managed bridge offline</Badge>}
	                    </div>
	                    <p className="text-muted-foreground text-sm">
	                      This hackathon path creates Research, Enrichment, Outreach, and Reviewer agents for one Slack channel. Judges only install the Slack app and mention Scout in that channel.
	                    </p>
	                    <ol className="mt-3 grid gap-1 text-muted-foreground text-sm">
	                      <li>1. Connect Slack.</li>
	                      <li>2. Pick a public demo channel, ideally #scout-demo.</li>
	                      <li>3. In Slack, mention Scout with a lead, company, or task.</li>
	                    </ol>
	                  </div>
	                  <div className="flex min-w-72 flex-col gap-2">
	                    <select
	                      className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
	                      disabled={!home?.workspace || channels.length === 0}
	                      onChange={(event) => setDemoChannelId(event.target.value)}
	                      value={demoChannelId}
	                    >
	                      <option value="">Choose demo channel</option>
	                      {channels.map((channel) => (
	                        <option key={channel.id} value={channel.id}>
	                          #{channel.name}{channel.is_private ? " (private)" : ""}
	                        </option>
	                      ))}
	                    </select>
	                    <Button
	                      disabled={!home?.workspace || !demoChannelId || demoSubmitting}
	                      loading={demoSubmitting}
	                      onClick={setupDemoChannel}
	                      type="button"
	                    >
	                      <PlayCircleIcon />
	                      Set up hosted demo
	                    </Button>
	                  </div>
	                </div>
	              </section>

	              <section className="rounded-lg border bg-card p-4">
	                <div className="flex flex-wrap items-start justify-between gap-4">
	                  <div>
	                    <div className="mb-2 flex items-center gap-2">
	                      <h2 className="font-medium text-foreground">Bridge status</h2>
	                      {home?.bridgeKey.online ? <Badge variant="success">Online</Badge> : <Badge variant="warning">Offline</Badge>}
	                    </div>
	                    <p className="text-muted-foreground text-sm">
	                      Public testers should not run this. For the hackathon, keep one managed bridge running from your deployment host with this workspace's bridge key.
	                    </p>
                    {isLocalServer && (
                      <p className="mt-2 text-muted-foreground text-xs">
                        Local development uses the workspace bridge script so Slack agents run the source code in this repo.
                      </p>
                    )}
                    <div className="mt-2 text-muted-foreground text-xs">
                      Last seen: {home?.bridgeKey.last_used_at ? new Date(home.bridgeKey.last_used_at).toLocaleString() : "Never"}
                    </div>
                  </div>
                  <Button disabled={!slackBridgeCommand} onClick={copySlackBridgeCommand} size="sm" type="button" variant="outline">
                    {copiedBridgeCommand ? <CheckCircle2Icon /> : <CopyIcon />}
                    {copiedBridgeCommand ? "Copied" : "Copy command"}
                  </Button>
                </div>
                <code className="mt-3 block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-muted-foreground text-xs">
                  {slackBridgeCommand || "Bridge key unavailable"}
                </code>
              </section>

              <section className="rounded-lg border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <h2 className="font-medium text-foreground">Agents</h2>
                    <p className="text-muted-foreground text-sm">Installed bots and their Slack channel mappings.</p>
                  </div>
                  <Button onClick={() => setActiveView("agents")} size="sm" variant="outline">
                    <BotIcon />
                    Manage agents
                  </Button>
                </div>
                <div className="divide-y">
                  {(home?.agents || []).map((agent) => {
                    const app = appsByAgent.get(agent.id);
                    const channelNames = agent.scout_channels?.map((channel) => channel.name) || [];
                    return (
                      <div className="grid gap-3 px-4 py-3 md:grid-cols-[1.2fr_1fr_1fr]" key={agent.id}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate font-medium text-foreground">{agent.display_name}</h3>
                            {app ? <StatusBadge status={app.install_status} /> : <Badge variant="warning">No Slack app</Badge>}
                          </div>
                          <p className="mt-1 truncate text-muted-foreground text-sm">{agent.description || agent.name}</p>
                        </div>
                        <div className="min-w-0">
                          <div className="text-muted-foreground text-xs">Onboarded channels</div>
                          <div className="mt-1 truncate text-sm">
                            {channelNames.length ? channelNames.map((name) => `#${name}`).join(", ") : "No channels onboarded"}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-muted-foreground text-xs">Agent ID</div>
                          <code className="mt-1 block truncate rounded bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
                            {agent.id}
                          </code>
                        </div>
                      </div>
                    );
                  })}
                  {home?.agents.length === 0 && (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                      No Slack agents yet.
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
              <form className="flex flex-col gap-4 rounded-lg border bg-card p-4" onSubmit={createAgent}>
                <div>
                  <h2 className="font-medium text-foreground">Create agent bot</h2>
                  <p className="mt-1 text-muted-foreground text-sm">
                    Scout creates the agent, then creates a Slack app manifest for its dedicated bot.
                  </p>
                </div>
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
                  <span className="font-medium">Note:</span>{" "}
                  For multi-agent coordination in Slack, install every required agent bot and onboard each one to the Slack channel where the handoff should run.
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
                          <div className="mt-2 grid gap-1 text-muted-foreground text-xs">
                            <div>
                              ID: <code className="font-mono">{agent.id}</code>
                            </div>
                            <div>
                              Channels:{" "}
                              {agent.scout_channels?.length
                                ? agent.scout_channels.map((channel) => `#${channel.name}`).join(", ")
                                : "No channels onboarded"}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
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
                          <Button
                            disabled={savingPromptAgentId === agent.id}
                            onClick={() => startEditingPrompt(agent)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <PencilIcon />
                            Edit prompt
                          </Button>
                          <Button
                            disabled={submitting || deletingAgentId === agent.id}
                            loading={deletingAgentId === agent.id}
                            onClick={() => deleteAgent(agent)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Trash2Icon />
                            Delete
                          </Button>
                        </div>
                      </div>

                      {editingPromptAgentId === agent.id && (
                        <div className="mt-4 rounded-lg border bg-muted/30 p-3">
                          <label className="flex flex-col gap-1.5 text-sm">
                            System prompt
                            <Textarea
                              className="min-h-32 bg-background"
                              onChange={(event) =>
                                setPromptDrafts((prev) => ({
                                  ...prev,
                                  [agent.id]: event.target.value,
                                }))
                              }
                              value={promptDrafts[agent.id] ?? ""}
                            />
                          </label>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              disabled={savingPromptAgentId === agent.id}
                              loading={savingPromptAgentId === agent.id}
                              onClick={() => saveSystemPrompt(agent)}
                              size="sm"
                              type="button"
                            >
                              <SaveIcon />
                              Save prompt
                            </Button>
                            <Button
                              disabled={savingPromptAgentId === agent.id}
                              onClick={() => cancelEditingPrompt(agent.id)}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <XIcon />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}

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
