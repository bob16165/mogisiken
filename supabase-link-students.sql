-- 既存の学生マスターとAuthユーザーをapp_usersへ一括紐付け
-- Authのメール形式: 学籍番号@mogisiken.local

WITH matched AS (
  SELECT
    u.id AS auth_id,
    sm.student_id,
    sm.school_id,
    sm.name
  FROM auth.users u
  JOIN public.student_master sm
    ON lower(u.email) = lower(sm.student_id || '@mogisiken.local')
)
UPDATE public.app_users app
SET
  role = 'student',
  school_id = matched.school_id,
  student_id = matched.student_id,
  display_name = matched.name
FROM matched
WHERE app.id = matched.auth_id;

WITH matched AS (
  SELECT
    u.id AS auth_id,
    sm.student_id,
    sm.school_id,
    sm.name
  FROM auth.users u
  JOIN public.student_master sm
    ON lower(u.email) = lower(sm.student_id || '@mogisiken.local')
)
INSERT INTO public.app_users (id, role, school_id, student_id, display_name)
SELECT matched.auth_id, 'student', matched.school_id, matched.student_id, matched.name
FROM matched
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_users app WHERE app.id = matched.auth_id
)
AND NOT EXISTS (
  SELECT 1 FROM public.app_users app WHERE app.student_id = matched.student_id
);

-- 紐付け結果
SELECT
  u.email,
  app.role,
  app.student_id,
  app.school_id,
  app.display_name
FROM auth.users u
JOIN public.app_users app ON app.id = u.id
WHERE app.role = 'student'
ORDER BY app.student_id;
