-- 既存の学生データを東専門学校へ一括移行
-- 対象: 学生マスターと学生アカウントのみ
-- 教員・管理者の所属学校は変更しません。

DO $$
DECLARE
  target_school_id UUID;
BEGIN
  SELECT id INTO target_school_id
  FROM public.schools
  WHERE name = '東専門学校'
  ORDER BY created_at
  LIMIT 1;

  IF target_school_id IS NULL THEN
    RAISE EXCEPTION '東専門学校がpublic.schoolsに見つかりません';
  END IF;

  UPDATE public.student_master
  SET school_id = target_school_id,
      updated_at = NOW();

  UPDATE public.app_users
  SET school_id = target_school_id
  WHERE role = 'student';

  RAISE NOTICE '東専門学校へ移行しました: %', target_school_id;
END $$;

-- 移行結果の確認
SELECT
  'student_master' AS source,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE school_id = schools.id) AS higashi_count
FROM public.student_master
CROSS JOIN (
  SELECT id FROM public.schools WHERE name = '東専門学校' ORDER BY created_at LIMIT 1
) schools
UNION ALL
SELECT
  'app_users(student)' AS source,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE school_id = schools.id) AS higashi_count
FROM public.app_users
CROSS JOIN (
  SELECT id FROM public.schools WHERE name = '東専門学校' ORDER BY created_at LIMIT 1
) schools
WHERE role = 'student';
