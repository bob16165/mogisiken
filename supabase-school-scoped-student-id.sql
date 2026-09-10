-- 学生IDを学校単位で一意にする移行SQL
-- 例: A学校の001とB学校の001を登録可能にします。

-- 既存の全体一意制約を削除します。
ALTER TABLE public.student_master
  DROP CONSTRAINT IF EXISTS student_master_student_id_key;

ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_student_id_key;

-- 同一学校内の重複がある場合は、先に解消してください。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.student_master
    GROUP BY school_id, student_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'student_masterに同一学校・同一学生IDの重複があります';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.app_users
    WHERE student_id IS NOT NULL
    GROUP BY school_id, student_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'app_usersに同一学校・同一学生IDの重複があります';
  END IF;
END $$;

ALTER TABLE public.student_master
  ADD CONSTRAINT student_master_school_student_key
  UNIQUE (school_id, student_id);

ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_school_student_key
  UNIQUE (school_id, student_id);