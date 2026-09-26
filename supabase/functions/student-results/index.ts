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

const DEFAULT_QUESTION_LAYOUT = [
  { section: '前半', start: 1, end: 50, subject: '必修' },
  { section: '前半', start: 51, end: 80, subject: '解剖学' },
  { section: '前半', start: 81, end: 105, subject: '生理学' },
  { section: '前半', start: 106, end: 115, subject: '運動学' },
  { section: '前半', start: 116, end: 128, subject: '病理学' },
  { section: '後半', start: 1, end: 12, subject: '衛生学' },
  { section: '後半', start: 13, end: 23, subject: 'リハビリ医学' },
  { section: '後半', start: 24, end: 45, subject: '一般臨床' },
  { section: '後半', start: 46, end: 56, subject: '外科学' },
  { section: '後半', start: 57, end: 67, subject: '整形外科' },
  { section: '後半', start: 68, end: 122, subject: '柔整理論' }
];
const FOUR_SUBJECTS = ['解剖学', '生理学', '一般臨床', '柔整理論'];

function getQuestionCounts(questionLayout: unknown) {
  const subjectNames = ['必修', ...SUBJECTS.map(([, name]) => name)];
  const counts: Record<string, number> = Object.fromEntries(subjectNames.map((name) => [name, 0]));
  const layout = Array.isArray(questionLayout) && questionLayout.length > 0 ? questionLayout : DEFAULT_QUESTION_LAYOUT;
  layout.forEach((item: any) => {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (Object.prototype.hasOwnProperty.call(counts, item?.subject) && Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      counts[item.subject] += end - start + 1;
    }
  });
  return counts;
}

function scoreForSubject(row: Record<string, any>, subject: string) {
  if (subject === '必修') return Number(row.required_score || 0);
  const column = SUBJECTS.find(([, name]) => name === subject)?.[0];
  return column ? Number(row[column] || 0) : 0;
}

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
// questionNumberはCSVの列名(例: "Q1")が文字列のまま入っているため、Number変換せず文字列キーで突き合わせる
function buildQuestionStats(allRows: Record<string, any>[], questionLayout: unknown) {
  const questionCounts = getQuestionCounts(questionLayout);
  const configuredSubjects = Object.keys(questionCounts).filter((subject) => questionCounts[subject] > 0);
  const allTotals = allRows.map((item) => configuredSubjects.reduce((sum, subject) => sum + scoreForSubject(item, subject), 0));
  const correctRateMap: Record<string, Record<string, number>> = {};
  const correlMap: Record<string, Record<string, number | null>> = {};

  const subjectNames = new Set<string>();
  allRows.forEach((row) => Object.keys(row.question_details || {}).forEach((subject) => subjectNames.add(subject)));

  subjectNames.forEach((subject) => {
    correctRateMap[subject] = {};
    correlMap[subject] = {};
    const questionNumbers = new Set<string>();
    allRows.forEach((row) => {
      (row.question_details?.[subject] || []).forEach((question: Record<string, unknown>) => {
        questionNumbers.add(String(question.questionNumber));
      });
    });

    questionNumbers.forEach((questionNumber) => {
      let correctCount = 0;
      let totalCount = 0;
      const pairs: { x: number; y: number }[] = [];

      allRows.forEach((row, index) => {
        const question = (row.question_details?.[subject] || []).find((q: Record<string, unknown>) => String(q.questionNumber) === questionNumber);
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
  questionStats: { correctRateMap: Record<string, Record<string, number>>; correlMap: Record<string, Record<string, number | null>> },
  questionLayout: unknown
) {
  const questionCounts = getQuestionCounts(questionLayout);
  const configuredSubjects = Object.keys(questionCounts).filter((subject) => questionCounts[subject] > 0);
  const configuredGeneralSubjects = SUBJECTS.map(([, name]) => name).filter((subject) => questionCounts[subject] > 0);
  const allTotals = allRows.map((item) => configuredSubjects.reduce((sum, subject) => sum + scoreForSubject(item, subject), 0));
  const totalScore = configuredSubjects.reduce((sum, subject) => sum + scoreForSubject(row, subject), 0);
  const totalMaxScore = configuredSubjects.reduce((sum, subject) => sum + questionCounts[subject], 0);
  const generalScore = configuredGeneralSubjects.reduce((sum, subject) => sum + scoreForSubject(row, subject), 0);
  const generalMaxScore = configuredGeneralSubjects.reduce((sum, subject) => sum + questionCounts[subject], 0);
  const allRequired = allRows.map((item) => Number(item.required_score || 0));
  const questionDetails: Record<string, unknown[]> = {};
  const source = row.question_details || {};

  Object.entries(source).forEach(([subject, questions]) => {
    if (!Array.isArray(questions)) return;
    questionDetails[subject] = questions.map((question: Record<string, unknown>) => {
      const questionNumber = String(question.questionNumber);
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
    totalMaxScore,
    requiredScore: Number(row.required_score || 0),
    requiredMaxScore: questionCounts['必修'],
    generalScore,
    generalMaxScore,
    fourSubjectsScore: Number(row.anatomy_score || 0) + Number(row.physiology_score || 0) + Number(row.general_clinical_score || 0) + Number(row.judo_therapy_score || 0),
    fourSubjectsMaxScore: FOUR_SUBJECTS.every((subject) => questionCounts[subject] > 0)
      ? FOUR_SUBJECTS.reduce((sum, subject) => sum + questionCounts[subject], 0)
      : 0,
    required: {
      ...stats(Number(row.required_score || 0), questionCounts['必修'], allRequired),
      correlWithTotal: computePearsonCorrel(allRequired, allTotals)
    },
    subjects: {},
    totalStats: stats(totalScore, totalMaxScore, allTotals),
    questionDetails
  };

  const fourScores = allRows.map((item) => FOUR_SUBJECTS.reduce((sum, subject) => sum + scoreForSubject(item, subject), 0));
  result.fourSubjectsStats = FOUR_SUBJECTS.every((subject) => questionCounts[subject] > 0)
    ? stats(result.fourSubjectsScore, result.fourSubjectsMaxScore, fourScores)
    : null;

  SUBJECTS.forEach(([column, name]) => {
    if (questionCounts[name] === 0) return;
    const values = allRows.map((item) => Number(item[column] || 0));
    result.subjects[name] = {
      ...stats(Number(row[column] || 0), questionCounts[name], values),
      correlWithTotal: computePearsonCorrel(values, allTotals)
    };
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
      // 正答を隠すのは卒業判定試験(hide_correct_answer)だけ。通常試験は学生にも正答を返す
      const exposeAnswers = operator.role !== 'student' || !exam.hide_correct_answer;
      const questionStats = buildQuestionStats(allRows, exam.question_layout);
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
          computed: buildComputed(row, allRows, exposeAnswers, questionStats, exam.question_layout)
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
