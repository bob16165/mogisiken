-- 追加機能用パッチ: 対話履歴 + 学習課題進捗
-- 既存環境でも安全に実行できるよう IF NOT EXISTS を使用

CREATE TABLE IF NOT EXISTS student_chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  student_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  provider TEXT DEFAULT 'local',
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS student_study_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE NOT NULL,
  student_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  day_label TEXT NOT NULL,
  subject_name TEXT,
  task_text TEXT NOT NULL,
  is_done BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(student_id, exam_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_student_chat_messages_student ON student_chat_messages(student_id);
CREATE INDEX IF NOT EXISTS idx_student_study_tasks_student ON student_study_tasks(student_id);

ALTER TABLE student_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_study_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON student_chat_messages;
CREATE POLICY "Enable read access for all users" ON student_chat_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert for all users" ON student_chat_messages;
CREATE POLICY "Enable insert for all users" ON student_chat_messages FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all users" ON student_chat_messages;
CREATE POLICY "Enable update for all users" ON student_chat_messages FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON student_chat_messages;
CREATE POLICY "Enable delete for all users" ON student_chat_messages FOR DELETE USING (true);

DROP POLICY IF EXISTS "Enable read access for all users" ON student_study_tasks;
CREATE POLICY "Enable read access for all users" ON student_study_tasks FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert for all users" ON student_study_tasks;
CREATE POLICY "Enable insert for all users" ON student_study_tasks FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for all users" ON student_study_tasks;
CREATE POLICY "Enable update for all users" ON student_study_tasks FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for all users" ON student_study_tasks;
CREATE POLICY "Enable delete for all users" ON student_study_tasks FOR DELETE USING (true);

-- 動作確認
SELECT to_regclass('public.student_chat_messages') AS student_chat_messages_exists;
SELECT to_regclass('public.student_study_tasks') AS student_study_tasks_exists;
