-- 管理者の機微データアクセスをTOTP MFA (AAL2) 済みセッションに限定する。
-- index-supabase.html の管理者TOTPフローを導入した後、既存DBに適用する。

CREATE OR REPLACE FUNCTION public.is_admin()
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
      AND role = 'admin'
      AND (auth.jwt() ->> 'aal') = 'aal2'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_of(target_school UUID)
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
      AND (
        (role = 'teacher' AND school_id = target_school)
        OR (role = 'admin' AND (auth.jwt() ->> 'aal') = 'aal2')
      )
  );
$$;

-- 以前の管理者学校一覧ポリシーが直接roleを判定している場合もAAL2を要求する。
DROP POLICY IF EXISTS schools_admin_read ON public.schools;
CREATE POLICY schools_admin_read
ON public.schools
FOR SELECT
TO authenticated
USING (public.is_admin());

-- student-results は service_role でRLSを迂回するため、Edge Function側でもAAL2を確認する。
-- 管理者が利用する追加ポリシーも public.is_admin()/public.is_teacher_of() を使用すること。
