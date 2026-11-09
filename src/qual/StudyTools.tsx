import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildGuidance, countBy } from '../prototypeAnalysis';
import type { HistoryEntry, QuestionHit } from '../prototypeAnalysis';

interface WeeklyTask {
  key: string;
  week: number;
  day: string;
  subject: string;
  task: string;
  done: boolean;
}

function buildWeeklyTasks(plans: ReturnType<typeof buildGuidance>['plans'], hideAnswers: boolean): WeeklyTask[] {
  const base = plans.length > 0 ? plans : [];
  return [0, 1, 2].flatMap((weekIndex) => Array.from({ length: 7 }, (_, dayIndex) => {
    const week = weekIndex + 1;
    const key = week === 1 ? `d${dayIndex + 1}` : `w${week}-d${dayIndex + 1}`;
    const day = `Day${dayIndex + 1}`;
    if (dayIndex >= 5) {
      return {
        key, week, day, subject: '自分で選ぶ2科目', done: false,
        task: dayIndex === 5
          ? '今週の重点領域や誤答を振り返り、特に確認したい2科目を自分で選んで合計約50問に取り組む。科目ごとの問題数も自分で決めて理解度をチェックする。'
          : 'Day6の手応えや誤答を振り返り、1週間の総まとめにしたい2科目を自分で選んで合計約50問に取り組む。必要なら科目を選び直して定着度を確認する。',
      };
    }
    const plan = base.length > 0 ? base[dayIndex % base.length] : null;
    const area = !hideAnswers ? plan?.focusAreas[weekIndex]?.[0] : undefined;
    const task = area && area !== '領域未設定'
      ? `「${area}」領域の問題を30問解き直す`
      : weekIndex === 0
        ? '科目全体の誤答問題を中心に復習し、苦手領域を整理する。'
        : weekIndex === 1
          ? '科目全体から誤答を中心に30問解き直す。'
          : '科目全体から問題を選んで30問解き、1・2週目の誤答も確認する。';
    return { key, week, day, subject: plan?.subject ?? '全科目', task, done: false };
  }));
}

