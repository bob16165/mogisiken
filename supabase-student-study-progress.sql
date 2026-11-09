-- Apply once to the intended Supabase project before deploying the study UI.
-- These tables are separate from student_study_tasks, whose policies allow teachers.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_private_study_owner(owner UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT owner = auth.uid() AND EXISTS (
    SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'student'
  );
$$;

REVOKE ALL ON FUNCTION public.is_private_study_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_private_study_owner(UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.private_study_task_progress (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 160),
  task_key TEXT NOT NULL CHECK (char_length(task_key) BETWEEN 1 AND 160),
  subject TEXT NOT NULL,
  task_text TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, task_key)
);

CREATE TABLE IF NOT EXISTS public.private_past_question_review (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  qualification TEXT NOT NULL CHECK (qualification IN ('judo', 'acupuncture')),
  question_key TEXT NOT NULL CHECK (char_length(question_key) = 64),
  question JSONB NOT NULL CHECK (jsonb_typeof(question) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, qualification, question_key)
);

CREATE TABLE IF NOT EXISTS public.private_past_question_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  qualification TEXT NOT NULL CHECK (qualification IN ('judo', 'acupuncture')),
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.private_study_task_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_study_task_progress FORCE ROW LEVEL SECURITY;
ALTER TABLE public.private_past_question_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_past_question_review FORCE ROW LEVEL SECURITY;
ALTER TABLE public.private_past_question_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_past_question_sets FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.private_study_task_progress, public.private_past_question_review,
  public.private_past_question_sets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_study_task_progress,
  public.private_past_question_review, public.private_past_question_sets TO authenticated;

DROP POLICY IF EXISTS private_student_tasks ON public.private_study_task_progress;
CREATE POLICY private_student_tasks ON public.private_study_task_progress FOR ALL TO authenticated
  USING (public.is_private_study_owner(user_id))
  WITH CHECK (public.is_private_study_owner(user_id));
DROP POLICY IF EXISTS private_student_review ON public.private_past_question_review;
CREATE POLICY private_student_review ON public.private_past_question_review FOR ALL TO authenticated
  USING (public.is_private_study_owner(user_id))
  WITH CHECK (public.is_private_study_owner(user_id));
DROP POLICY IF EXISTS private_student_sets ON public.private_past_question_sets;
CREATE POLICY private_student_sets ON public.private_past_question_sets FOR ALL TO authenticated
  USING (public.is_private_study_owner(user_id))
  WITH CHECK (public.is_private_study_owner(user_id));

COMMIT;
