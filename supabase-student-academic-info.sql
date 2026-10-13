-- 学生の入学年度・課程年数を登録し、現在の学年を算出するための移行SQL
ALTER TABLE public.student_master
  ADD COLUMN IF NOT EXISTS enrollment_year INTEGER,
  ADD COLUMN IF NOT EXISTS course_years INTEGER;

ALTER TABLE public.student_master
  DROP CONSTRAINT IF EXISTS student_master_course_years_valid,
  ADD CONSTRAINT student_master_course_years_valid
    CHECK (course_years IS NULL OR course_years IN (3, 4)),
  DROP CONSTRAINT IF EXISTS student_master_academic_info_pair,
  ADD CONSTRAINT student_master_academic_info_pair
    CHECK ((enrollment_year IS NULL) = (course_years IS NULL)),
  DROP CONSTRAINT IF EXISTS student_master_enrollment_year_valid,
  ADD CONSTRAINT student_master_enrollment_year_valid
    CHECK (enrollment_year IS NULL OR enrollment_year BETWEEN 1900 AND 2200);
