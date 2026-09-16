import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUBJECTS = [
  ['anatomy_score', '解剖学', 30],
  ['physiology_score', '生理学', 25],
  ['kinesiology_score', '運動学', 10],
  ['pathology_score', '病理学', 13],
  ['hygiene_score', '衛生学', 12],
  ['rehabilitation_score', 'リハビリ医学', 11],
  ['general_clinical_score', '一般臨床', 22],
  ['surgery_score', '外科学', 11],
  ['orthopedics_score', '整形外科', 11],
  ['judo_therapy_score', '柔整理論', 55]
] as const;

const MAX_SCORES = Object.fromEntries(SUBJECTS.map(([, name, max]) => [name, max]));

function isCorrect(userAnswer: unknown, correctAnswer: unknown) {
  if (Array.isArray(userAnswer) && Array.isArray(correctAnswer)) {
    return userAnswer.length === correctAnswer.length &&
      [...userAnswer].sort().every((value, index) => value === [...correctAnswer].sort()[index]);
  }
  return userAnswer === correctAnswer;
}

function deviation(score: number, scores: number[]) {
  if (scores.length === 0) return 50;
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance = scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scores.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation === 0 ? 50 : Math.round((((score - mean) / standardDeviation) * 10 + 50) * 10) / 10;
}

function stats(score: number, maxScore: number, allScores: number[]) {
  const scoreRate = maxScore === 0 ? 0 : Math.round((score / maxScore) * 1000) / 10;
  const rates = allScores.map((value) => maxScore === 0 ? 0 : Math.round((value / maxScore) * 1000) / 10);
  const average = rates.reduce((sum, value) => sum + value, 0) / (rates.length || 1);
  const variance = rates.reduce((sum, value) => sum + (value - average) ** 2, 0) / (rates.length || 1);
  return {
    score,
    maxScore,
    scoreRate,
    rank: [...allScores].sort((a, b) => b - a).findIndex((value) => value === score) + 1,
    deviation: deviation(score, allScores),
    averageScoreRate: Math.round(average * 10) / 10,
    scoreRateStdDev: Math.round(Math.sqrt(variance) * 10) / 10
  };
}

function sanitizeQuestion(question: Record<string, unknown>, exposeAnswers: boolean) {
  if (exposeAnswers) return question;
  const { correctAnswer: _correctAnswer, correctRate: _correctRate, correlWithTotal: _correl, ...safeQuestion } = question;
  return safeQuestion;
}

function computePearsonCorrel(xArr: number[], yArr: number[]) {
  const n = xArr.length;
  if (n < 2 || n !== yArr.length) return null;
  const xMean = xArr.reduce((sum, value) => sum + value, 0) / n;
  const yMean = yArr.reduce((sum, value) => sum + value, 0) / n;
  let num = 0, xVar = 0, yVar = 0;
  for (let i = 0; i < n; i++) {
    const dx = xArr[i] - xMean;
    const dy = yArr[i] - yMean;
    num += dx * dy;
    xVar += dx * dx;
    yVar += dy * dy;
  }
  if (xVar === 0 || yVar === 0) return null;
  return Math.round((num / Math.sqrt(xVar * yVar)) * 1000) / 1000;
}

// 正答率・相関係数はクラス全体（allRows）に対する統計のため、試験単位で一度だけ計算する
function buildQuestionStats(allRows: Record<string, any>[]) {
  const allTotals = allRows.map((item) => Number(item.required_score || 0) + SUBJECTS.reduce((sum, [column]) => sum + Number(item[column] || 0), 0));
  const correctRateMap: Record<string, Record<number, number>> = {};
  const correlMap: Record<string, Record<number, number | null>> = {};

  const subjectNames = new Set<string>();
  allRows.forEach((row) => Object.keys(row.question_details || {}).forEach((subject) => subjectNames.add(subject)));

  subjectNames.forEach((subject) => {
    correctRateMap[subject] = {};
    correlMap[subject] = {};
    const questionNumbers = new Set<number>();
    allRows.forEach((row) => {
      (row.question_details?.[subject] || []).forEach((question: Record<string, unknown>) => {
        questionNumbers.add(Number(question.questionNumber));
      });
    });

    questionNumbers.forEach((questionNumber) => {
      let correctCount = 0;
      let totalCount = 0;
      const pairs: { x: number; y: number }[] = [];

      allRows.forEach((row, index) => {
        const question = (row.question_details?.[subject] || []).find((q: Record<string, unknown>) => Number(q.questionNumber) === questionNumber);
        if (!question) return;
        totalCount += 1;
        const correct = isCorrect(question.userAnswer, question.correctAnswer);
        if (correct) correctCount += 1;
        pairs.push({ x: correct ? 1 : 0, y: allTotals[index] });
      });

      correctRateMap[subject][questionNumber] = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
      correlMap[subject][questionNumber] = pairs.length >= 2
        ? computePearsonCorrel(pairs.map((p) => p.x), pairs.map((p) => p.y))
        : null;
    });
  });

  return { correctRateMap, correlMap };
}

