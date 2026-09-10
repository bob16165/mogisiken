import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type StudentInput = {
  studentId: string;
  name: string;
  password: string;
};

Deno.serve(async (request) => {
  let stage = '開始';
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    stage = '認証';
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);

    if (authError || !authData.user) {
      throw new Error('認証が必要です');
    }

    const { data: operator, error: operatorError } = await adminClient
      .from('app_users')
      .select('role, school_id')
      .eq('id', authData.user.id)
      .single();

    if (operatorError || !operator || !['teacher', 'admin'].includes(operator.role)) {
      throw new Error('教員または管理者権限が必要です');
    }

    stage = '入力データ確認';
    const body = await request.json();
    const targetSchoolId = operator.role === 'admin' ? body.schoolId : operator.school_id;
    const students = body.students as StudentInput[];

    if (!targetSchoolId) throw new Error('登録先の学校が指定されていません');
    if (!Array.isArray(students) || students.length === 0) throw new Error('学生データがありません');
    if (students.some((student) => typeof student.password !== 'string' || student.password.length < 6)) {
      throw new Error('パスワードは6文字以上で入力してください');
    }

    const { data: school, error: schoolError } = await adminClient
      .from('schools')
      .select('name')
      .eq('id', targetSchoolId)
      .single();
    if (schoolError || !school) throw new Error('登録先の学校が見つかりません');
    const schoolLabel = school.name.replace(/専門学校/g, '').trim().replace(/\s+/g, '');
    if (!schoolLabel) throw new Error('学校名からログインIDを作成できません');

    if (body.replace === true) {
      stage = '既存データ整理';
      const ids = students.map((student) => student.studentId);
      const { error: deleteMasterError } = await adminClient
        .from('student_master')
        .delete()
        .eq('school_id', targetSchoolId)
        .not('student_id', 'in', `(${ids.map((id) => `"${id}"`).join(',')})`);
      if (deleteMasterError) throw deleteMasterError;

      const { error: deleteAppUserError } = await adminClient
        .from('app_users')
        .delete()
        .eq('role', 'student')
        .eq('school_id', targetSchoolId)
        .not('student_id', 'in', `(${ids.map((id) => `"${id}"`).join(',')})`);
      if (deleteAppUserError) throw deleteAppUserError;
    }

    stage = 'Authユーザー一覧取得';
    const { data: existingUsers, error: listUsersError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listUsersError) throw listUsersError;
    const results = [];
    for (const student of students) {
      stage = `学生 ${student.studentId} のAuth登録`;
      const loginId = `${schoolLabel}_${student.studentId.trim()}`;
      const email = `${encodeURIComponent(loginId)}@mogisiken.local`;
      let authUser;
      const existing = existingUsers.users.find((user) => user.email?.toLowerCase() === email);

      if (existing) {
        const { data, error } = await adminClient.auth.admin.updateUserById(existing.id, {
          password: student.password,
          email_confirm: true
        });
        if (error) throw error;
        authUser = data.user;
      } else {
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: student.password,
          email_confirm: true
        });
        if (error) throw error;
        authUser = data.user;
      }

      stage = `学生 ${student.studentId} の学生マスター登録`;
      const { error: masterError } = await adminClient.from('student_master').upsert({
        student_id: student.studentId,
        name: student.name,
        school_id: targetSchoolId
      }, { onConflict: 'school_id,student_id' });
      if (masterError) throw masterError;

      stage = `学生 ${student.studentId} のapp_users確認`;
      const { data: existingAppUser, error: appLookupError } = await adminClient
        .from('app_users')
        .select('id')
        .eq('student_id', student.studentId)
        .eq('school_id', targetSchoolId)
        .maybeSingle();
      if (appLookupError) throw appLookupError;

      const appUserPayload = {
        role: 'student',
        school_id: targetSchoolId,
        student_id: student.studentId,
        login_id: loginId,
        display_name: student.name
      };
      if (existingAppUser && existingAppUser.id !== authUser.id) {
        stage = `学生 ${student.studentId} の旧app_users整理`;
        const { error: oldAppUserError } = await adminClient
          .from('app_users')
          .delete()
          .eq('id', existingAppUser.id);
        if (oldAppUserError) throw oldAppUserError;
      }

      stage = `学生 ${student.studentId} のapp_users登録`;
      const { error: appUserError } = await adminClient.from('app_users').upsert({
        id: authUser.id,
        ...appUserPayload
      }, { onConflict: 'id' });
      if (appUserError) throw appUserError;

      results.push({ studentId: student.studentId, loginId, name: student.name, password: student.password, email });
    }

    return new Response(JSON.stringify({ count: results.length, students: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return new Response(JSON.stringify({ error: `処理箇所: ${stage} / ${message}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
});
