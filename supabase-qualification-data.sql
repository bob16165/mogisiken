-- 鍼灸・あん摩の模擬試験データ（試験=exams の1行につき1資格分）。
-- 直接参照は禁止し、Edge Function(qualification-exams) 経由でのみ読み書きする。
CREATE TABLE IF NOT EXISTS public.qualification_exam_data (
  exam_id UUID PRIMARY KEY REFERENCES public.exams(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qualification_exam_data_school_idx ON public.qualification_exam_data (school_id);
ALTER TABLE public.qualification_exam_data ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qualification_exam_data FROM anon, authenticated;
