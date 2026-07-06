-- Fix RLS policies to avoid circular dependency issues

-- Helper function to check channel membership without circular RLS dependency
CREATE OR REPLACE FUNCTION public.user_is_channel_member(channel_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = channel_uuid AND member_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.user_owns_agent(agent_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agents
    WHERE id = agent_uuid AND owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.user_has_agent_in_channel(channel_uuid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.channel_members cm
    JOIN public.agents a ON a.id = cm.member_id
    WHERE cm.channel_id = channel_uuid
      AND cm.member_type = 'agent'
      AND a.owner_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Channel members: users can see ALL members of channels they belong to
DROP POLICY IF EXISTS "Members can view channel membership" ON public.channel_members;
DROP POLICY IF EXISTS "Users can view own channel memberships" ON public.channel_members;
DROP POLICY IF EXISTS "Users can view channel memberships" ON public.channel_members;
CREATE POLICY "Users can view channel memberships"
  ON public.channel_members FOR SELECT
  USING (
    public.user_is_channel_member(channel_id)
    OR public.user_has_agent_in_channel(channel_id)
  );

-- Also allow inserting members (for channel creation flow)
DROP POLICY IF EXISTS "Users can add channel members" ON public.channel_members;
CREATE POLICY "Users can add channel members"
  ON public.channel_members FOR INSERT
  WITH CHECK (true);

-- Channels: simplify - authenticated users can see public channels and channels they're in
DROP POLICY IF EXISTS "Channel members can view channels" ON public.channels;
DROP POLICY IF EXISTS "Users can view their channels" ON public.channels;
CREATE POLICY "Users can view their channels"
  ON public.channels FOR SELECT
  USING (
    type = 'public'
    OR created_by = auth.uid()
    OR id IN (
      SELECT channel_id FROM public.channel_members WHERE member_id = auth.uid()
    )
    OR public.user_has_agent_in_channel(id)
  );

-- Messages: users can see messages in channels they're members of
DROP POLICY IF EXISTS "Channel members can view messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view messages in their channels" ON public.messages;
CREATE POLICY "Users can view messages in their channels"
  ON public.messages FOR SELECT
  USING (
    public.user_is_channel_member(channel_id)
    OR public.user_has_agent_in_channel(channel_id)
  );

-- Messages: users can send as themselves, and bridges can send as owned agents
DROP POLICY IF EXISTS "Channel members can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages in their channels" ON public.messages;
CREATE POLICY "Users can send messages in their channels"
  ON public.messages FOR INSERT
  WITH CHECK (
    (
      sender_id = auth.uid()
      AND public.user_is_channel_member(channel_id)
    )
    OR (
      sender_type = 'agent'
      AND public.user_owns_agent(sender_id)
      AND public.user_has_agent_in_channel(channel_id)
    )
  );

-- Tasks: users can see/manage tasks in channels they belong to directly or through an owned agent.
DROP POLICY IF EXISTS "Channel members can view tasks" ON public.tasks;
CREATE POLICY "Channel members can view tasks"
  ON public.tasks FOR SELECT
  USING (
    public.user_is_channel_member(channel_id)
    OR public.user_has_agent_in_channel(channel_id)
  );

DROP POLICY IF EXISTS "Channel members can manage tasks" ON public.tasks;
CREATE POLICY "Channel members can manage tasks"
  ON public.tasks FOR ALL
  USING (
    public.user_is_channel_member(channel_id)
    OR public.user_has_agent_in_channel(channel_id)
  );

-- Agents: ensure owner can see their own agents
DROP POLICY IF EXISTS "Agents are viewable by everyone" ON public.agents;
CREATE POLICY "Agents are viewable by everyone"
  ON public.agents FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Owner can manage agents" ON public.agents;
DROP POLICY IF EXISTS "Owner can manage own agents" ON public.agents;
CREATE POLICY "Owner can manage own agents"
  ON public.agents FOR ALL
  USING (auth.uid() = owner_id);

-- Slack message mappings: agents need to persist mirrored Slack replies so realtime self-echoes
-- do not repost the same Scout reply into a Slack thread.
DROP POLICY IF EXISTS "Channel members can manage Slack message mappings" ON public.slack_message_mappings;
CREATE POLICY "Channel members can manage Slack message mappings"
  ON public.slack_message_mappings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.messages
      WHERE messages.id = slack_message_mappings.scout_message_id
        AND (
          public.user_is_channel_member(messages.channel_id)
          OR public.user_has_agent_in_channel(messages.channel_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages
      WHERE messages.id = slack_message_mappings.scout_message_id
        AND (
          public.user_is_channel_member(messages.channel_id)
          OR public.user_has_agent_in_channel(messages.channel_id)
        )
    )
  );

-- Agent handoffs: let locally managed agents delegate tasks to other installed channel agents.
DROP POLICY IF EXISTS "Channel members can manage agent handoffs" ON public.agent_handoffs;
CREATE POLICY "Channel members can manage agent handoffs"
  ON public.agent_handoffs FOR ALL
  USING (
    public.user_is_channel_member(channel_id)
    OR public.user_has_agent_in_channel(channel_id)
  )
  WITH CHECK (
    public.user_is_channel_member(channel_id)
    OR public.user_has_agent_in_channel(channel_id)
  );
