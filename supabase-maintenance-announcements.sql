-- 停止予定のお知らせとユーザーごとの既読状態（既存DB向け移行）

CREATE TABLE IF NOT EXISTS public.maintenance_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_by UUID NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT maintenance_announcements_valid_period CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.maintenance_announcement_reads (
  announcement_id UUID NOT NULL REFERENCES public.maintenance_announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

ALTER TABLE public.maintenance_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_announcements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_announcement_reads FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.maintenance_announcements,
  public.maintenance_announcement_reads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.maintenance_announcements TO authenticated;
GRANT SELECT, INSERT ON TABLE public.maintenance_announcement_reads TO authenticated;

CREATE OR REPLACE FUNCTION public.can_receive_maintenance_notices()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE id = auth.uid()
      AND role IN ('student', 'teacher')
  );
$$;

REVOKE ALL ON FUNCTION public.can_receive_maintenance_notices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_receive_maintenance_notices() TO authenticated, service_role;

DROP POLICY IF EXISTS maintenance_announcements_admin_manage ON public.maintenance_announcements;
CREATE POLICY maintenance_announcements_admin_manage
ON public.maintenance_announcements
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS maintenance_announcements_recipient_read ON public.maintenance_announcements;
CREATE POLICY maintenance_announcements_recipient_read
ON public.maintenance_announcements
FOR SELECT
TO authenticated
USING (
  public.can_receive_maintenance_notices()
  AND ends_at > NOW()
);

DROP POLICY IF EXISTS maintenance_announcement_reads_owner_read ON public.maintenance_announcement_reads;
CREATE POLICY maintenance_announcement_reads_owner_read
ON public.maintenance_announcement_reads
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS maintenance_announcement_reads_owner_insert ON public.maintenance_announcement_reads;
CREATE POLICY maintenance_announcement_reads_owner_insert
ON public.maintenance_announcement_reads
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.can_receive_maintenance_notices()
);
