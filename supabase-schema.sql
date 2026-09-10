-- MogiSiken 商品化向けスキーマ
-- 認証: Supabase Auth (auth.users)
-- 認可: app_users の role / school_id / student_id と各テーブルのRLS
-- AuthユーザーはDashboardまたは管理用Edge Functionから作成する。パスワードはここに保存しない。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE schools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  school_id UUID REFERENCES schools(id) ON DELETE RESTRICT,
  student_id TEXT,
  login_id TEXT,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK ((role = 'student' AND student_id IS NOT NULL AND school_id IS NOT NULL) OR (role = 'teacher' AND school_id IS NOT NULL) OR role = 'admin')
);

CREATE TABLE student_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id TEXT NOT NULL,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  exam_name TEXT NOT NULL,
  question_layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  hide_correct_answer BOOLEAN DEFAULT false NOT NULL,
  is_published BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE student_exam_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  required_score INTEGER DEFAULT 0 NOT NULL,
  anatomy_score INTEGER DEFAULT 0 NOT NULL,
  physiology_score INTEGER DEFAULT 0 NOT NULL,
  kinesiology_score INTEGER DEFAULT 0 NOT NULL,
  pathology_score INTEGER DEFAULT 0 NOT NULL,
  hygiene_score INTEGER DEFAULT 0 NOT NULL,
  rehabilitation_score INTEGER DEFAULT 0 NOT NULL,
  general_clinical_score INTEGER DEFAULT 0 NOT NULL,
  surgery_score INTEGER DEFAULT 0 NOT NULL,
  orthopedics_score INTEGER DEFAULT 0 NOT NULL,
  judo_therapy_score INTEGER DEFAULT 0 NOT NULL,
  question_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(exam_id, student_id)
);

CREATE TABLE source_mapping (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  subject_name TEXT,
  source_number TEXT NOT NULL,
  item_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(school_id, subject_name, source_number)
);

CREATE TABLE student_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  provider TEXT DEFAULT 'local' NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE student_study_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  day_label TEXT NOT NULL,
  subject_name TEXT,
  task_text TEXT NOT NULL,
  is_done BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(student_id, exam_id, task_key)
);

CREATE INDEX idx_app_users_school ON app_users(school_id);
CREATE INDEX idx_results_school_student ON student_exam_results(school_id, student_id);
CREATE INDEX idx_exams_school ON exams(school_id);
CREATE INDEX idx_chat_school_student ON student_chat_messages(school_id, student_id);
CREATE INDEX idx_tasks_school_student ON student_study_tasks(school_id, student_id);

CREATE UNIQUE INDEX uq_app_users_school_student
  ON app_users(school_id, student_id)
  WHERE student_id IS NOT NULL;

CREATE UNIQUE INDEX uq_app_users_login_id
  ON app_users(login_id)
  WHERE login_id IS NOT NULL;

CREATE UNIQUE INDEX uq_student_master_school_student
  ON student_master(school_id, student_id);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_teacher_of(target_school UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role IN ('teacher', 'admin') AND (role = 'admin' OR school_id = target_school));
$$;

CREATE OR REPLACE FUNCTION public.is_student_owner(target_student_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'student' AND student_id = target_student_id);
$$;

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_study_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY schools_read_member ON schools FOR SELECT TO authenticated USING (public.is_teacher_of(id) OR EXISTS (SELECT 1 FROM app_users u WHERE u.id = auth.uid() AND u.school_id = id));
CREATE POLICY app_users_self_or_school_teacher ON app_users FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_teacher_of(school_id));
CREATE POLICY app_users_admin_write ON app_users FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY student_master_read ON student_master FOR SELECT TO authenticated USING (public.is_student_owner(student_id) OR public.is_teacher_of(school_id));
CREATE POLICY student_master_teacher_write ON student_master FOR INSERT TO authenticated WITH CHECK (public.is_teacher_of(school_id));
CREATE POLICY student_master_teacher_update ON student_master FOR UPDATE TO authenticated USING (public.is_teacher_of(school_id)) WITH CHECK (public.is_teacher_of(school_id));
CREATE POLICY student_master_teacher_delete ON student_master FOR DELETE TO authenticated USING (public.is_teacher_of(school_id));
CREATE POLICY exams_read ON exams FOR SELECT TO authenticated USING (public.is_teacher_of(school_id) OR (is_published AND EXISTS (SELECT 1 FROM app_users u WHERE u.id = auth.uid() AND u.role = 'student' AND u.school_id = exams.school_id)));
CREATE POLICY exams_teacher_write ON exams FOR ALL TO authenticated USING (public.is_teacher_of(school_id)) WITH CHECK (public.is_teacher_of(school_id) AND created_by = auth.uid());
CREATE POLICY results_read ON student_exam_results FOR SELECT TO authenticated USING (public.is_student_owner(student_id) OR public.is_teacher_of(school_id));
CREATE POLICY results_teacher_write ON student_exam_results FOR ALL TO authenticated USING (public.is_teacher_of(school_id)) WITH CHECK (public.is_teacher_of(school_id));
CREATE POLICY source_mapping_read ON source_mapping FOR SELECT TO authenticated USING (school_id IS NULL OR public.is_teacher_of(school_id) OR EXISTS (SELECT 1 FROM app_users u WHERE u.id = auth.uid() AND u.school_id = source_mapping.school_id));
CREATE POLICY source_mapping_teacher_write ON source_mapping FOR ALL TO authenticated USING (school_id IS NULL OR public.is_teacher_of(school_id)) WITH CHECK (school_id IS NULL OR public.is_teacher_of(school_id));
CREATE POLICY chat_owner_read ON student_chat_messages FOR SELECT TO authenticated USING (public.is_student_owner(student_id) OR public.is_teacher_of(school_id));
CREATE POLICY chat_owner_insert ON student_chat_messages FOR INSERT TO authenticated WITH CHECK (public.is_student_owner(student_id) AND EXISTS (SELECT 1 FROM app_users u WHERE u.id = auth.uid() AND u.school_id = student_chat_messages.school_id));
CREATE POLICY chat_owner_update ON student_chat_messages FOR UPDATE TO authenticated USING (public.is_student_owner(student_id)) WITH CHECK (public.is_student_owner(student_id));
CREATE POLICY chat_owner_delete ON student_chat_messages FOR DELETE TO authenticated USING (public.is_student_owner(student_id) OR public.is_teacher_of(school_id));
CREATE POLICY task_owner_read ON student_study_tasks FOR SELECT TO authenticated USING (public.is_student_owner(student_id) OR public.is_teacher_of(school_id));
CREATE POLICY task_owner_insert ON student_study_tasks FOR INSERT TO authenticated WITH CHECK (public.is_student_owner(student_id) AND EXISTS (SELECT 1 FROM app_users u WHERE u.id = auth.uid() AND u.school_id = student_study_tasks.school_id));
CREATE POLICY task_owner_update ON student_study_tasks FOR UPDATE TO authenticated USING (public.is_student_owner(student_id)) WITH CHECK (public.is_student_owner(student_id));
CREATE POLICY task_owner_delete ON student_study_tasks FOR DELETE TO authenticated USING (public.is_student_owner(student_id) OR public.is_teacher_of(school_id));

-- 初期アカウントはINSERTしない。Supabase Authでユーザーを作成後、app_usersへ管理者が紐付ける。
