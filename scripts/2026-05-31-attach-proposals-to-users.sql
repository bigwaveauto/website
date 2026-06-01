-- Attach proposals to user accounts
-- Run in Supabase SQL editor.
--
-- Adds two columns:
--   customer_user_id : FK to auth.users.id — set when admin picks a real user
--                      (or auto-populated by backfill below)
--   customer_email   : the email the proposal is "for" — independent of who
--                      it was actually sent to, so an admin can attach to a
--                      user before they sign up
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + idempotent backfill.

ALTER TABLE public.vehicle_proposals
  ADD COLUMN IF NOT EXISTS customer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_email   text;

CREATE INDEX IF NOT EXISTS vehicle_proposals_customer_user_id_idx
  ON public.vehicle_proposals (customer_user_id);
CREATE INDEX IF NOT EXISTS vehicle_proposals_customer_email_lower_idx
  ON public.vehicle_proposals (lower(customer_email));

-- Backfill: any proposal with sent_to that looks like an email AND matches
-- an existing auth.users.email gets linked to that user.
UPDATE public.vehicle_proposals p
SET
  customer_user_id = u.id,
  customer_email   = COALESCE(p.customer_email, lower(u.email))
FROM auth.users u
WHERE p.customer_user_id IS NULL
  AND p.sent_to IS NOT NULL
  AND p.sent_to LIKE '%@%'
  AND lower(p.sent_to) = lower(u.email);

-- Also backfill customer_email from sent_to where we have an email but no user match,
-- so the GET /api/customer/proposals OR clause (user_id OR email) still works after signup.
UPDATE public.vehicle_proposals
SET customer_email = lower(sent_to)
WHERE customer_email IS NULL
  AND sent_to IS NOT NULL
  AND sent_to LIKE '%@%';

-- Helper RPC: the auth schema isn't exposed via PostgREST, so the Node server
-- can't query auth.users directly. This SECURITY DEFINER function lets it look
-- up a user id by email. Safe because it only returns the id (no email/metadata
-- leak) and only the service role can call it.
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;

-- When a new user signs up, auto-link any pending proposals where
-- customer_email matches their email. Triggered after auth.users insert.
CREATE OR REPLACE FUNCTION public.link_proposals_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.vehicle_proposals
  SET customer_user_id = NEW.id
  WHERE customer_user_id IS NULL
    AND customer_email IS NOT NULL
    AND lower(customer_email) = lower(NEW.email);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS link_proposals_on_signup_trg ON auth.users;
CREATE TRIGGER link_proposals_on_signup_trg
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_proposals_on_signup();
