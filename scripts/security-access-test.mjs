const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'STUDENT_A_EMAIL',
  'STUDENT_A_PASSWORD',
  'STUDENT_A_SCHOOL_ID',
  'STUDENT_A_ID',
  'STUDENT_B_EMAIL',
  'STUDENT_B_PASSWORD',
  'STUDENT_B_SCHOOL_ID',
  'TEACHER_A_EMAIL',
  'TEACHER_A_PASSWORD',
  'TEACHER_A_SCHOOL_ID'
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`環境変数 ${name} が必要です`);
}

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const headers = { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };

async function signIn(email, password) {
  const response = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(`ログイン失敗 (${email}): ${response.status}`);
  return (await response.json()).access_token;
}

async function rest(path, token, options = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const studentA = await signIn(process.env.STUDENT_A_EMAIL, process.env.STUDENT_A_PASSWORD);
const studentB = await signIn(process.env.STUDENT_B_EMAIL, process.env.STUDENT_B_PASSWORD);
const teacherA = await signIn(process.env.TEACHER_A_EMAIL, process.env.TEACHER_A_PASSWORD);

const studentAResults = await rest('student_exam_results?select=student_id,school_id', studentA);
assert(studentAResults.response.ok, '学生Aが成績 API にアクセスできる');
assert((studentAResults.body || []).every(row => row.student_id === process.env.STUDENT_A_ID && row.school_id === process.env.STUDENT_A_SCHOOL_ID), '学生Aは本人かつ所属校の成績だけ取得できる');

const studentBResults = await rest('student_exam_results?select=student_id,school_id', studentB);
assert(studentBResults.response.ok, '学生Bが成績 API にアクセスできる');
assert((studentBResults.body || []).every(row => row.school_id === process.env.STUDENT_B_SCHOOL_ID), '学生Bは別学校の成績を取得できない');

const teacherAResults = await rest('student_exam_results?select=student_id,school_id', teacherA);
assert(teacherAResults.response.ok, '教員Aが成績 API にアクセスできる');
assert((teacherAResults.body || []).every(row => row.school_id === process.env.TEACHER_A_SCHOOL_ID), '教員Aは所属校の成績だけ取得できる');

const crossSchoolChat = await rest('student_chat_messages', studentA, {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    school_id: process.env.STUDENT_B_SCHOOL_ID,
    student_id: process.env.STUDENT_A_ID,
    role: 'user',
    content: 'security-test'
  })
});
assert(!crossSchoolChat.response.ok, '学生Aは別学校としてチャットを登録できない');

const forgedAssistant = await rest('student_chat_messages', studentA, {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    school_id: process.env.STUDENT_A_SCHOOL_ID,
    student_id: process.env.STUDENT_A_ID,
    role: 'assistant',
    content: 'forged assistant message'
  })
});
assert(!forgedAssistant.response.ok, '学生はassistantメッセージを直接登録できない');

const resultFunction = await fetch(`${baseUrl}/functions/v1/student-results`, {
  method: 'POST',
  headers: { ...headers, Authorization: `Bearer ${studentA}` },
  body: JSON.stringify({ schoolId: process.env.STUDENT_A_SCHOOL_ID })
});
assert(resultFunction.ok, '学生結果 Edge Function が利用できる');
const resultText = await resultFunction.text();
assert(!/correctAnswer|correct_answer/.test(resultText), '学生結果レスポンスに正答フィールドが含まれない');

console.log('すべてのアクセス拒否テストに合格しました。');
