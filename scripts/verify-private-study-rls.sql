-- SQL Editor: run the complete statement after supabase-student-study-progress.sql.
-- Requires at least two student accounts and one teacher in app_users.
-- The test inserts are rolled back before the statement completes.
DO $$
DECLARE
  student_a UUID;
  student_b UUID;
  teacher UUID;
  other_id UUID;
  test_scope TEXT := 'rls-test-' || gen_random_uuid()::text;
  test_question_key TEXT := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  test_set_id UUID := gen_random_uuid();
  affected INTEGER;
  blocked BOOLEAN;
BEGIN
  SELECT id INTO student_a FROM public.app_users WHERE role = 'student' ORDER BY id LIMIT 1;
  SELECT id INTO student_b FROM public.app_users WHERE role = 'student' ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO teacher FROM public.app_users WHERE role = 'teacher' ORDER BY id LIMIT 1;
  IF student_a IS NULL OR student_b IS NULL OR teacher IS NULL THEN
    RAISE EXCEPTION 'テストには学生2名と教員1名のアカウントが必要です。';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claim.sub', student_a::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', student_a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    INSERT INTO public.private_study_task_progress (user_id, scope, task_key, subject, task_text)
    VALUES (student_a, test_scope, 'test', 'test', 'test');
    INSERT INTO public.private_past_question_review (user_id, qualification, question_key, question)
    VALUES (student_a, 'judo', test_question_key, '{"test": true}'::jsonb);
    INSERT INTO public.private_past_question_sets (id, user_id, qualification, questions)
    VALUES (test_set_id, student_a, 'judo', '[{"test": true}]'::jsonb);

    IF (SELECT count(*) FROM public.private_study_task_progress WHERE user_id = student_a AND scope = test_scope) <> 1
      OR (SELECT count(*) FROM public.private_past_question_review WHERE user_id = student_a AND question_key = test_question_key) <> 1
      OR (SELECT count(*) FROM public.private_past_question_sets WHERE id = test_set_id) <> 1 THEN
      RAISE EXCEPTION '学生本人がデータを読み取れません。';
    END IF;

    FOREACH other_id IN ARRAY ARRAY[student_b, teacher] LOOP
      PERFORM set_config('request.jwt.claim.sub', other_id::text, true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
      IF EXISTS (SELECT 1 FROM public.private_study_task_progress WHERE user_id = student_a AND scope = test_scope)
        OR EXISTS (SELECT 1 FROM public.private_past_question_review WHERE user_id = student_a AND question_key = test_question_key)
        OR EXISTS (SELECT 1 FROM public.private_past_question_sets WHERE id = test_set_id) THEN
        RAISE EXCEPTION '別の学生または教員が本人のデータを読み取れます。';
      END IF;

      UPDATE public.private_study_task_progress SET is_done = true WHERE user_id = student_a AND scope = test_scope;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION '本人以外が課題を更新できます。'; END IF;
      DELETE FROM public.private_past_question_review WHERE user_id = student_a AND question_key = test_question_key;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION '本人以外が復習データを削除できます。'; END IF;
      DELETE FROM public.private_past_question_sets WHERE id = test_set_id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 0 THEN RAISE EXCEPTION '本人以外が問題セットを削除できます。'; END IF;

      blocked := false;
      BEGIN
        INSERT INTO public.private_study_task_progress (user_id, scope, task_key, subject, task_text)
        VALUES (student_a, test_scope || '-forged', 'test', 'test', 'test');
      EXCEPTION WHEN insufficient_privilege THEN blocked := true;
      END;
      IF NOT blocked THEN RAISE EXCEPTION '本人以外が課題を登録できます。'; END IF;
      blocked := false;
      BEGIN
        INSERT INTO public.private_past_question_review (user_id, qualification, question_key, question)
        VALUES (student_a, 'judo', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text), '{}'::jsonb);
      EXCEPTION WHEN insufficient_privilege THEN blocked := true;
      END;
      IF NOT blocked THEN RAISE EXCEPTION '本人以外が復習データを登録できます。'; END IF;
      blocked := false;
      BEGIN
        INSERT INTO public.private_past_question_sets (user_id, qualification, questions)
        VALUES (student_a, 'judo', '[{}]'::jsonb);
      EXCEPTION WHEN insufficient_privilege THEN blocked := true;
      END;
      IF NOT blocked THEN RAISE EXCEPTION '本人以外が問題セットを登録できます。'; END IF;
    END LOOP;

    RAISE SQLSTATE 'P0002' USING MESSAGE = 'rollback test data';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    RAISE NOTICE '学生本人の読み書き、他の学生・教員からのアクセス拒否を確認しました。テストデータはロールバックされました。';
  END;
END;
$$;
