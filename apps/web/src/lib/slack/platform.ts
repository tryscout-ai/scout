import { createHash, randomBytes } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/slack/crypto";
import { createSlackOAuthState } from "@/lib/slack/oauth-state";

export interface SlackAppRecord {
  id: string;
  workspace_id: string;
  agent_id: string;
  slack_app_id: string | null;
  slack_bot_user_id: string | null;
  slack_app_name: string;
  client_id_encrypted: string | null;
  client_secret_encrypted: string | null;
  signing_secret_encrypted: string | null;
  bot_access_token_encrypted: string | null;
  install_url: string | null;
  install_status: "pending_manifest" | "pending_install" | "installed" | "error";
  last_error: string | null;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

function appUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (!base) throw new Error("Missing NEXT_PUBLIC_APP_URL");
  const normalized = base.startsWith("http") ? base : `https://${base}`;
  return new URL(path, normalized).toString();
}

function defaultLocalReturnTo() {
  return process.env.SCOUT_SLACK_RETURN_TO_URL || "http://localhost:3000/slack";
}

function normalizeReturnTo(returnTo?: string | null) {
  if (!returnTo) return defaultLocalReturnTo();

  try {
    const url = new URL(returnTo);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      url.protocol = "http:";
    }
    return url.toString();
  } catch {
    return defaultLocalReturnTo();
  }
}

function withFreshAgentInstallUrl<T extends { id: string; install_url: string | null; install_status: string }>(
  app: T,
  returnTo?: string | null
) {
  if (!app.install_url || app.install_status === "installed") return app;

  const url = new URL(app.install_url);
  url.searchParams.set("redirect_uri", appUrl("/api/slack/agent-oauth/callback"));
  url.searchParams.set(
    "state",
    createSlackOAuthState({
      kind: "agent",
      id: app.id,
      returnTo: normalizeReturnTo(returnTo),
    })
  );

  return { ...app, install_url: url.toString() };
}

