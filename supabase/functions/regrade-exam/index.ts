import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

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

    if (operator.role === 'admin') {
      const { data: claimsData, error: claimsError } = await adminClient.auth.getClaims(token);
      if (claimsError || claimsData?.claims?.aal !== 'aal2') {
        throw new Error('管理者の二段階認証が必要です');
      }
    }

    const body = await request.json();
    if (typeof body.examId !== 'string' || !body.examId) {
      throw new Error('再採点する試験が指定されていません');
    }
    if (!body.overrides || typeof body.overrides !== 'object' || Array.isArray(body.overrides)) {
      throw new Error('採点設定の形式が不正です');
    }

    const { data: exam, error: examError } = await adminClient
      .from('exams')
      .select('id, school_id')
      .eq('id', body.examId)
      .single();
    if (examError || !exam) throw new Error('対象の試験が見つかりません');
    if (operator.role === 'teacher' && operator.school_id !== exam.school_id) {
      throw new Error('この試験を再採点する権限がありません');
    }

    const { data, error: regradeError } = await adminClient.rpc('regrade_exam', {
      target_exam_id: exam.id,
      actor_id: operator.id,
      new_question_overrides: body.overrides
    });
    if (regradeError) throw regradeError;

    return new Response(JSON.stringify(data), {
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
