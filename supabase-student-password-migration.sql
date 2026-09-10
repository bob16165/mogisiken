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
