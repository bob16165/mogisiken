DROP POLICY IF EXISTS past_question_students_select ON storage.objects;

CREATE OR REPLACE FUNCTION public.is_past_question_student()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE id = auth.uid()
      AND role = 'student'
  );
$$;

REVOKE ALL ON FUNCTION public.is_past_question_student() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_past_question_student() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_judo_past_question_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users AS app_user
    LEFT JOIN public.schools AS school ON school.id = app_user.school_id
    WHERE app_user.id = auth.uid()
      AND (
        app_user.role = 'student'
        OR (
          app_user.role = 'teacher'
          AND school.qualification_group = 'judo'
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_judo_past_question_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_judo_past_question_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_acupuncture_past_question_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users AS app_user
    JOIN public.schools AS school ON school.id = app_user.school_id
    WHERE app_user.id = auth.uid()
      AND app_user.role IN ('student', 'teacher')
      AND school.qualification_group IN ('acupuncture', 'acupuncture_massage')
  );
$$;

REVOKE ALL ON FUNCTION public.is_acupuncture_past_question_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_acupuncture_past_question_user() TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'past-question-content',
  'past-question-content',
  FALSE,
  10485760,
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY past_question_students_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'past-question-content'
  AND (
    (
      name = 'acupuncture-workbook.xlsx'
      AND public.is_acupuncture_past_question_user()
    )
    OR (
      (name = 'workbook.xlsx' OR name LIKE 'images/%')
      AND public.is_judo_past_question_user()
    )
  )
);