function randomSuffix() {
  return randomBytes(3).toString("hex");
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export async function ensureSlackServer(userId: string) {
  const admin = createAdminClient();
  const slug = `slack-agents-${userId.substring(0, 8)}`;

  const { data: existing } = await admin
    .from("servers")
    .select("id, name, slug")
    .eq("owner_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await admin
    .from("servers")
    .insert({
      name: "Slack Agents",
      slug,
      description: "Slack-native Scout agents",
      owner_id: userId,
    })
    .select("id, name, slug")
    .single();

  if (error) throw new Error(error.message);

  await admin.from("server_members").upsert({
    server_id: created.id,
    member_id: userId,
    member_type: "human",
    role: "owner",
  });

  const rawKey = randomBytes(32).toString("hex");
  const apiKey = `zk_${rawKey}`;
  await admin.from("machine_keys").insert({
    key_prefix: `zk_${rawKey.substring(0, 8)}`,
    key_hash: createHash("sha256").update(apiKey).digest("hex"),
    key_value: apiKey,
    user_id: userId,
    server_id: created.id,
    name: "Slack bridge",
  });

  return created;
}

export async function getSlackHome(userId: string) {
  const admin = createAdminClient();
  const server = await ensureSlackServer(userId);

  const { data: workspace } = await admin
    .from("slack_workspaces")
    .select("*")
    .eq("server_id", server.id)
    .maybeSingle();

  const { data: agents } = await admin
    .from("agents")
    .select("id, name, display_name, description, model, status, created_at")
    .eq("owner_id", userId)
    .eq("server_id", server.id)
    .order("created_at");

  const agentIds = (agents || []).map((agent) => agent.id as string);
  const { data: agentApps } = agentIds.length
    ? await admin
        .from("slack_agent_apps")
        .select("id, agent_id, slack_app_id, slack_bot_user_id, slack_app_name, install_url, install_status, last_error, created_at")
        .in("agent_id", agentIds)
    : { data: [] };

  const { data: agentChannelMemberships } = agentIds.length
    ? await admin
        .from("channel_members")
        .select("member_id, channel_id, channels(id, name)")
        .eq("member_type", "agent")
        .in("member_id", agentIds)
    : { data: [] };

  const { data: channelMappings } = workspace
    ? await admin
        .from("slack_channel_mappings")
        .select("id, slack_channel_id, scout_channel_id, channels(name)")
        .eq("server_id", server.id)
        .eq("slack_team_id", workspace.slack_team_id)
    : { data: [] };

  const channelNamesById = new Map<string, string>();
  for (const mapping of (channelMappings || []) as Array<{ scout_channel_id: string; channels?: { name: string } | { name: string }[] | null }>) {
    const name = firstRelation(mapping.channels)?.name;
    if (name) channelNamesById.set(mapping.scout_channel_id, name);
  }

  const channelsByAgent = new Map<string, Array<{ id: string; name: string }>>();
  for (const membership of (agentChannelMemberships || []) as Array<{
    member_id: string;
    channel_id: string;
    channels?: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  }>) {
    const channelName = channelNamesById.get(membership.channel_id) || firstRelation(membership.channels)?.name;
    if (!channelName) continue;
    const existing = channelsByAgent.get(membership.member_id) || [];
    if (!existing.some((channel) => channel.id === membership.channel_id)) {
      existing.push({ id: membership.channel_id, name: channelName });
      channelsByAgent.set(membership.member_id, existing);
    }
  }

  const mappedChannelIds = ((channelMappings || []) as Array<{ scout_channel_id: string }>).map((m) => m.scout_channel_id);
  const { count: taskCount } = mappedChannelIds.length > 0
    ? await admin
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .in("channel_id", mappedChannelIds)
    : { count: 0 };

  return {
    server,
    workspace,
    agents: (agents || []).map((agent) => ({
      ...agent,
      scout_channels: channelsByAgent.get(agent.id as string) || [],
    })),
    agentApps: (agentApps || []).map((app) => withFreshAgentInstallUrl(app, defaultLocalReturnTo())),
    channelMappings: channelMappings || [],
    taskCount: taskCount || 0,
  };
}

export function baseSlackInstallUrl(state: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error("Missing SLACK_CLIENT_ID");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "app_mentions:read,channels:history,channels:join,channels:read,chat:write,commands,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read");
  url.searchParams.set("redirect_uri", appUrl("/api/oauth/callback"));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeSlackCode(params: {
  code: string;
  redirectPath: string;
  clientId?: string | null;
  clientSecret?: string | null;
}) {
  const clientId = params.clientId || process.env.SLACK_CLIENT_ID;
  const clientSecret = params.clientSecret || process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing Slack OAuth client credentials");

  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: appUrl(params.redirectPath),
    }),
  });

  const body = (await response.json()) as SlackApiResponse & {
    access_token?: string;
    team?: { id: string; name?: string };
    bot_user_id?: string;
    app_id?: string;
    authed_user?: { access_token?: string };
  };

  if (!body.ok) throw new Error(body.error || "Slack OAuth exchange failed");
  return body;
}

