-- 既存のSupabase環境に問題範囲マスターを追加する移行SQL
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS question_layout JSONB NOT NULL DEFAULT '[]'::jsonb;