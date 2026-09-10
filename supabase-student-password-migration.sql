-- 旧student_masterのパスワード列をAuth管理へ移行
-- パスワードはauth.usersで管理し、student_masterには保存しません。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_master'
      AND column_name = 'password'
  ) THEN
    ALTER TABLE public.student_master
      ALTER COLUMN password DROP NOT NULL;
  END IF;
END $$;

-- 学校名付きログインIDを保存する列（例: 東_001）
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS login_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_users_login_id
  ON public.app_users(login_id)
  WHERE login_id IS NOT NULL;
