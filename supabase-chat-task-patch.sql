-- 追加機能用パッチ
-- 注意: 商品化環境では先に supabase-schema.sql を適用してください。
-- このパッチはテーブルの作成だけを行い、RLSポリシーは本体スキーマで管理します。

CREATE TABLE IF NOT EXISTS student_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  provider TEXT DEFAULT 'local' NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS student_study_tasks (
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

CREATE INDEX IF NOT EXISTS idx_student_chat_messages_school_student ON student_chat_messages(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_study_tasks_school_student ON student_study_tasks(school_id, student_id);

ALTER TABLE student_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_study_tasks ENABLE ROW LEVEL SECURITY;

-- ポリシーは supabase-schema.sql の chat_owner_* / task_owner_* を再利用する。
-- このファイルには USING (true) / WITH CHECK (true) を置かない。
