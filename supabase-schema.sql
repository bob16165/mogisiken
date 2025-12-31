-- 学生マスタテーブル
CREATE TABLE student_master (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 試験テーブル
CREATE TABLE exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_name TEXT NOT NULL,
  hide_correct_answer BOOLEAN DEFAULT false, -- 卒業判定試験フラグ
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 学生試験結果テーブル
CREATE TABLE student_exam_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  required_score INTEGER DEFAULT 0,
  anatomy_score INTEGER DEFAULT 0, -- 解剖学
  physiology_score INTEGER DEFAULT 0, -- 生理学
  kinesiology_score INTEGER DEFAULT 0, -- 運動学
  pathology_score INTEGER DEFAULT 0, -- 病理学
  hygiene_score INTEGER DEFAULT 0, -- 衛生学
  rehabilitation_score INTEGER DEFAULT 0, -- リハビリ医学
  general_clinical_score INTEGER DEFAULT 0, -- 一般臨床
  surgery_score INTEGER DEFAULT 0, -- 外科学
  orthopedics_score INTEGER DEFAULT 0, -- 整形外科
  judo_therapy_score INTEGER DEFAULT 0, -- 柔整理論
  question_details JSONB, -- 問題詳細データ
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(exam_id, student_id)
);

-- 出典マッピングテーブル
CREATE TABLE source_mapping (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  subject_name TEXT, -- null = 全科目共通
  source_number TEXT NOT NULL,
  item_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(subject_name, source_number)
);

-- 教員アカウントテーブル
CREATE TABLE teachers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- デフォルト教員アカウント追加
INSERT INTO teachers (username, password, name) VALUES
  ('teacher001', 'teacher123', '教員'),
  ('admin', 'admin123', '管理者');

-- インデックス作成
CREATE INDEX idx_student_exam_results_exam_id ON student_exam_results(exam_id);
CREATE INDEX idx_student_exam_results_student_id ON student_exam_results(student_id);
CREATE INDEX idx_source_mapping_subject ON source_mapping(subject_name);

-- Row Level Security (RLS) を有効化
ALTER TABLE student_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- 全員が読み取り可能なポリシー（認証不要版）
CREATE POLICY "Enable read access for all users" ON student_master FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON exams FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON student_exam_results FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON source_mapping FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON teachers FOR SELECT USING (true);

-- 全員が書き込み可能なポリシー（認証不要版 - 本番では変更推奨）
CREATE POLICY "Enable insert for all users" ON student_master FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable insert for all users" ON exams FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable insert for all users" ON student_exam_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable insert for all users" ON source_mapping FOR INSERT WITH CHECK (true);

-- 更新・削除も許可
CREATE POLICY "Enable update for all users" ON student_master FOR UPDATE USING (true);
CREATE POLICY "Enable update for all users" ON exams FOR UPDATE USING (true);
CREATE POLICY "Enable update for all users" ON student_exam_results FOR UPDATE USING (true);
CREATE POLICY "Enable update for all users" ON source_mapping FOR UPDATE USING (true);

CREATE POLICY "Enable delete for all users" ON exams FOR DELETE USING (true);
CREATE POLICY "Enable delete for all users" ON student_exam_results FOR DELETE USING (true);
CREATE POLICY "Enable delete for all users" ON source_mapping FOR DELETE USING (true);
