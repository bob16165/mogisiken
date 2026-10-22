import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// 鍼灸・あん摩の模擬試験。柔整の student-results / import-exam とは独立して動作する。
const QUALIFICATIONS = ['acupuncture', 'massage'];
const GROUP_QUALIFICATIONS: Record<string, string[]> = {
  judo: [],
  acupuncture: ['acupuncture'],
  acupuncture_massage: ['acupuncture', 'massage']
};
const MAX_QUESTIONS = 250;
const MAX_STUDENTS = 600;
const RULES: Record<string, { label: string; excludedSubject: string }[]> = {
  acupuncture: [
    { label: 'はり師', excludedSubject: 'きゅう理論' },
    { label: 'きゅう師', excludedSubject: 'はり理論' }
  ],
  massage: []
};

type TrackData = {
  questions: { section: string; no: number; subject: string; standardNo: number | null; standardName: string; key: number; accepted?: number[]; fullCredit?: boolean }[];
  subjects: string[];
  students: { id: string; name: string }[];
  picks: number[][];
  displayPicks?: number[];
  overrides?: Record<string, { mode: string; answers?: number[] }>;
  regrade?: { questions: TrackData['questions']; overrides: NonNullable<TrackData['overrides']> };
};

const isRightPick = (question: TrackData['questions'][number], pick: number) =>
  Boolean(question.fullCredit) || pick === question.key || Boolean(question.accepted?.includes(pick));

// 保護者には問題単位の詳細(設問・正答)を返さず、全員分の点数だけを返す。氏名・学籍番号も含めない。
function buildParentSummary(qualification: string, track: TrackData, ownIndex: number) {
  const scoresFor = (filter: (question: TrackData['questions'][number]) => boolean) => ({
    max: track.questions.filter(filter).length,
    scores: track.picks.map((row) => track.questions.reduce((total, question, index) => total + (filter(question) && isRightPick(question, row[index]) ? 1 : 0), 0))
  });
  return {
    ownIndex,
    studentCount: track.students.length,
    overall: scoresFor(() => true),
    subjects: track.subjects.map((name) => ({ name, ...scoresFor((question) => question.subject === name) })),
    rules: (RULES[qualification] || []).map((rule) => ({ label: rule.label, ...scoresFor((question) => question.subject !== rule.excludedSubject) }))
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status
  });
}

function validateTrack(value: any): TrackData {
  if (!value || !Array.isArray(value.questions) || !Array.isArray(value.students) || !Array.isArray(value.picks)) {
    throw new Error('試験データが不正です');
  }
  const { questions, students, picks } = value;
  if (questions.length === 0 || questions.length > MAX_QUESTIONS) throw new Error('問題数が不正です');
  if (students.length === 0 || students.length > MAX_STUDENTS) throw new Error('受験者数が不正です');
  if (picks.length !== students.length) throw new Error('解答データの人数が一致しません');
  const cleanQuestions = questions.map((question: any) => {
    const section = question?.section === '後半' ? '後半' : question?.section === '前半' ? '前半' : null;
    const no = Number(question?.no);
    const key = Number(question?.key);
    if (!section || !Number.isInteger(no) || no < 1 || no > (section === '前半' ? 128 : 122)) {
      throw new Error('問題番号が不正です');
    }
    if (!Number.isInteger(key) || key < 1 || key > 4) throw new Error('模範解答が不正です');
    if (!question?.subject || typeof question.subject !== 'string') throw new Error('科目が不正です');
    return {
      section,
      no,
      subject: String(question.subject).slice(0, 60),
      standardNo: Number.isInteger(question.standardNo) ? question.standardNo : null,
      standardName: String(question.standardName || '').slice(0, 200),
      key
    };
  });
  const seenStudents = new Set<string>();
  const cleanStudents = students.map((student: any) => {
    const id = String(student?.id ?? '').trim().slice(0, 40);
    if (!id || seenStudents.has(id)) throw new Error('学籍番号が空か重複しています');
    seenStudents.add(id);
    return { id, name: String(student?.name || '').trim().slice(0, 80) };
  });
  const cleanPicks = picks.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== cleanQuestions.length) throw new Error('解答データの問題数が一致しません');
    return row.map((pick) => {
      const number = Number(pick);
      return Number.isInteger(number) && number >= 0 && number <= 4 ? number : 0;
    });
  });
  return {
    questions: cleanQuestions,
    subjects: [...new Set<string>(cleanQuestions.map((question: { subject: string }) => question.subject))],
    students: cleanStudents,
    picks: cleanPicks
  };
}

const overrideKey = (question: { section: string; no: number }) => `${question.section}${question.no}`;

