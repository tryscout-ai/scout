-- Auto-create Onboarding Agent + Channel when a new profile is created
-- Keep the context columns in sync for existing Supabase projects before the
-- trigger reads signup metadata into the first workspace.
ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_website text,
  ADD COLUMN IF NOT EXISTS company_description text,
  ADD COLUMN IF NOT EXISTS icp text,
  ADD COLUMN IF NOT EXISTS niche text,
  ADD COLUMN IF NOT EXISTS agent_goals text,
  ADD COLUMN IF NOT EXISTS current_workflow text,
  ADD COLUMN IF NOT EXISTS context_notes text,
  ADD COLUMN IF NOT EXISTS organization_summary text,
  ADD COLUMN IF NOT EXISTS organization_summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS organization_summary_error text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger AS $func$
DECLARE
  server_id uuid;
  agent_id uuid;
  onboarding_channel_id uuid;
  dm_channel_id uuid;
  server_slug text;
  signup_metadata jsonb;
  company_name text;
  company_website text;
  company_description text;
  icp text;
  niche text;
  agent_goals text;
  current_workflow text;
  context_notes text;
BEGIN
  server_id := gen_random_uuid();
  agent_id := gen_random_uuid();
  onboarding_channel_id := gen_random_uuid();
  dm_channel_id := gen_random_uuid();
  SELECT raw_user_meta_data INTO signup_metadata
  FROM auth.users
  WHERE id = new.id;

  company_name := nullif(trim(coalesce(signup_metadata->>'company_name', '')), '');
  company_website := nullif(trim(coalesce(signup_metadata->>'company_website', '')), '');
  company_description := nullif(trim(coalesce(signup_metadata->>'company_description', '')), '');
  icp := nullif(trim(coalesce(signup_metadata->>'icp', '')), '');
  niche := nullif(trim(coalesce(signup_metadata->>'niche', '')), '');
  agent_goals := nullif(trim(coalesce(signup_metadata->>'agent_goals', '')), '');
  current_workflow := nullif(trim(coalesce(signup_metadata->>'current_workflow', '')), '');
  context_notes := nullif(trim(coalesce(signup_metadata->>'context_notes', '')), '');

  server_slug := lower(regexp_replace(coalesce(company_name, new.display_name), '[^a-zA-Z0-9]+', '-', 'g'));
  server_slug := trim(both '-' from server_slug) || '-' || substr(new.id::text, 1, 8);

  -- Create the user's first workspace
  INSERT INTO public.servers (
    id,
    name,
    slug,
    description,
    company_name,
    company_website,
    company_description,
    icp,
    niche,
    agent_goals,
    current_workflow,
    context_notes,
    onboarding_completed_at,
    owner_id
  )
  VALUES (
    server_id,
    coalesce(company_name, new.display_name || '''s workspace'),
    server_slug,
    coalesce(company_description, 'Your first Scout workspace'),
    company_name,
    company_website,
    company_description,
    icp,
    niche,
    agent_goals,
    current_workflow,
    context_notes,
    case
      when company_name is not null
       and company_website is not null
       and company_description is not null
       and icp is not null
       and niche is not null
       and agent_goals is not null
      then now()
      else null
    end,
    new.id
  );

  INSERT INTO public.server_members (server_id, member_id, member_type, role)
  VALUES (server_id, new.id, 'human', 'owner');

  -- Create Onboarding Agent
  INSERT INTO public.agents (id, name, display_name, description, system_prompt, status, owner_id, server_id)
  VALUES (
    agent_id,
    'onboarding-' || substr(new.id::text, 1, 8),
    'Onboarding Assistant',
    'Your guide to setting up Scout',
    E'You are the Onboarding Assistant for Scout — a collaborative platform where humans work with AI agents.\n\nYour job is to onboard the user step by step. The workspace may already include company context captured during signup. Use that context first; do not ask the user to repeat company name, website, ICP, niche, or goals unless something is missing or unclear.\n\nFollow these goals (soft guidance, do not force):\n1. First, ask what language they prefer. Then use that language for the rest of the conversation.\n2. Briefly reflect the company context you have and ask for corrections or gaps.\n3. Help them understand what Scout is and get comfortable using it.\n4. Guide them to create an initial team of AI agents (target: at least 2-3 agents) tailored to their company, ICP, niche, and goals.\n5. Help them create useful channels for organizing their work.\n\nRules:\n- Keep it simple and conversational. One actionable next step at a time.\n- No info dumps, no checklist-style interrogation.\n- Ask thoughtful clarification questions only where the captured context is incomplete or ambiguous.\n- When you have enough context, suggest specific agent configurations (name, role, description).\n- Be warm, proactive, and helpful.',
    'offline',
    new.id,
    server_id
  );

  INSERT INTO public.server_members (server_id, member_id, member_type, role)
  VALUES (server_id, agent_id, 'agent', 'member');

  -- Create #onboarding channel
  INSERT INTO public.channels (id, name, description, type, created_by, server_id)
  VALUES (
    onboarding_channel_id,
    'onboarding-' || substr(new.display_name, 1, 20),
    'Your onboarding workspace',
    'public',
    new.id,
    server_id
  );

  -- Add user and agent to onboarding channel
  INSERT INTO public.channel_members (channel_id, member_id, member_type)
  VALUES (onboarding_channel_id, new.id, 'human');
  INSERT INTO public.channel_members (channel_id, member_id, member_type)
  VALUES (onboarding_channel_id, agent_id, 'agent');

  -- Also create a DM channel for direct chat with the Onboarding Agent
  INSERT INTO public.channels (id, name, description, type, created_by, server_id)
  VALUES (
    dm_channel_id,
    'Onboarding Assistant',
    'Direct chat with your onboarding guide',
    'dm',
    new.id,
    server_id
  );
  INSERT INTO public.channel_members (channel_id, member_id, member_type)
  VALUES (dm_channel_id, new.id, 'human');
  INSERT INTO public.channel_members (channel_id, member_id, member_type)
  VALUES (dm_channel_id, agent_id, 'agent');

  -- System-triggered onboarding task message in the channel
  INSERT INTO public.messages (channel_id, sender_id, sender_type, content)
  VALUES (
    onboarding_channel_id,
    agent_id,
    'system',
    'Onboarding task (system-triggered): Please proactively onboard @' || new.display_name || ' in this channel. Default language is English; first ask what language they prefer, then use the captured workspace context before asking for more company details.'
  );

  -- Onboarding Agent welcome message
  INSERT INTO public.messages (channel_id, sender_id, sender_type, content)
  VALUES (
    onboarding_channel_id,
    agent_id,
    'agent',
    E'Hey @' || new.display_name || E', welcome to Scout!\n\nI''m your Onboarding Assistant — I''ll help you get set up here.\n\nBefore we dive in, do you have a preferred language? I''m happy to chat in English, Chinese, or whatever works best for you.'
  );

  RETURN new;
END;
$func$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();
