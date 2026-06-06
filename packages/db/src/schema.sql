-- ============================================================
-- Scout Database Schema
-- Run this in Supabase SQL Editor to set up your database
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------
-- Profiles (extends Supabase auth.users)
-- -----------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz default now() not null
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------
-- Agents
-- -----------------------------------------------------------
create table public.agents (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  display_name text not null,
  description text,
  system_prompt text,
  model text default 'opus' check (model in ('opus', 'sonnet', 'haiku')),
  status text default 'offline' check (status in ('online', 'sleeping', 'offline')),
  owner_id uuid references public.profiles(id) on delete cascade not null,
  server_id uuid references public.servers(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(server_id, name)
);

-- -----------------------------------------------------------
-- Channels
-- -----------------------------------------------------------
create table public.channels (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  type text default 'public' check (type in ('public', 'private', 'dm')),
  created_by uuid references public.profiles(id) on delete set null,
  server_id uuid references public.servers(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  unique(server_id, name)
);

-- -----------------------------------------------------------
-- Channel Members
-- -----------------------------------------------------------
create table public.channel_members (
  channel_id uuid references public.channels(id) on delete cascade,
  member_id uuid not null,
  member_type text not null check (member_type in ('human', 'agent')),
  joined_at timestamptz default now() not null,
  primary key (channel_id, member_id)
);

-- -----------------------------------------------------------
-- Messages
-- -----------------------------------------------------------
create table public.messages (
  id uuid default uuid_generate_v4() primary key,
  channel_id uuid references public.channels(id) on delete cascade not null,
  sender_id uuid not null,
  sender_type text not null check (sender_type in ('human', 'agent', 'system')),
  content text not null,
  seq bigint,
  thread_parent_id uuid references public.messages(id) on delete cascade,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Auto-assign per-channel sequential number on insert
create or replace function assign_message_seq()
returns trigger as $$
begin
  select coalesce(max(seq), 0) + 1 into new.seq
  from public.messages where channel_id = new.channel_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_message_seq
before insert on public.messages
for each row execute function assign_message_seq();

create index idx_messages_channel on public.messages(channel_id, created_at desc);
create index idx_messages_channel_seq on public.messages(channel_id, seq desc);
create index idx_messages_thread on public.messages(thread_parent_id, created_at asc);

-- -----------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------
create table public.tasks (
  id uuid default uuid_generate_v4() primary key,
  message_id uuid references public.messages(id) on delete cascade not null unique,
  channel_id uuid references public.channels(id) on delete cascade not null,
  task_number serial,
  status text default 'todo' check (status in ('todo', 'in_progress', 'in_review', 'done')),
  assignee_id uuid,
  assignee_type text check (assignee_type in ('human', 'agent')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_tasks_channel on public.tasks(channel_id, task_number);

-- -----------------------------------------------------------
-- Slack Integration MVP
-- -----------------------------------------------------------
create table public.slack_channel_mappings (
  id uuid default uuid_generate_v4() primary key,
  server_id uuid references public.servers(id) on delete cascade not null,
  scout_channel_id uuid references public.channels(id) on delete cascade not null,
  slack_team_id text not null,
  slack_channel_id text not null,
  created_at timestamptz default now() not null,
  unique(slack_team_id, slack_channel_id),
  unique(server_id, scout_channel_id)
);

create table public.slack_message_mappings (
  id uuid default uuid_generate_v4() primary key,
  scout_message_id uuid references public.messages(id) on delete cascade not null unique,
  slack_team_id text not null,
  slack_channel_id text not null,
  slack_message_ts text not null,
  slack_thread_ts text,
  created_at timestamptz default now() not null,
  unique(slack_team_id, slack_channel_id, slack_message_ts)
);

create table public.agent_handoffs (
  id uuid default uuid_generate_v4() primary key,
  task_id uuid references public.tasks(id) on delete cascade not null,
  message_id uuid references public.messages(id) on delete cascade not null,
  channel_id uuid references public.channels(id) on delete cascade not null,
  source_agent_id uuid references public.agents(id) on delete set null,
  target_agent_id uuid references public.agents(id) on delete set null,
  reason text not null,
  summary text not null,
  next_action text not null,
  created_at timestamptz default now() not null
);

create index idx_slack_channel_mappings_slack on public.slack_channel_mappings(slack_team_id, slack_channel_id);
create index idx_slack_message_mappings_message on public.slack_message_mappings(scout_message_id);
create index idx_agent_handoffs_task on public.agent_handoffs(task_id, created_at desc);

-- -----------------------------------------------------------
-- Row Level Security (RLS)
-- -----------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;
alter table public.slack_channel_mappings enable row level security;
alter table public.slack_message_mappings enable row level security;
alter table public.agent_handoffs enable row level security;

-- Helper functions used by RLS policies. These run as SECURITY DEFINER to
-- avoid recursive policy checks on channel_members/agents.
create or replace function public.user_is_channel_member(channel_uuid uuid)
returns boolean as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = channel_uuid and member_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function public.user_owns_agent(agent_uuid uuid)
returns boolean as $$
  select exists (
    select 1 from public.agents
    where id = agent_uuid and owner_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function public.user_has_agent_in_channel(channel_uuid uuid)
returns boolean as $$
  select exists (
    select 1
    from public.channel_members cm
    join public.agents a on a.id = cm.member_id
    where cm.channel_id = channel_uuid
      and cm.member_type = 'agent'
      and a.owner_id = auth.uid()
  );
$$ language sql security definer stable;

-- Profiles: users can read all, update own
create policy "Profiles are viewable by everyone" on public.profiles for select using (true);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- Agents: owner can manage, others can read
create policy "Agents are viewable by everyone" on public.agents for select using (true);
create policy "Owner can manage agents" on public.agents for all using (auth.uid() = owner_id);

-- Channels: members can read, creator can manage
create policy "Channel members can view channels" on public.channels for select using (
  type = 'public' or
  public.user_is_channel_member(id) or
  public.user_has_agent_in_channel(id)
);
create policy "Authenticated users can create channels" on public.channels for insert with check (auth.uid() = created_by);

-- Channel members: members can view
create policy "Members can view channel membership" on public.channel_members for select using (
  public.user_is_channel_member(channel_id) or
  public.user_has_agent_in_channel(channel_id)
);

-- Messages: channel members can read, and bridges can operate as owned agents
create policy "Channel members can view messages" on public.messages for select using (
  public.user_is_channel_member(channel_id) or
  public.user_has_agent_in_channel(channel_id)
);
create policy "Channel members can send messages" on public.messages for insert with check (
  (
    sender_id = auth.uid()
    and public.user_is_channel_member(channel_id)
  )
  or (
    sender_type = 'agent'
    and public.user_owns_agent(sender_id)
    and public.user_has_agent_in_channel(channel_id)
  )
);

-- Tasks: same as messages
create policy "Channel members can view tasks" on public.tasks for select using (
  exists (
    select 1 from public.channel_members
    where channel_id = tasks.channel_id and member_id = auth.uid()
  )
);
create policy "Channel members can manage tasks" on public.tasks for all using (
  exists (
    select 1 from public.channel_members
    where channel_id = tasks.channel_id and member_id = auth.uid()
  )
);

create policy "Channel members can view Slack channel mappings" on public.slack_channel_mappings for select using (
  public.user_is_channel_member(scout_channel_id) or public.user_has_agent_in_channel(scout_channel_id)
);

create policy "Channel members can view Slack message mappings" on public.slack_message_mappings for select using (
  exists (
    select 1 from public.messages
    where messages.id = slack_message_mappings.scout_message_id
      and (
        public.user_is_channel_member(messages.channel_id)
        or public.user_has_agent_in_channel(messages.channel_id)
      )
  )
);

create policy "Channel members can view agent handoffs" on public.agent_handoffs for select using (
  public.user_is_channel_member(channel_id) or public.user_has_agent_in_channel(channel_id)
);

-- -----------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------
-- Enable realtime for messages, agents, and channel_members tables
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.agents;
alter publication supabase_realtime add table public.channel_members;
