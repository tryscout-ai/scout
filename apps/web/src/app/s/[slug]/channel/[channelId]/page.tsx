"use client";

import { useMemo, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { MessageArea } from "@/components/message-area";
import { InviteAgentsDialog } from "@/components/invite-agents-dialog";

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  description: string | null;
}

export default function ChannelPage() {
  const params = useParams();
  const channelId = params.channelId as string;
  const [inviteChannel, setInviteChannel] = useState<ChannelInfo | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const channel = useMemo(
    () => ({ id: channelId, name: "", type: "public", description: null }),
    [channelId]
  );

  const handleManageChannel = useCallback((selectedChannel: ChannelInfo) => {
    setInviteChannel(selectedChannel);
  }, []);

  const handleChannelUpdated = useCallback(() => {
    setRefreshKey((value) => value + 1);
    setInviteChannel(null);
  }, []);

  return (
    <>
      <MessageArea
        key={refreshKey}
        channel={channel}
        onManageChannel={handleManageChannel}
      />
      {inviteChannel && (
        <InviteAgentsDialog
          open={!!inviteChannel}
          initialChannelId={inviteChannel.id}
          onClose={() => setInviteChannel(null)}
          onInvited={handleChannelUpdated}
        />
      )}
    </>
  );
}
