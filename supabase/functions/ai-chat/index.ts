import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// 対話型AI学習コーチ用: ChatGPT呼び出しをサーバー側に隔離し、OpenAI APIキーをクライアントへ渡さない
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const MAX_QUESTION_LENGTH = 1000;
const MAX_HISTORY_ITEMS = 6;

type ChatHistoryItem = { role: string; text: string };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) throw new Error('サーバーにOpenAI APIキーが設定されていません');
    // deno-lint-ignore no-control-regex
    if (!/^[\x00-\xFF]*$/.test(openaiApiKey) || /[\r\n]/.test(openaiApiKey)) {
      throw new Error(
        `OPENAI_API_KEYに不正な文字が含まれています（長さ:${openaiApiKey.length}）。全角文字や改行が混入していないか確認し、Secretsを再設定してください。`
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('認証が必要です');

    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) throw new Error('認証が必要です');

    // 生徒本人のIDでしか自分の学習コーチを利用できないようにする
    const { data: operator, error: operatorError } = await adminClient
      .from('app_users')
      .select('role, student_id')
      .eq('id', authData.user.id)
      .single();

    if (operatorError || !operator || operator.role !== 'student' || !operator.student_id) {
      throw new Error('学生アカウントのみ利用できます');
    }

    const body = await request.json();
    const requestedStudentId = String(body.studentId || '');
    if (!requestedStudentId || requestedStudentId !== operator.student_id) {
      throw new Error('自分自身の学習データでのみ利用できます');
    }

    const question = String(body.question || '').trim();
    if (!question) throw new Error('質問が空です');
    if (question.length > MAX_QUESTION_LENGTH) throw new Error('質問が長すぎます');

    // 直近1分間のリクエスト数を確認し、APIコスト暴走・乱用を防ぐ
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count, error: countError } = await adminClient
      .from('student_chat_messages')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', operator.student_id)
      .eq('role', 'user')
      .gte('created_at', windowStart);

    if (!countError && (count ?? 0) >= RATE_LIMIT_MAX_REQUESTS) {
      return new Response(JSON.stringify({ error: 'リクエストが多すぎます。しばらくしてから再度お試しください。' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const guidance = body.guidance || {};
    const hideCorrectAnswer = !!body.hideCorrectAnswer;
    const history: ChatHistoryItem[] = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_ITEMS) : [];

    const priorities = (guidance?.actionPlan || []).map((item: any, idx: number) =>
      `${idx + 1}. ${item.subjectName} / 最新得点率:${item.latestScoreRate}% / 高正答率取りこぼし:${item.highCorrectRateMisses} / 50〜70%帯誤答:${item.midCorrectRateMisses} / 集中領域:${item.sourceText}`
    ).join('\n');
    const recQuestions = (guidance?.recommendedQuestions || []).slice(0, 8).map((q: any, idx: number) => {
      const answerPart = hideCorrectAnswer ? '' : ` 正答:${q.correctAnswer || '-'}`;
      return `${idx + 1}. ${q.subjectName} ${q.questionNumber} 出典:${q.displaySource} 正答率:${q.correctRate ?? '-'}% 自分:${q.userAnswer || '-'}${answerPart}`;
    }).join('\n');

    const systemPrompt = [
      'あなたは柔道整復師国家試験対策の学習コーチです。',
      '学生に寄り添って短く具体的に提案してください。',
      '与えられた成績データに基づかない断定はしないでください。',
      hideCorrectAnswer ? '正答は開示禁止です。' : '必要なら正答も提示できます。',
      '優先科目:',
      priorities || 'データなし',
      '関連問題:',
      recQuestions || 'データなし'
    ].join('\n');

    const historyMessages = history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.text || '').slice(0, 2000)
    }));

    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user', content: question }
        ]
      })
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      throw new Error(`ChatGPT APIエラー: ${openaiResponse.status} ${errText}`);
    }

    const data = await openaiResponse.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'ChatGPTから応答がありませんでした。';

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
