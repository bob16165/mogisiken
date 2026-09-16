-- 既存の本番DBへ適用するRLS強化用SQL
-- 注意: supabase-schema.sql は新規DBの初回構築用です。
-- 既存DBではこちらだけを実行し、テーブルや既存データを再作成しません。

ALTER TABLE IF EXISTS public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.source_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_study_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.schools FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_users FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_master FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.exams FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_exam_results FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.source_mapping FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.student_study_tasks FORCE ROW LEVEL SECURITY;

-- 古いバージョンで作成されたテーブルにschool_id列が無い場合を補う
ALTER TABLE IF EXISTS public.source_mapping
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS public.student_chat_messages
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;
ALTER TABLE IF EXISTS public.student_study_tasks
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

-- exam_id経由でschool_idが未設定の既存行を補完する（chat/taskはexam_idからexams.school_idを引ける）
UPDATE public.student_chat_messages c
SET school_id = e.school_id
FROM public.exams e
WHERE c.exam_id = e.id
  AND c.school_id IS NULL;

UPDATE public.student_study_tasks t
SET school_id = e.school_id
FROM public.exams e
WHERE t.exam_id = e.id
  AND t.school_id IS NULL;

-- exam_idが無い/紐付かなかった残りを、学籍番号が学校間で重複しない前提でstudent_masterから補完する
UPDATE public.student_chat_messages c
SET school_id = sm.school_id
FROM public.student_master sm
WHERE c.school_id IS NULL
  AND c.student_id = sm.student_id
  AND (SELECT COUNT(*) FROM public.student_master sm2 WHERE sm2.student_id = c.student_id) = 1;

UPDATE public.student_study_tasks t
SET school_id = sm.school_id
FROM public.student_master sm
WHERE t.school_id IS NULL
  AND t.student_id = sm.student_id
  AND (SELECT COUNT(*) FROM public.student_master sm2 WHERE sm2.student_id = t.student_id) = 1;

-- 補完できずschool_idがNULLのまま残っている行数を確認する（0でなければ手動確認が必要）
SELECT
  (SELECT COUNT(*) FROM public.student_chat_messages WHERE school_id IS NULL) AS chat_still_null,
  (SELECT COUNT(*) FROM public.student_study_tasks WHERE school_id IS NULL) AS task_still_null;

DROP POLICY IF EXISTS student_master_read ON public.student_master;
DROP POLICY IF EXISTS results_read ON public.student_exam_results;
DROP POLICY IF EXISTS chat_owner_read ON public.student_chat_messages;
DROP POLICY IF EXISTS chat_owner_insert ON public.student_chat_messages;
DROP POLICY IF EXISTS chat_owner_user_insert ON public.student_chat_messages;
DROP POLICY IF EXISTS chat_owner_update ON public.student_chat_messages;
DROP POLICY IF EXISTS chat_owner_user_update ON public.student_chat_messages;
DROP POLICY IF EXISTS chat_owner_delete ON public.student_chat_messages;
DROP POLICY IF EXISTS task_owner_read ON public.student_study_tasks;
DROP POLICY IF EXISTS task_owner_insert ON public.student_study_tasks;
DROP POLICY IF EXISTS task_owner_update ON public.student_study_tasks;
DROP POLICY IF EXISTS task_owner_delete ON public.student_study_tasks;
DROP FUNCTION IF EXISTS public.is_student_owner(TEXT);

-- 既存DBに認可関数がない場合も、この移行SQLだけで作成できるようにする。
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
    WHERE id = auth.uid() AND role = 'admin'
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
      AND role IN ('teacher', 'admin')
      AND (role = 'admin' OR school_id = target_school)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_student_owner(target_school UUID, target_student_id TEXT)
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
      AND role = 'student'
      AND school_id = target_school
      AND student_id = target_student_id
  );
$$;

REVOKE ALL ON TABLE public.schools, public.app_users, public.student_master,
  public.exams, public.student_exam_results, public.source_mapping,
  public.student_chat_messages, public.student_study_tasks FROM anon;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_teacher_of(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_student_owner(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_teacher_of(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_student_owner(UUID, TEXT) TO authenticated, service_role;

CREATE POLICY student_master_read ON public.student_master FOR SELECT TO authenticated
  USING (public.is_student_owner(school_id, student_id) OR public.is_teacher_of(school_id));
CREATE POLICY results_read ON public.student_exam_results FOR SELECT TO authenticated
  USING (public.is_student_owner(school_id, student_id) OR public.is_teacher_of(school_id));
CREATE POLICY chat_owner_read ON public.student_chat_messages FOR SELECT TO authenticated
  USING (public.is_student_owner(school_id, student_id) OR public.is_teacher_of(school_id));
CREATE POLICY chat_owner_user_insert ON public.student_chat_messages FOR INSERT TO authenticated
  WITH CHECK (role = 'user' AND public.is_student_owner(school_id, student_id));
CREATE POLICY chat_owner_user_update ON public.student_chat_messages FOR UPDATE TO authenticated
  USING (role = 'user' AND public.is_student_owner(school_id, student_id))
  WITH CHECK (role = 'user' AND public.is_student_owner(school_id, student_id));
CREATE POLICY chat_owner_delete ON public.student_chat_messages FOR DELETE TO authenticated
  USING (public.is_student_owner(school_id, student_id) OR public.is_teacher_of(school_id));
CREATE POLICY task_owner_read ON public.student_study_tasks FOR SELECT TO authenticated
  USING (public.is_student_owner(school_id, student_id) OR public.is_teacher_of(school_id));
CREATE POLICY task_owner_insert ON public.student_study_tasks FOR INSERT TO authenticated
  WITH CHECK (public.is_student_owner(school_id, student_id));
CREATE POLICY task_owner_update ON public.student_study_tasks FOR UPDATE TO authenticated
  USING (public.is_student_owner(school_id, student_id))
  WITH CHECK (public.is_student_owner(school_id, student_id));
CREATE POLICY task_owner_delete ON public.student_study_tasks FOR DELETE TO authenticated
  USING (public.is_student_owner(school_id, student_id) OR public.is_teacher_of(school_id));

-- 適用確認
SELECT
  tables.schemaname,
  tables.tablename,
  tables.rowsecurity,
  classes.relforcerowsecurity AS force_row_level_security
FROM pg_tables AS tables
JOIN pg_class AS classes
  ON classes.relname = tables.tablename
JOIN pg_namespace AS namespaces
  ON namespaces.oid = classes.relnamespace
 AND namespaces.nspname = tables.schemaname
WHERE tables.schemaname = 'public'
  AND tables.tablename IN (
    'schools', 'app_users', 'student_master', 'exams',
    'student_exam_results', 'source_mapping',
    'student_chat_messages', 'student_study_tasks'
  )
ORDER BY tables.tablename;
