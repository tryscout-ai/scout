"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select";
import { GeneratedAvatar } from "./generated-avatar";
import { normalizeLegacyBranding } from "@/lib/branding";

interface Agent {
  id: string;
  display_name: string;
  description: string | null;
  status: string;
}

interface ChannelOption {
  id: string;
  name: string;
  type: string;
  server_id: string;
}

interface ChannelSelectItem {
  label: string;
  value: ChannelOption;
}

interface InviteAgentsDialogProps {
  open: boolean;
  initialChannelId: string;
  onClose: () => void;
  onInvited: () => void;
}

export function InviteAgentsDialog({
  open,
  initialChannelId,
  onClose,
  onInvited,
}: InviteAgentsDialogProps) {
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState(initialChannelId);
  const [existingAgentIds, setExistingAgentIds] = useState<Set<string>>(new Set());
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();
  const channelItems: ChannelSelectItem[] = channels.map((channel) => ({
    label: `#${channel.name}`,
    value: channel,
  }));

  const loadExistingMembers = useCallback(
    async (channelId: string) => {
      const { data: members, error: membersError } = await supabase
        .from("channel_members")
        .select("member_id")
        .eq("channel_id", channelId)
        .eq("member_type", "agent");

      if (membersError) {
        throw new Error(membersError.message);
      }

      setExistingAgentIds(new Set((members || []).map((member) => member.member_id)));
      setSelectedAgentIds(new Set());
    },
    [supabase]
  );

  const loadData = useCallback(async (channelId: string) => {
    try {
      const { data: currentChannel, error: currentChannelError } = await supabase
        .from("channels")
        .select("id, name, type, server_id")
        .eq("id", channelId)
        .single();

      if (currentChannelError || !currentChannel) {
        throw new Error(currentChannelError?.message || "Unable to load channel");
      }

      const [{ data: channelsData, error: channelsError }, { data: agentsData, error: agentsError }] =
        await Promise.all([
          supabase
            .from("channels")
            .select("id, name, type, server_id")
            .eq("server_id", currentChannel.server_id)
            .neq("type", "dm")
            .order("created_at"),
          supabase
            .from("agents")
            .select("id, display_name, description, status")
            .eq("server_id", currentChannel.server_id)
            .order("created_at"),
        ]);

      if (channelsError) {
        throw new Error(channelsError.message);
      }

      if (agentsError) {
        throw new Error(agentsError.message);
      }

      setChannels((channelsData as ChannelOption[]) || []);
      setAgents(
        ((agentsData as Agent[]) || []).map((agent) => ({
          ...agent,
          description: normalizeLegacyBranding(agent.description),
        }))
      );

      await loadExistingMembers(channelId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invite options");
    } finally {
      setLoading(false);
    }
  }, [loadExistingMembers, supabase]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function initialize() {
      setLoading(true);
      setError("");

      try {
        await loadData(initialChannelId);
        if (cancelled) {
          return;
        }

        setSelectedChannelId(initialChannelId);
        setSelectedAgentIds(new Set());
        setExistingAgentIds((current) => new Set(current));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [initialChannelId, loadData, open]);

  const handleChannelChange = useCallback(async (value: ChannelOption | null) => {
    if (!value) {
      return;
    }

    setSelectedChannelId(value.id);
    setError("");

    try {
      await loadExistingMembers(value.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel members");
    }
  }, [loadExistingMembers]);

  function toggleAgent(agentId: string) {
    if (existingAgentIds.has(agentId)) {
      return;
    }

    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChannelId || selectedAgentIds.size === 0) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const rows = Array.from(selectedAgentIds).map((agentId) => ({
        channel_id: selectedChannelId,
        member_id: agentId,
        member_type: "agent",
      }));

      const { error: insertError } = await supabase.from("channel_members").insert(rows);
      if (insertError) {
        throw new Error(insertError.message);
      }

      onInvited();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite agents");
    } finally {
      setSaving(false);
    }
  }

  const selectedChannel =
    channels.find((channel) => channel.id === selectedChannelId) ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Invite Agents</DialogTitle>
          <DialogDescription>Add agents to this channel, or switch the target channel if needed.</DialogDescription>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogPanel>
            <div className="space-y-4">
              <Field>
                <FieldLabel>Channel</FieldLabel>
                <Select
                  value={selectedChannel}
                  onValueChange={(value) => {
                    void handleChannelChange(value as ChannelOption | null);
                  }}
                  items={channelItems}
                >
                  <SelectTrigger disabled={loading || channels.length === 0}>
                    <SelectValue placeholder="Select a channel" />
                  </SelectTrigger>
                  <SelectPopup>
                    {channels.map((channel) => (
                      <SelectItem key={channel.id} value={channel}>
                        #{channel.name}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Agents</FieldLabel>
                <div className="rounded-lg border">
                  <div className="space-y-1 p-2">
                    {agents.length === 0 && !loading ? (
                      <div className="px-2.5 py-3 text-sm text-muted-foreground">
                        No agents available in this workspace yet.
                      </div>
                    ) : (
                      agents.map((agent) => {
                        const alreadyInChannel = existingAgentIds.has(agent.id);
                        return (
                          <Label
                            key={agent.id}
                            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-accent"
                          >
                            <Checkbox
                              checked={alreadyInChannel || selectedAgentIds.has(agent.id)}
                              disabled={alreadyInChannel}
                              onCheckedChange={() => toggleAgent(agent.id)}
                            />
                            <GeneratedAvatar id={agent.id} name={agent.display_name} size="xs" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm">{agent.display_name}</div>
                              <div className="truncate text-[10px] text-muted-foreground">
                                {alreadyInChannel
                                  ? selectedChannel
                                    ? `Already in #${selectedChannel.name}`
                                    : "Already in this channel"
                                  : agent.description || "Ready to join this channel"}
                              </div>
                            </div>
                          </Label>
                        );
                      })
                    )}
                  </div>
                </div>
              </Field>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>
              Cancel
            </DialogClose>
            <Button
              type="submit"
              loading={saving}
              disabled={loading || selectedAgentIds.size === 0 || !selectedChannelId}
            >
              Add to Channel
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