export async function storeWorkspaceInstall(params: {
  userId: string;
  serverId: string;
  teamId: string;
  teamName?: string | null;
  botUserId?: string | null;
  botAccessToken?: string | null;
  userAccessToken?: string | null;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slack_workspaces")
    .upsert({
      server_id: params.serverId,
      owner_id: params.userId,
      slack_team_id: params.teamId,
      slack_team_name: params.teamName || null,
      bot_user_id: params.botUserId || null,
      bot_access_token_encrypted: encryptSecret(params.botAccessToken),
      access_token_encrypted: encryptSecret(params.userAccessToken),
      install_status: "connected",
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "server_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createScoutAgent(params: {
  userId: string;
  serverId: string;
  displayName: string;
  description?: string | null;
  systemPrompt?: string | null;
  model?: string | null;
}) {
  const admin = createAdminClient();
  const baseName = slugify(params.displayName) || "agent";
  const name = `${baseName}-${params.userId.substring(0, 8)}-${randomSuffix()}`;
  const model = ["opus", "sonnet", "haiku"].includes(params.model || "") ? params.model : "opus";

  const { data: agent, error } = await admin
    .from("agents")
    .insert({
      name,
      display_name: params.displayName.trim(),
      description: params.description?.trim() || null,
      system_prompt: params.systemPrompt?.trim() || null,
      model,
      status: "offline",
      owner_id: params.userId,
      server_id: params.serverId,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const channelName = `dm-${baseName}-${agent.id.substring(0, 8)}`;
  const { data: dmChannel, error: channelError } = await admin
    .from("channels")
    .insert({
      name: channelName,
      description: `Direct chat with ${params.displayName.trim()}`,
      type: "dm",
      server_id: params.serverId,
      created_by: params.userId,
    })
    .select("id")
    .single();

  if (channelError) {
    await admin.from("agents").delete().eq("id", agent.id);
    throw new Error(channelError.message);
  }

  await admin.from("channel_members").upsert([
    { channel_id: dmChannel.id, member_id: params.userId, member_type: "human" },
    { channel_id: dmChannel.id, member_id: agent.id, member_type: "agent" },
  ]);
  await admin.from("server_members").upsert({
    server_id: params.serverId,
    member_id: agent.id,
    member_type: "agent",
    role: "member",
  });

  return agent;
}

export async function createAgentSlackApp(params: {
  workspaceId: string;
  agentId: string;
  appName: string;
  description?: string | null;
  returnTo: string;
}) {
  const appConfigToken = process.env.SCOUT_SLACK_APP_CONFIG_TOKEN;
  if (!appConfigToken) {
    throw new Error("Missing SCOUT_SLACK_APP_CONFIG_TOKEN");
  }

  const manifest = {
    display_information: {
      name: params.appName,
      description: params.description || `${params.appName} in Scout`,
    },
    features: {
      bot_user: {
        display_name: params.appName,
        always_online: true,
      },
    },
    oauth_config: {
      redirect_urls: [appUrl("/api/slack/agent-oauth/callback")],
      scopes: {
        bot: [
          "app_mentions:read",
          "channels:history",
          "channels:join",
          "channels:read",
          "chat:write",
          "groups:history",
          "groups:read",
          "im:history",
          "im:read",
          "mpim:history",
          "mpim:read",
          "users:read",
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: appUrl("/api/slack/agent-events"),
        bot_events: ["app_mention", "message.channels", "message.groups"],
      },
      interactivity: {
        is_enabled: true,
        request_url: appUrl("/api/slack/agent-events"),
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };

  const response = await fetch("https://slack.com/api/apps.manifest.create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appConfigToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ manifest }),
  });

  const body = (await response.json()) as SlackApiResponse & {
    app_id?: string;
    credentials?: {
      client_id?: string;
      client_secret?: string;
      signing_secret?: string;
    };
    oauth_authorize_url?: string;
  };

  if (!body.ok) {
    if (body.error === "token_expired") {
      throw new Error(
        "SCOUT_SLACK_APP_CONFIG_TOKEN expired in apps/web/.env.local. Refresh the Slack app config token, then restart pnpm dev:web."
      );
    }

    if (body.error === "not_allowed_token_type") {
      throw new Error(
        "SCOUT_SLACK_APP_CONFIG_TOKEN is the wrong Slack token type. Use the Slack app configuration token for apps.manifest.create, not a bot token or app-level token."
      );
    }

    throw new Error(body.error || "Slack manifest creation failed");
  }

  let installUrl = body.oauth_authorize_url || null;
  if (!installUrl && body.credentials?.client_id) {
    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", body.credentials.client_id);
    url.searchParams.set("scope", "app_mentions:read,channels:history,channels:join,channels:read,chat:write,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read");
    url.searchParams.set("redirect_uri", appUrl("/api/slack/agent-oauth/callback"));
    installUrl = url.toString();
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slack_agent_apps")
    .upsert({
      workspace_id: params.workspaceId,
      agent_id: params.agentId,
      slack_app_id: body.app_id || null,
      slack_app_name: params.appName,
      client_id_encrypted: encryptSecret(body.credentials?.client_id),
      client_secret_encrypted: encryptSecret(body.credentials?.client_secret),
      signing_secret_encrypted: encryptSecret(body.credentials?.signing_secret),
      install_url: installUrl,
      install_status: "pending_install",
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "agent_id" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  if (installUrl) {
    const url = new URL(installUrl);
    url.searchParams.set("redirect_uri", appUrl("/api/slack/agent-oauth/callback"));
    url.searchParams.set("state", createSlackOAuthState({ kind: "agent", id: data.id, returnTo: normalizeReturnTo(params.returnTo) }));
    installUrl = url.toString();

    const { data: updated, error: updateError } = await admin
      .from("slack_agent_apps")
      .update({ install_url: installUrl })
      .eq("id", data.id)
      .select("*")
      .single();
    if (updateError) throw new Error(updateError.message);
    return updated as SlackAppRecord;
  }

  return data as SlackAppRecord;
}

export async function installAgentApp(params: { app: SlackAppRecord; code: string }) {
  const clientId = decryptSecret(params.app.client_id_encrypted);
  const clientSecret = decryptSecret(params.app.client_secret_encrypted);
  const oauth = await exchangeSlackCode({
    code: params.code,
    redirectPath: "/api/slack/agent-oauth/callback",
    clientId,
    clientSecret,
  });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("slack_agent_apps")
    .update({
      slack_app_id: oauth.app_id || params.app.slack_app_id,
      slack_bot_user_id: oauth.bot_user_id || null,
      bot_access_token_encrypted: encryptSecret(oauth.access_token),
      install_status: "installed",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.app.id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getWorkspaceBotToken(workspaceId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("slack_workspaces")
    .select("bot_access_token_encrypted")
    .eq("id", workspaceId)
    .single();

  return decryptSecret(data?.bot_access_token_encrypted);
}

export async function listSlackChannels(workspaceId: string) {
  const token = await getWorkspaceBotToken(workspaceId);
  if (!token) throw new Error("Connect Slack before loading channels");

  const response = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as SlackApiResponse & {
    channels?: Array<{ id: string; name: string; is_private?: boolean }>;
  };
  if (!body.ok) throw new Error(body.error || "Could not load Slack channels");
  return body.channels || [];
}

export async function mapAgentToSlackChannel(params: {
  userId: string;
  workspaceId: string;
  serverId: string;
  agentId: string;
  slackTeamId: string;
  slackChannelId: string;
  slackChannelName: string;
}) {
  const admin = createAdminClient();
  const channelName = `slack-${slugify(params.slackChannelName || params.slackChannelId)}`;

  const { data: existingChannel } = await admin
    .from("channels")
    .select("id")
    .eq("server_id", params.serverId)
    .eq("name", channelName)
    .maybeSingle();

  const scoutChannel = existingChannel || (await admin
    .from("channels")
    .insert({
      name: channelName,
      description: `Slack channel #${params.slackChannelName}`,
      type: "public",
      server_id: params.serverId,
      created_by: params.userId,
    })
    .select("id")
    .single()).data;

  if (!scoutChannel) throw new Error("Could not create Scout channel");

  await admin.from("channel_members").upsert([
    { channel_id: scoutChannel.id, member_id: params.userId, member_type: "human" },
    { channel_id: scoutChannel.id, member_id: params.agentId, member_type: "agent" },
  ]);

  await admin.from("slack_channel_mappings").upsert({
    server_id: params.serverId,
    scout_channel_id: scoutChannel.id,
    slack_team_id: params.slackTeamId,
    slack_channel_id: params.slackChannelId,
  }, { onConflict: "slack_team_id,slack_channel_id" });

  const token = await getWorkspaceBotToken(params.workspaceId);
  if (token) {
    await fetch("https://slack.com/api/conversations.join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel: params.slackChannelId }),
    }).catch(() => undefined);
  }

  return scoutChannel;
}
