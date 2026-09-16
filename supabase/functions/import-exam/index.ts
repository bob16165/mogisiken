import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type Question = {
  questionNumber: number;
  userAnswer: unknown;
  correctAnswer: unknown;
  source?: string;
};

type StudentInput = {
  studentId: string;
  studentName: string;
  questionDetails?: Record<string, Question[]>;
};

const SCORE_COLUMNS: Record<string, string> = {
  '必修': 'required_score',
  '解剖学': 'anatomy_score',
  '生理学': 'physiology_score',
  '運動学': 'kinesiology_score',
  '病理学': 'pathology_score',
  '衛生学': 'hygiene_score',
  'リハビリ医学': 'rehabilitation_score',
  '一般臨床': 'general_clinical_score',
  '外科学': 'surgery_score',
  '整形外科': 'orthopedics_score',
  '柔整理論': 'judo_therapy_score'
};

function answersEqual(left: unknown, right: unknown) {
  if (Array.isArray(left) && Array.isArray(right)) {
    const a = [...left].map(String).sort();
    const b = [...right].map(String).sort();
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return left === right;
}

function calculateScores(student: StudentInput) {
  const scores: Record<string, number> = Object.fromEntries(Object.values(SCORE_COLUMNS).map((column) => [column, 0]));
  Object.entries(student.questionDetails || {}).forEach(([subject, questions]) => {
    const column = SCORE_COLUMNS[subject];
    if (!column || !Array.isArray(questions)) return;
    scores[column] = questions.reduce((count, question) => count + (answersEqual(question.userAnswer, question.correctAnswer) ? 1 : 0), 0);
  });
  return scores;
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
      .select('id, role, school_id')
      .eq('id', authData.user.id)
      .single();
    if (operatorError || !operator || !['teacher', 'admin'].includes(operator.role)) {
      throw new Error('教員または管理者権限が必要です');
    }

    const body = await request.json();
    const schoolId = operator.role === 'admin' ? body.schoolId : operator.school_id;
    const students = body.students as StudentInput[];
    if (!schoolId) throw new Error('学校が指定されていません');
    if (!body.examName || !Array.isArray(students) || students.length === 0) throw new Error('試験データが不正です');

    const { data: exam, error: examError } = await adminClient.from('exams').insert({
      school_id: schoolId,
      created_by: operator.id,
      exam_name: String(body.examName).trim(),
      question_layout: Array.isArray(body.questionLayout) ? body.questionLayout : [],
      hide_correct_answer: !!body.hideCorrectAnswer,
      is_published: !!body.isPublished
    }).select('id, school_id, exam_name, question_layout, hide_correct_answer, is_published, created_at').single();
    if (examError || !exam) throw examError || new Error('試験の作成に失敗しました');

    const rows = students.map((student) => ({
      exam_id: exam.id,
      school_id: schoolId,
      student_id: String(student.studentId).trim(),
      student_name: String(student.studentName || '').trim(),
      question_details: student.questionDetails || {},
      ...calculateScores(student)
    }));
    const { error: resultError } = await adminClient.from('student_exam_results').insert(rows);
    if (resultError) {
      await adminClient.from('exams').delete().eq('id', exam.id);
      throw resultError;
    }

    return new Response(JSON.stringify({ exam, count: rows.length }), {
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