export function WeeklyPlanTracker({ history, hideAnswers, storageId, supabase, scope }: {
  history: HistoryEntry[]; hideAnswers: boolean; storageId: string; supabase?: SupabaseClient; scope: string;
}) {
  const plans = useMemo(() => buildGuidance(history).plans.slice(0, 5), [history]);
  const generated = useMemo(() => buildWeeklyTasks(plans, hideAnswers), [plans, hideAnswers]);
  const storageKey = `mogisiken_qual_weekly_tasks_${storageId}`;
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<WeeklyTask[]>([]);
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    if (!supabase) {
      try {
        const done = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, boolean>;
        setTasks(generated.map((task) => ({ ...task, done: Boolean(done[task.key]) })));
      } catch {
        setStatus('端末内の課題進捗を読み込めませんでした。');
      }
      return () => { active = false; };
    }
    setUserId('');
    setTasks(generated.map((task) => ({ ...task, done: false })));
    setStatus('進捗を読み込んでいます…');
    const load = async () => {
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!auth.user) throw new Error('ログインが必要です。');
        const { data, error } = await supabase.from('private_study_task_progress')
          .select('task_key, subject, task_text, is_done').eq('user_id', auth.user.id).eq('scope', scope);
        if (error) throw error;
        if (!active) return;
        setTasks(generated.map((task) => {
          const saved = data.find((row) => row.task_key === task.key && row.subject === task.subject && row.task_text === task.task);
          return { ...task, done: Boolean(saved?.is_done) };
        }));
        setUserId(auth.user.id);
        setStatus('進捗は本人のアカウントに保存され、別の端末でも利用できます。');
      } catch (error) {
        if (active) setStatus(`進捗を読み込めませんでした。${error instanceof Error ? error.message : '接続を確認してください。'}`);
      }
    };
    void load();
    return () => { active = false; };
  }, [generated, scope, storageKey, supabase]);

  const toggle = async (task: WeeklyTask, checked: boolean) => {
    if (!supabase) {
      const next = tasks.map((item) => item.key === task.key ? { ...item, done: checked } : item);
      try {
        localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(next.map((item) => [item.key, item.done]))));
        setTasks(next);
      } catch {
        setStatus('端末内に課題進捗を保存できませんでした。');
      }
      return;
    }
    if (!userId || saving) return;
    setSaving(true);
    setStatus('保存中…');
    try {
      const { error } = await supabase.from('private_study_task_progress').upsert({
        user_id: userId, scope, task_key: task.key, subject: task.subject,
        task_text: task.task, is_done: checked, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,scope,task_key' });
      if (error) throw error;
      setTasks((current) => current.map((item) => item.key === task.key ? { ...item, done: checked } : item));
      setStatus('保存しました。本人のアカウントで別の端末からも確認できます。');
    } catch (error) {
      setStatus(`保存できませんでした。もう一度お試しください。${error instanceof Error ? error.message : ''}`);
    } finally {
      setSaving(false);
    }
  };

  const completed = tasks.filter((task) => task.done).length;
  const rate = tasks.length > 0 ? Math.round((completed / tasks.length) * 100) : 0;

  return (
    <div style={{ marginBottom: 20, borderRadius: 12, background: '#fff', border: '1px solid #dbeafe', boxShadow: '0 4px 14px rgba(2,132,199,0.12)', padding: 14 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 0, border: 'none', background: 'transparent', color: '#0f172a', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>週間課題トラッカー</span>
        <span aria-hidden="true">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div role="status" style={{ marginBottom: 10, fontSize: 12, color: '#475569' }}>{supabase ? status : status || '教員の確認画面では、このブラウザーに保存されます。'}</div>
          <div style={{ marginBottom: 10, fontSize: 13, color: '#334155' }}>進捗: {completed}/{tasks.length} ({rate}%)</div>
          <div style={{ height: 10, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${rate}%`, height: '100%', background: 'linear-gradient(90deg, #0284c7, #0ea5e9)' }} />
          </div>
          {[1, 2, 3].map((week) => (
            <section key={week} style={{ marginBottom: 14 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#0f172a' }}>第{week}週</h4>
              <div style={{ display: 'grid', gap: 8 }}>
                {tasks.filter((task) => task.week === week).map((task) => (
                  <div key={task.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 8, borderRadius: 8, background: task.done ? '#ecfeff' : '#f8fafc' }}>
                    <input type="checkbox" aria-label={`${task.day} ${task.subject} の完了`} checked={task.done} disabled={Boolean(supabase) && (!userId || saving)} onChange={(event) => void toggle(task, event.target.checked)} style={{ marginTop: 2 }} />
                    <div style={{ fontSize: 13, lineHeight: 1.6, flex: 1 }}>
                      <span style={{ fontWeight: 700, color: '#1e3a8a' }}>{task.day} / {task.subject}</span>
                      <div style={{ color: '#1f2937', textDecoration: task.done ? 'line-through' : 'none' }}>{task.task}</div>
                      {Number(task.day.replace('Day', '')) <= 5 && (
                        <a
                          href={(() => {
                            const url = new URL('./acupuncture-past-questions.html', window.location.href);
                            url.searchParams.set('subject', task.subject);
                            url.searchParams.set('day', task.day);
                            url.searchParams.set('count', '30');
                            const areaMatch = task.task.match(/「([^」]+)」領域|\"([^\"]+)\"領域/);
                            const area = areaMatch?.[1] ?? areaMatch?.[2];
                            if (area && area !== '領域未設定') url.searchParams.set('area', area);
                            return url.toString();
                          })()}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'inline-block', marginTop: 6, padding: '5px 9px', borderRadius: 5, background: '#1565c0', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}
                        >
                          この領域の過去問を解く
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChatMessage { role: 'user' | 'assistant'; text: string }

const normalize = (text: string) => text.replace(/[\s　]/g, '').toLowerCase();

export function StudyCoach({ hits, subjects, hideAnswers }: { hits: QuestionHit[]; subjects: string[]; hideAnswers: boolean }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', text: '「対策」を押して、科目ごとの集中領域と該当問題を確認できます。' }]);
  const [input, setInput] = useState('');
  const [awaitingSubject, setAwaitingSubject] = useState(false);
  const [drill, setDrill] = useState<{ subject: string; areas: string[] } | null>(null);

  const say = (...added: ChatMessage[]) => setMessages((current) => [...current, ...added]);
  const findSubject = (text: string) => {
    const wanted = normalize(text);
    return [...subjects].sort((a, b) => b.length - a.length).find((subject) => wanted.includes(normalize(subject))) ?? null;
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const user: ChatMessage = { role: 'user', text };

    if (awaitingSubject) {
      const subject = findSubject(text);
      if (!subject) {
        say(user, { role: 'assistant', text: `科目名を入力してください（${subjects.join('、')}）。` });
        return;
      }
      setAwaitingSubject(false);
      const subjectHits = hideAnswers ? [] : hits.filter((hit) => hit.subject === subject);
      const counts = countBy(subjectHits, (hit) => hit.area);
      if (counts.length === 0) {
        say(user, {
          role: 'assistant',
          text: hideAnswers
            ? `${subject}は正答率や集中領域が非表示の試験のため、深掘りできる領域情報がありません。`
            : `${subject}には、正答率50%以上の誤答に該当する集中領域がありません。`,
        });
        return;
      }
      setDrill({ subject, areas: counts.map(([area]) => area) });
      say(user, {
        role: 'assistant',
        text: `${subject}の集中領域は次のとおりです（正答率50%以上の誤答）。\n${counts.map(([area, count]) => `- ${area}（${count}問）`).join('\n')}\n\nどの領域をさらに深掘りしますか？領域名を入力してください。`,
      });
      return;
    }

    if (drill) {
      const wanted = normalize(text);
      const area = drill.areas.find((item) => wanted.includes(normalize(item)) || normalize(item).includes(wanted));
      if (!area) {
        say(user, { role: 'assistant', text: `領域名を入力してください。選べる領域:\n${drill.areas.map((item) => `- ${item}`).join('\n')}` });
        return;
      }
      const matched = hits.filter((hit) => hit.subject === drill.subject && hit.area === area);
      const byExam = new Map<string, QuestionHit[]>();
      matched.forEach((hit) => byExam.set(hit.examName, [...(byExam.get(hit.examName) ?? []), hit]));
      const lines = [...byExam.entries()].flatMap(([examName, items]) => [
        `【${examName || '試験名未設定'}】`,
        ...items.map((hit) => `- ${hit.subject} ${hit.label} / 正答率:${hit.correctRate}%`),
      ]);
      say(user, { role: 'assistant', text: matched.length > 0 ? `「${area}」の正答率50%以上の誤答問題です。\n${lines.join('\n')}` : `「${area}」に正答率50%以上の誤答問題はありません。` });
      setDrill(null);
      return;
    }

    say(user, { role: 'assistant', text: '科目ごとの対策を確認するには「対策」を押してください。' });
  };

  return (
    <div style={{ marginBottom: 20, borderRadius: 12, background: '#ffffff', border: '1px solid #d8dee9', boxShadow: '0 6px 16px rgba(15,23,42,0.08)', overflow: 'hidden' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ width: '100%', padding: '14px 16px', border: 'none', background: '#0f766e', color: 'white', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <strong style={{ fontSize: 18 }}>対話型AI 学習コーチ</strong>
        <span aria-hidden="true">{open ? '▼' : '▶'}</span>
      </button>
      {open && (
        <>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #edf2f7', background: '#f0fdfa', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                setAwaitingSubject(true);
                setDrill(null);
                setInput('');
                say({ role: 'assistant', text: `どの科目の対策をしますか？科目名を入力してください（${subjects.join('、')}）。` });
              }}
              style={{ padding: '6px 9px', border: '1px solid #0f766e', borderRadius: 6, background: '#0f766e', color: 'white', cursor: 'pointer' }}
            >
              対策
            </button>
            <span style={{ color: '#475569', fontSize: 12 }}>
              {awaitingSubject ? '科目名を入力してください' : drill ? '深掘りしたい集中領域名を入力してください' : '科目の集中領域と、その領域の問題を順に確認します'}
            </span>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', padding: '12px 14px', background: '#f8fafc' }}>
            {messages.map((message, index) => (
              <div key={index} style={{ marginBottom: 10, display: 'flex', justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '85%', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13, padding: '10px 12px', borderRadius: 10, background: message.role === 'user' ? '#1d4ed8' : 'white', color: message.role === 'user' ? 'white' : '#1e293b', border: message.role === 'user' ? 'none' : '1px solid #e2e8f0' }}>
                  {message.text}
                </div>
              </div>
            ))}
          </div>
          <form
            onSubmit={(event) => { event.preventDefault(); send(); }}
            style={{ padding: '12px 14px', borderTop: '1px solid #edf2f7', display: 'flex', gap: 8 }}
          >
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={awaitingSubject ? '対策したい科目名を入力' : drill ? '深掘りしたい集中領域を入力' : '「対策」から始めてください'}
              style={{ flex: 1, padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }}
            />
            <button type="submit" style={{ padding: '10px 14px', border: 'none', borderRadius: 8, background: '#0f766e', color: 'white', fontWeight: 600, cursor: 'pointer' }}>送信</button>
          </form>
        </>
      )}
    </div>
  );
}