function buildComputed(
  row: Record<string, any>,
  allRows: Record<string, any>[],
  exposeAnswers: boolean,
  questionStats: { correctRateMap: Record<string, Record<number, number>>; correlMap: Record<string, Record<number, number | null>> }
) {
  const subjectScores = SUBJECTS.map(([column]) => Number(row[column] || 0));
  const allTotals = allRows.map((item) => Number(item.required_score || 0) + SUBJECTS.reduce((sum, [column]) => sum + Number(item[column] || 0), 0));
  const totalScore = Number(row.required_score || 0) + subjectScores.reduce((sum, value) => sum + value, 0);
  const allRequired = allRows.map((item) => Number(item.required_score || 0));
  const questionDetails: Record<string, unknown[]> = {};
  const source = row.question_details || {};

  Object.entries(source).forEach(([subject, questions]) => {
    if (!Array.isArray(questions)) return;
    questionDetails[subject] = questions.map((question: Record<string, unknown>) => {
      const questionNumber = Number(question.questionNumber);
      const enriched = {
        ...question,
        correctRate: questionStats.correctRateMap[subject]?.[questionNumber] ?? null,
        correlWithTotal: questionStats.correlMap[subject]?.[questionNumber] ?? null
      };
      return sanitizeQuestion(enriched, exposeAnswers);
    });
  });

  const result: Record<string, any> = {
    studentId: row.student_id,
    studentName: row.student_name,
    totalScore,
    totalMaxScore: 250,
    requiredScore: Number(row.required_score || 0),
    requiredMaxScore: 50,
    generalScore: subjectScores.reduce((sum, value) => sum + value, 0),
    generalMaxScore: 200,
    fourSubjectsScore: Number(row.anatomy_score || 0) + Number(row.physiology_score || 0) + Number(row.general_clinical_score || 0) + Number(row.judo_therapy_score || 0),
    fourSubjectsMaxScore: 132,
    required: stats(Number(row.required_score || 0), 50, allRequired),
    subjects: {},
    totalStats: stats(totalScore, 250, allTotals),
    questionDetails
  };

  const fourScores = allRows.map((item) => Number(item.anatomy_score || 0) + Number(item.physiology_score || 0) + Number(item.general_clinical_score || 0) + Number(item.judo_therapy_score || 0));
  result.fourSubjectsStats = stats(result.fourSubjectsScore, 132, fourScores);

  SUBJECTS.forEach(([column, name, max]) => {
    const values = allRows.map((item) => Number(item[column] || 0));
    result.subjects[name] = stats(Number(row[column] || 0), max, values);
  });

  return result;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('認証が必要です');

    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) throw new Error('認証が必要です');

    const { data: operator, error: operatorError } = await adminClient
      .from('app_users')
      .select('role, school_id, student_id')
      .eq('id', authData.user.id)
      .single();
    if (operatorError || !operator) throw new Error('利用者情報が見つかりません');

    const body = await request.json().catch(() => ({}));
    const requestedSchoolId = operator.role === 'admin' ? body.schoolId : operator.school_id;
    if (operator.role !== 'admin' && !operator.school_id) throw new Error('所属校が設定されていません');

    let examsQuery = adminClient
      .from('exams')
      .select(`
        id, school_id, exam_name, question_layout, hide_correct_answer, is_published, created_at,
        student_exam_results (
          student_id, student_name, school_id, question_details,
          required_score, anatomy_score, physiology_score, kinesiology_score,
          pathology_score, hygiene_score, rehabilitation_score, general_clinical_score,
          surgery_score, orthopedics_score, judo_therapy_score
        )
      `)
      .order('created_at', { ascending: true });

    if (requestedSchoolId) examsQuery = examsQuery.eq('school_id', requestedSchoolId);
    if (operator.role === 'student') examsQuery = examsQuery.eq('is_published', true);

    const { data: exams, error: examsError } = await examsQuery;
    if (examsError) throw examsError;

    const visibleExams = (exams || []).map((exam: any) => {
      const allRows = (exam.student_exam_results || []) as Record<string, any>[];
      const visibleRows = operator.role === 'student'
        ? allRows.filter((row) => row.school_id === operator.school_id && row.student_id === operator.student_id)
        : allRows;
      const exposeAnswers = operator.role !== 'student';
      const questionStats = buildQuestionStats(allRows);
      return {
        id: exam.id,
        school_id: exam.school_id,
        exam_name: exam.exam_name,
        question_layout: exam.question_layout,
        hide_correct_answer: exam.hide_correct_answer,
        is_published: exam.is_published,
        created_at: exam.created_at,
        student_exam_results: visibleRows.map((row) => ({
          ...row,
          question_details: Object.fromEntries(Object.entries(row.question_details || {}).map(([subject, questions]) => [
            subject,
            Array.isArray(questions) ? questions.map((question) => sanitizeQuestion(question as Record<string, unknown>, exposeAnswers)) : []
          ])),
          computed: buildComputed(row, allRows, exposeAnswers, questionStats)
        }))
      };
    });

    return new Response(JSON.stringify({ exams: visibleExams }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