// 採点訂正: 採点除外は問題ごと取り除く。全員加点・正答候補の追加は問題に印を付け、学生の解答は書き換えない。
function applyOverrides(track: TrackData): TrackData {
  const overrides = track.overrides || {};
  if (Object.keys(overrides).length === 0) return track;
  const keep: number[] = [];
  track.questions.forEach((question, index) => {
    if (overrides[overrideKey(question)]?.mode !== 'excluded') keep.push(index);
  });
  const questions = keep.map((index) => {
    const question = track.questions[index];
    const override = overrides[overrideKey(question)];
    if (override?.mode === 'full_credit') return { ...question, fullCredit: true };
    if (override?.mode === 'accepted_answers') return { ...question, accepted: override.answers || [question.key] };
    return question;
  });
  const picks = track.picks.map((row) => keep.map((index) => row[index]));
  const displayPicks = track.displayPicks ? keep.map((index) => track.displayPicks![index]) : undefined;
  return { ...track, questions, picks, displayPicks, subjects: [...new Set(questions.map((question) => question.subject))] };
}

function cleanOverrides(value: any): NonNullable<TrackData['overrides']> {
  const result: NonNullable<TrackData['overrides']> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, item] of Object.entries(value as Record<string, any>)) {
    const mode = item?.mode;
    if (!/^(前半|後半)\d{1,3}$/.test(key)) throw new Error('採点設定が不正です');
    if (mode === 'full_credit' || mode === 'excluded') result[key] = { mode };
    else if (mode === 'accepted_answers') {
      const answers = (Array.isArray(item.answers) ? item.answers : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 4);
      if (answers.length === 0) throw new Error(`${key} の正答候補を1〜4で入力してください`);
      result[key] = { mode, answers: [...new Set<number>(answers)] };
    } else if (mode !== 'normal') throw new Error('採点設定が不正です');
  }
  return result;
}

