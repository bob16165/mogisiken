-- 学生ログインIDを「学校名（専門学校を除く）_学生ID」にするための移行

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS login_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_login_id
  ON public.app_users(login_id)
  WHERE login_id IS NOT NULL;