-- 鍼灸・あん摩マッサージ指圧師対応 段階1: 学科グループ（資格設定）と試験の資格を追加する。
-- 既存データは既定値 'judo' になり、柔整の動作は変わらない。何度実行しても安全。
-- 学校（学科）ごとに許可する資格を決め、試験登録時にサーバー側で検証する。
--   judo                 : 柔道整復師のみ
--   acupuncture          : 鍼灸のみ（はり師・きゅう師）
--   acupuncture_massage  : 鍼灸 + あん摩マッサージ指圧師（同じグループで管理）

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS qualification_group TEXT NOT NULL DEFAULT 'judo';

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS qualification TEXT NOT NULL DEFAULT 'judo';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schools_qualification_group_valid') THEN
    ALTER TABLE schools ADD CONSTRAINT schools_qualification_group_valid
      CHECK (qualification_group IN ('judo', 'acupuncture', 'acupuncture_massage'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exams_qualification_valid') THEN
    ALTER TABLE exams ADD CONSTRAINT exams_qualification_valid
      CHECK (qualification IN ('judo', 'acupuncture', 'massage'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_exam_qualification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  school_group TEXT;
BEGIN
  SELECT qualification_group INTO school_group FROM schools WHERE id = NEW.school_id;
  IF NOT (
    (school_group = 'judo' AND NEW.qualification = 'judo') OR
    (school_group = 'acupuncture' AND NEW.qualification = 'acupuncture') OR
    (school_group = 'acupuncture_massage' AND NEW.qualification IN ('acupuncture', 'massage'))
  ) THEN
    RAISE EXCEPTION 'この学校では資格 % の試験を登録できません', NEW.qualification;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exams_enforce_qualification ON exams;
CREATE TRIGGER exams_enforce_qualification
  BEFORE INSERT OR UPDATE OF school_id, qualification ON exams
  FOR EACH ROW EXECUTE FUNCTION public.enforce_exam_qualification();

-- 学科グループの設定例（学校IDは実際の値に置き換えて実行する）
-- UPDATE schools SET qualification_group = 'acupuncture_massage' WHERE id = '<学校ID>';