// 卒業判定試験: 学生には正答を悟られないよう、設問ごとに選択肢番号をランダムに入れ替えて返す。
// 正誤判定は入れ替え後でも変わらず、自分の実際の解答は displayPicks で別に返す。
function obfuscate(track: TrackData, ownIndex: number): TrackData {
  const perms = track.questions.map(() => {
    const items = [1, 2, 3, 4];
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return [0, ...items];
  });
  return {
    ...track,
    questions: track.questions.map((question, index) => ({
      ...question,
      key: perms[index][question.key],
      accepted: question.accepted?.map((answer) => perms[index][answer])
    })),
    picks: track.picks.map((row) => row.map((pick, index) => perms[index][pick] ?? 0)),
    displayPicks: ownIndex >= 0 ? track.picks[ownIndex] : undefined
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('認証が必要です');
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) throw new Error('認証が必要です');
    const { data: operator, error: operatorError } = await adminClient
      .from('app_users')
      .select('id, role, school_id, student_id')
      .eq('id', authData.user.id)
      .single();
    if (operatorError || !operator) throw new Error('利用者情報が見つかりません');
    if (!['teacher', 'admin', 'student', 'parent'].includes(operator.role)) throw new Error('この操作は利用できません');
    const isTeacherLike = operator.role === 'teacher' || operator.role === 'admin';
    if (operator.role === 'admin') {
      const { data: claimsData, error: claimsError } = await adminClient.auth.getClaims(token);
      if (claimsError || claimsData?.claims?.aal !== 'aal2') throw new Error('管理者の二段階認証が必要です');
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'list');
    const schoolId = operator.role === 'admin' ? body.schoolId : operator.school_id;
    if (!schoolId) throw new Error('学校が指定されていません');

    const { data: school, error: schoolError } = await adminClient
      .from('schools')
      .select('id, qualification_group')
      .eq('id', schoolId)
      .single();
    if (schoolError || !school) throw new Error('学校の資格設定を取得できません');
    const allowed = GROUP_QUALIFICATIONS[school.qualification_group] || [];

    if (action === 'list') {
      const { data: rows, error } = await adminClient
        .from('exams')
        .select('id, exam_name, hide_correct_answer, is_published, created_at, qualification, qualification_exam_data(batch_id, data)')
        .eq('school_id', schoolId)
        .in('qualification', QUALIFICATIONS)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // 教員は全員分、学生は自分の氏名だけを学生マスターから補う
      const names = new Map<string, string>();
      let masterQuery = adminClient.from('student_master').select('student_id, name').eq('school_id', schoolId);
      if (!isTeacherLike) masterQuery = masterQuery.eq('student_id', operator.student_id || '');
      const { data: masters } = await masterQuery;
      (masters || []).forEach((student) => names.set(student.student_id, student.name || ''));

      const batches = new Map<string, any>();
      for (const row of (rows || []) as any[]) {
        const stored = Array.isArray(row.qualification_exam_data) ? row.qualification_exam_data[0] : row.qualification_exam_data;
        if (!stored || !allowed.includes(row.qualification)) continue;
        if (!isTeacherLike && !row.is_published) continue;
        const rawTrack = stored.data as TrackData;
        const track = applyOverrides(rawTrack);
        let ownIndex = -1;
        if (!isTeacherLike) {
          ownIndex = track.students.findIndex((student) => student.id === operator.student_id);
          if (ownIndex < 0) continue;
        }
        let visible: TrackData | Record<string, unknown>;
        if (operator.role === 'parent') {
          visible = { parentSummary: { ...buildParentSummary(row.qualification, track, ownIndex), studentId: track.students[ownIndex].id, studentName: names.get(track.students[ownIndex].id) || track.students[ownIndex].name || '' } };
        } else if (isTeacherLike) {
          visible = {
            ...track,
            students: track.students.map((student) => ({ id: student.id, name: names.get(student.id) || student.name || '' })),
            regrade: { questions: rawTrack.questions, overrides: rawTrack.overrides || {} }
          };
        } else {
          const base: TrackData = {
            ...track,
            overrides: undefined,
            students: track.students.map((student, index) => index === ownIndex
              ? { id: student.id, name: names.get(student.id) || student.name || '' }
              : { id: `#${index + 1}`, name: '' })
          };
          visible = row.hide_correct_answer ? obfuscate(base, ownIndex) : base;
        }
        const entry = batches.get(stored.batch_id) || {
          batchId: stored.batch_id,
          name: row.exam_name,
          hideCorrectAnswer: !!row.hide_correct_answer,
          isPublished: !!row.is_published,
          createdAt: row.created_at,
          tracks: {}
        };
        entry.tracks[row.qualification] = visible;
        batches.set(stored.batch_id, entry);
      }
      return json({ group: school.qualification_group, exams: [...batches.values()] });
    }

    if (!isTeacherLike) throw new Error('教員または管理者権限が必要です');

    if (action === 'save') {
      const examName = String(body.examName || '').trim();
      if (!examName) throw new Error('試験名を入力してください');
      const tracks = body.tracks && typeof body.tracks === 'object' ? body.tracks : {};
      const qualifications = Object.keys(tracks);
      if (qualifications.length === 0) throw new Error('登録する資格がありません');
      for (const qualification of qualifications) {
        if (!QUALIFICATIONS.includes(qualification) || !allowed.includes(qualification)) {
          throw new Error('この学校では選択した資格の試験を登録できません');
        }
      }
      const cleaned = qualifications.map((qualification) => ({ qualification, track: validateTrack(tracks[qualification]) }));
      const batchId = crypto.randomUUID();
      const createdIds: string[] = [];
      try {
        for (const { qualification, track } of cleaned) {
          const { data: exam, error: examError } = await adminClient.from('exams').insert({
            school_id: schoolId,
            qualification,
            created_by: operator.id,
            exam_name: examName,
            question_layout: [],
            hide_correct_answer: !!body.hideCorrectAnswer,
            is_published: !!body.isPublished
          }).select('id').single();
          if (examError || !exam) throw examError || new Error('試験の作成に失敗しました');
          createdIds.push(exam.id);
          const { error: dataError } = await adminClient.from('qualification_exam_data').insert({
            exam_id: exam.id,
            school_id: schoolId,
            batch_id: batchId,
            data: track
          });
          if (dataError) throw dataError;
        }
      } catch (error) {
        if (createdIds.length > 0) await adminClient.from('exams').delete().in('id', createdIds);
        throw error;
      }
      return json({ batchId });
    }

    if (action === 'update' || action === 'delete') {
      const batchId = String(body.batchId || '');
      const { data: members, error: memberError } = await adminClient
        .from('qualification_exam_data')
        .select('exam_id')
        .eq('school_id', schoolId)
        .eq('batch_id', batchId);
      if (memberError) throw memberError;
      const ids = (members || []).map((member) => member.exam_id);
      if (ids.length === 0) throw new Error('試験が見つかりません');
      if (action === 'delete') {
        const { error } = await adminClient.from('exams').delete().in('id', ids).eq('school_id', schoolId);
        if (error) throw error;
      } else {
        const patch: Record<string, boolean> = {};
        if (typeof body.isPublished === 'boolean') patch.is_published = body.isPublished;
        if (typeof body.hideCorrectAnswer === 'boolean') patch.hide_correct_answer = body.hideCorrectAnswer;
        if (Object.keys(patch).length === 0) throw new Error('更新内容がありません');
        const { error } = await adminClient.from('exams').update(patch).in('id', ids).eq('school_id', schoolId);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (action === 'regrade') {
      const batchId = String(body.batchId || '');
      const requested = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
      const { data: members, error: memberError } = await adminClient
        .from('qualification_exam_data')
        .select('exam_id, data')
        .eq('school_id', schoolId)
        .eq('batch_id', batchId);
      if (memberError) throw memberError;
      if (!members || members.length === 0) throw new Error('試験が見つかりません');
      const { data: examRows, error: examError } = await adminClient
        .from('exams')
        .select('id, qualification')
        .in('id', members.map((member) => member.exam_id))
        .eq('school_id', schoolId);
      if (examError) throw examError;
      const qualificationOf = new Map((examRows || []).map((row) => [row.id, row.qualification]));
      let updated = 0;
      for (const member of members) {
        const qualification = qualificationOf.get(member.exam_id);
        if (!qualification || !(qualification in requested)) continue;
        const data = { ...(member.data as TrackData), overrides: cleanOverrides(requested[qualification]) };
        const { error } = await adminClient.from('qualification_exam_data').update({ data }).eq('exam_id', member.exam_id);
        if (error) throw error;
        updated += (member.data as TrackData).students.length;
      }
      return json({ updatedResults: updated });
    }

    throw new Error('不明な操作です');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});
