-- 保護者アカウント（role = 'parent'）を追加する移行SQL。
-- 保護者は子（学生）の student_id / school_id に紐付く。DBへ直接アクセスする権限は持たず、
-- 成績は Edge Function（student-results）経由でのみ取得する（is_student_owner / exams_read は role = 'student' 限定のため）。

-- 古いバージョンで作成された source_mapping には school_id 列が無いことがあるため補う（NULLは全校共通扱い）
ALTER TABLE IF EXISTS public.source_mapping
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_role_check CHECK (role IN ('student', 'parent', 'teacher', 'admin'));

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.app_users'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%student_id IS NOT NULL%'
  LOOP
    EXECUTE format('ALTER TABLE public.app_users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_role_scope_check CHECK (
    (role IN ('student', 'parent') AND student_id IS NOT NULL AND school_id IS NOT NULL)
    OR (role = 'teacher' AND school_id IS NOT NULL)
    OR role = 'admin'
  );

-- (school_id, student_id) の一意制約は学生と保護者で共有できないため、役割ごとの一意インデックスに置き換える
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_school_student_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_student_per_school
  ON public.app_users (school_id, student_id) WHERE role = 'student';
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_parent_per_student
  ON public.app_users (school_id, student_id) WHERE role = 'parent';

-- ===== 保護者ロールのRLS =====
-- 保護者は成績・名簿・チャット・課題・お知らせの各テーブルに直接アクセスできない。
--   exams_read / results_read / student_master_read / chat_* / task_* は
--   is_teacher_of（教員・管理者）または is_student_owner / role = 'student'（学生）だけを許可しており、
--   role = 'parent' は一致しないため全て拒否される。成績は Edge Function が保護者本人の
--   子（school_id + student_id）の公開済み試験だけを返す。
-- 一方、次の2テーブルは「同じ学校の利用者なら誰でも読める」ため保護者にも開いてしまうので、
-- 保護者を除外する。

DROP POLICY IF EXISTS schools_read_member ON public.schools;
CREATE POLICY schools_read_member ON public.schools FOR SELECT TO authenticated
USING (
  public.is_teacher_of(id)
  OR EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = auth.uid() AND u.role = 'student' AND u.school_id = schools.id
  )
);

DROP POLICY IF EXISTS source_mapping_read ON public.source_mapping;
CREATE POLICY source_mapping_read ON public.source_mapping FOR SELECT TO authenticated
USING (
  public.is_teacher_of(school_id)
  OR EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = auth.uid() AND u.role = 'student'
      AND (source_mapping.school_id IS NULL OR u.school_id = source_mapping.school_id)
  )
);

-- 保護者が自分の app_users 行を読めること（ログイン時のプロフィール取得）は
-- app_users_self_or_school_teacher の「id = auth.uid()」で許可される。書き込みは管理者のみ。
