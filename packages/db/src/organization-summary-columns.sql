-- ============================================================
-- Organization summary columns for compact agent prompt context
-- ============================================================
-- Run this in Supabase SQL Editor for existing Scout databases that were
-- created before organization_summary prompt context was added.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS organization_summary text,
  ADD COLUMN IF NOT EXISTS organization_summary_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS organization_summary_error text;
