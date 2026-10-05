-- 試験の正答変更、全員加点、採点除外を保存し、結果を一括再集計する移行SQL。

BEGIN;

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS question_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.question_answers_match(actual JSONB, candidate JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  actual_values TEXT[];
  candidate_values TEXT[];
BEGIN
  IF actual IS NULL OR candidate IS NULL THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(actual) = 'array' AND jsonb_typeof(candidate) = 'array' THEN
    SELECT COALESCE(array_agg(value::text ORDER BY value::text), ARRAY[]::TEXT[])
      INTO actual_values
      FROM jsonb_array_elements(actual) AS item(value);
    SELECT COALESCE(array_agg(value::text ORDER BY value::text), ARRAY[]::TEXT[])
      INTO candidate_values
      FROM jsonb_array_elements(candidate) AS item(value);
    RETURN actual_values = candidate_values;
  END IF;

  RETURN actual = candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.question_answers_match(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.question_answers_match(JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.regrade_exam(
  target_exam_id UUID,
  actor_id UUID,
  new_question_overrides JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  exam_row RECORD;
  actor_row RECORD;
  result_row RECORD;
  layout_row JSONB;
  subject_rules JSONB;
  question_rule JSONB;
  question_row JSONB;
  candidate JSONB;
  subject_name TEXT;
  question_number TEXT;
  rule_mode TEXT;
  expected_prefix TEXT;
  range_start INTEGER;
  range_end INTEGER;
  question_index INTEGER;
  question_is_valid BOOLEAN;
  question_is_correct BOOLEAN;
  score_by_subject JSONB;
  updated_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(new_question_overrides) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '採点設定の形式が不正です';
  END IF;

  SELECT id, school_id, question_layout
  INTO exam_row
  FROM public.exams
  WHERE id = target_exam_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の試験が見つかりません';
  END IF;

  SELECT role, school_id
  INTO actor_row
  FROM public.app_users
  WHERE id = actor_id;

  IF NOT FOUND
    OR actor_row.role NOT IN ('teacher', 'admin')
    OR (actor_row.role = 'teacher' AND actor_row.school_id IS DISTINCT FROM exam_row.school_id)
  THEN
    RAISE EXCEPTION 'この試験を再採点する権限がありません';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.student_exam_results
    WHERE exam_id = target_exam_id
      AND jsonb_typeof(question_details) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION '問題ごとの解答データがないため再集計できません';
  END IF;

  FOR subject_name, subject_rules IN
    SELECT key, value FROM jsonb_each(new_question_overrides)
  LOOP
    IF subject_name NOT IN (
      '必修', '解剖学', '生理学', '運動学', '病理学', '衛生学',
      'リハビリ医学', '一般臨床', '外科学', '整形外科', '柔整理論'
    ) OR jsonb_typeof(subject_rules) <> 'object'
    THEN
      RAISE EXCEPTION '科目または採点設定の形式が不正です: %', subject_name;
    END IF;

    FOR question_number, question_rule IN
      SELECT key, value FROM jsonb_each(subject_rules)
    LOOP
      rule_mode := question_rule ->> 'mode';
      IF rule_mode IS NULL OR rule_mode NOT IN ('accepted_answers', 'full_credit', 'excluded') THEN
        RAISE EXCEPTION '問題 % の採点方法が不正です', question_number;
      END IF;

      question_is_valid := false;
      FOR layout_row IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(exam_row.question_layout, '[]'::jsonb))
      LOOP
        IF layout_row ->> 'subject' <> subject_name
          OR COALESCE(layout_row ->> 'start', '') !~ '^[0-9]+$'
          OR COALESCE(layout_row ->> 'end', '') !~ '^[0-9]+$'
        THEN
          CONTINUE;
        END IF;
        range_start := (layout_row ->> 'start')::INTEGER;
        range_end := (layout_row ->> 'end')::INTEGER;
        IF range_start < 1 OR range_end < range_start OR range_end - range_start > 1000 THEN
          CONTINUE;
        END IF;
        expected_prefix := CASE WHEN layout_row ->> 'section' = '後半' THEN 'B' ELSE 'Q' END;
        FOR question_index IN range_start..range_end LOOP
          IF question_number = expected_prefix || question_index::TEXT THEN
            question_is_valid := true;
            EXIT;
          END IF;
        END LOOP;
        EXIT WHEN question_is_valid;
      END LOOP;
      IF NOT question_is_valid THEN
        RAISE EXCEPTION '問題番号 % は試験の問題範囲にありません', question_number;
      END IF;

      IF rule_mode = 'accepted_answers' THEN
        IF jsonb_typeof(question_rule -> 'answers') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION '問題 % の正答を指定してください', question_number;
        END IF;
        IF jsonb_array_length(question_rule -> 'answers') = 0
          OR jsonb_array_length(question_rule -> 'answers') > 20 THEN
          RAISE EXCEPTION '問題 % の正答を指定してください', question_number;
        END IF;
        FOR candidate IN
          SELECT value FROM jsonb_array_elements(question_rule -> 'answers')
        LOOP
          IF jsonb_typeof(candidate) NOT IN ('number', 'string', 'array') THEN
            RAISE EXCEPTION '問題 % の正答の形式が不正です', question_number;
          END IF;
          IF jsonb_typeof(candidate) = 'array' AND (
            jsonb_array_length(candidate) = 0
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(candidate) AS answer(value)
              WHERE jsonb_typeof(answer.value) NOT IN ('number', 'string')
            )
          ) THEN
            RAISE EXCEPTION '問題 % の正答の形式が不正です', question_number;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.exams
  SET question_overrides = new_question_overrides
  WHERE id = target_exam_id;

  FOR result_row IN
    SELECT id, question_details
    FROM public.student_exam_results
    WHERE exam_id = target_exam_id
    FOR UPDATE
  LOOP
    score_by_subject := jsonb_build_object(
      '必修', 0, '解剖学', 0, '生理学', 0, '運動学', 0, '病理学', 0,
      '衛生学', 0, 'リハビリ医学', 0, '一般臨床', 0, '外科学', 0,
      '整形外科', 0, '柔整理論', 0
    );

    FOR subject_name, subject_rules IN
      SELECT key, value FROM jsonb_each(new_question_overrides)
    LOOP
      FOR question_number, question_rule IN
        SELECT key, value FROM jsonb_each(subject_rules)
      LOOP
        IF question_rule ->> 'mode' = 'full_credit' THEN
          score_by_subject := jsonb_set(
            score_by_subject,
            ARRAY[subject_name],
            to_jsonb((score_by_subject ->> subject_name)::INTEGER + 1)
          );
        END IF;
      END LOOP;
    END LOOP;

    FOR subject_name, subject_rules IN
      SELECT key, value FROM jsonb_each(COALESCE(result_row.question_details, '{}'::jsonb))
    LOOP
      IF jsonb_typeof(subject_rules) <> 'array' THEN
        CONTINUE;
      END IF;

      FOR question_row IN SELECT value FROM jsonb_array_elements(subject_rules)
      LOOP
        question_number := question_row ->> 'questionNumber';
        question_rule := new_question_overrides -> subject_name -> question_number;
        rule_mode := question_rule ->> 'mode';

        IF rule_mode IN ('excluded', 'full_credit') THEN
          CONTINUE;
        END IF;

        question_is_correct := false;
        IF rule_mode = 'accepted_answers' THEN
          FOR candidate IN SELECT value FROM jsonb_array_elements(question_rule -> 'answers')
          LOOP
            IF public.question_answers_match(question_row -> 'userAnswer', candidate) THEN
              question_is_correct := true;
              EXIT;
            END IF;
          END LOOP;
        ELSE
          question_is_correct := public.question_answers_match(
            question_row -> 'userAnswer',
            question_row -> 'correctAnswer'
          );
        END IF;

        IF question_is_correct THEN
          score_by_subject := jsonb_set(
            score_by_subject,
            ARRAY[subject_name],
            to_jsonb((score_by_subject ->> subject_name)::INTEGER + 1)
          );
        END IF;
      END LOOP;
    END LOOP;

    UPDATE public.student_exam_results
    SET required_score = (score_by_subject ->> '必修')::INTEGER,
        anatomy_score = (score_by_subject ->> '解剖学')::INTEGER,
        physiology_score = (score_by_subject ->> '生理学')::INTEGER,
        kinesiology_score = (score_by_subject ->> '運動学')::INTEGER,
        pathology_score = (score_by_subject ->> '病理学')::INTEGER,
        hygiene_score = (score_by_subject ->> '衛生学')::INTEGER,
        rehabilitation_score = (score_by_subject ->> 'リハビリ医学')::INTEGER,
        general_clinical_score = (score_by_subject ->> '一般臨床')::INTEGER,
        surgery_score = (score_by_subject ->> '外科学')::INTEGER,
        orthopedics_score = (score_by_subject ->> '整形外科')::INTEGER,
        judo_therapy_score = (score_by_subject ->> '柔整理論')::INTEGER,
        updated_at = NOW()
    WHERE id = result_row.id;
    updated_count := updated_count + 1;
  END LOOP;

  RETURN jsonb_build_object('updatedResults', updated_count);
END;
$$;

REVOKE ALL ON FUNCTION public.regrade_exam(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.regrade_exam(UUID, UUID, JSONB) TO service_role;

COMMIT;
