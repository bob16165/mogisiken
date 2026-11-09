import { randomBytes, randomUUID } from 'node:crypto';

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'STUDENT_A_EMAIL', 'STUDENT_A_PASSWORD',
  'STUDENT_B_EMAIL', 'STUDENT_B_PASSWORD', 'TEACHER_A_EMAIL', 'TEACHER_A_PASSWORD'];
for (const name of required) {
  if (!process.env[name]) throw new Error(`環境変数 ${name} が必要です`);
}

const base = process.env.SUPABASE_URL.replace(/\/$/, '');
const headers = { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
async function request(path, token, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null };
}
async function signIn(prefix) {
  const result = await request('/auth/v1/token?grant_type=password', '', {
    method: 'POST',
    body: JSON.stringify({ email: process.env[`${prefix}_EMAIL`], password: process.env[`${prefix}_PASSWORD`] }),
  });
  if (!result.ok || !result.body?.access_token || !result.body?.user?.id) {
    throw new Error(`${prefix} のログインに失敗しました (${result.status})`);
  }
  return { token: result.body.access_token, id: result.body.user.id };
}
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}
function denied(result) {
  return [401, 403].includes(result.status) || (result.ok && Array.isArray(result.body) && result.body.length === 0);
}

const a = await signIn('STUDENT_A');
const b = await signIn('STUDENT_B');
const teacher = await signIn('TEACHER_A');
if (new Set([a.id, b.id, teacher.id]).size !== 3) throw new Error('学生A、学生B、教員は別アカウントを指定してください。');
const id = randomUUID();
const questionKey = randomBytes(32).toString('hex');
const forgedId = randomUUID();
const forgedKey = randomBytes(32).toString('hex');
const rows = [
  { table: 'private_study_task_progress', filter: `scope=eq.test-${id}&task_key=eq.test`,
    forgedFilter: `scope=eq.test-${forgedId}&task_key=eq.test`,
    value: { user_id: a.id, scope: `test-${id}`, task_key: 'test', subject: 'test', task_text: 'test' },
    forgedValue: { user_id: a.id, scope: `test-${forgedId}`, task_key: 'test', subject: 'test', task_text: 'test' } },
  { table: 'private_past_question_review', filter: `qualification=eq.judo&question_key=eq.${questionKey}`,
    forgedFilter: `qualification=eq.judo&question_key=eq.${forgedKey}`,
    value: { user_id: a.id, qualification: 'judo', question_key: questionKey, question: { test: true } },
    forgedValue: { user_id: a.id, qualification: 'judo', question_key: forgedKey, question: { test: true } } },
  { table: 'private_past_question_sets', filter: `id=eq.${id}`,
    forgedFilter: `id=eq.${forgedId}`,
    value: { id, user_id: a.id, qualification: 'judo', questions: [{ test: true }] },
    forgedValue: { id: forgedId, user_id: a.id, qualification: 'judo', questions: [{ test: true }] } },
];

try {
  for (const row of rows) {
    const path = `/rest/v1/${row.table}`;
    const target = `${path}?${row.filter}&user_id=eq.${a.id}`;
    const inserted = await request(path, a.token, {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row.value),
    });
    assert(inserted.ok && inserted.body?.length === 1, `${row.table}: 学生本人が保存できる`);
    const own = await request(`${target}&select=user_id`, a.token);
    assert(own.ok && own.body?.length === 1, `${row.table}: 学生本人が読み取れる`);
    for (const [label, token] of [['学生B', b.token], ['教員', teacher.token], ['未ログイン', '']]) {
      const read = await request(`${target}&select=user_id`, token);
      assert(denied(read), `${row.table}: ${label}は学生Aのデータを読めない`);
    }
    for (const [label, token] of [['学生B', b.token], ['教員', teacher.token]]) {
      const forged = await request(path, token, {
        method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row.forgedValue),
      });
      assert([401, 403].includes(forged.status), `${row.table}: ${label}は学生Aのデータを登録できない`);
      const updated = await request(target, token, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ user_id: a.id }),
      });
      assert(denied(updated), `${row.table}: ${label}は学生Aのデータを更新できない`);
      const deleted = await request(target, token, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      assert(denied(deleted), `${row.table}: ${label}は学生Aのデータを削除できない`);
    }
    const stillOwn = await request(`${target}&select=user_id`, a.token);
    assert(stillOwn.ok && stillOwn.body?.length === 1, `${row.table}: 拒否テスト後も本人のデータが残る`);
  }
} finally {
  for (const row of rows) {
    for (const filter of [row.filter, row.forgedFilter]) {
      const result = await request(`/rest/v1/${row.table}?${filter}&user_id=eq.${a.id}`, a.token, {
        method: 'DELETE', headers: { Prefer: 'return=representation' },
      });
      if (!result.ok) {
        console.error(`テストデータを削除できませんでした: ${row.table} (${result.status})`);
        process.exitCode = 1;
      }
    }
  }
}
