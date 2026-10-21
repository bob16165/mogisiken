import { useState } from 'react';
import type { ReactNode } from 'react';
import { buildClassReview, buildGuidance, buildWeakAreas, countBy, RECENT_EXAM_COUNT, wrongHighRate } from './prototypeAnalysis';
import type { HistoryEntry, QuestionHit } from './prototypeAnalysis';

const card = { marginBottom: 20, padding: 15, borderRadius: 8, border: '1px solid #bbdefb', background: '#f8fbff' } as const;

function Panel({ title, color = '#1565c0', children, initialExpanded = false, style }: {
  title: string; color?: string; children: ReactNode; initialExpanded?: boolean; style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(initialExpanded);
  return (
    <div style={{ ...card, ...style }}>
      <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color, flex: 1, fontSize: 18 }}>{title}</h3>
        <span style={{ fontSize: 20, color }}>{open ? '▼' : '▶'}</span>
      </div>
      {open && <div style={{ marginTop: 15 }}>{children}</div>}
    </div>
  );
}

export function StudyGuidance({ history, hideAnswers, isTeacher }: {
  history: HistoryEntry[]; hideAnswers: boolean; isTeacher: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const guidance = buildGuidance(history);
  const plan = guidance.top[Math.min(selected, guidance.top.length - 1)];
  const light = { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 14 } as const;

  return (
    <div style={{ marginBottom: 20, padding: 18, borderRadius: 12, background: 'linear-gradient(135deg, #102542 0%, #1f4e5f 100%)', color: 'white', boxShadow: '0 8px 24px rgba(16,37,66,0.18)' }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>AI</div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 20 }}>{isTeacher ? 'AI学習ナビ（教員用）' : 'AI学習ナビ'}</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.85 }}>
            {isTeacher ? '得点率・偏差値・取りこぼし・成績推移から、勉強方針と復習する問題を抽出しています' : '成績と問題の正答状況から、復習する科目を提案します'}
          </p>
        </div>
        <span style={{ fontSize: 20 }}>{open ? '▼' : '▶'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 16 }}>
          <div style={{ ...light, marginBottom: 16 }}>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>AI要約</div>
            <div style={{ fontSize: 15, lineHeight: 1.7 }}>
              {isTeacher ? guidance.summary : '最近の成績と問題の正答状況から、復習をおすすめする科目を表示しています。'}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, opacity: 0.82 }}>
              取りこぼしは選択中の試験とその前2回分から、他の受験者の正答率が70%以上だった問題のうち本人が誤答したものを集計しています。集中領域は選択中の試験までの全試験で、正答率50%以上の問題を誤答した領域です。
              優先度は失点の大きさ・得点率・偏差値・取りこぼし・得点率の低下から算出します。
            </div>
            {isTeacher && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>解析対象試験数: {guidance.analyzedExamCount}件</div>}
          </div>

          <h4 style={{ margin: '0 0 10px' }}>今回の学習課題</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 18 }}>
            {guidance.top.map((item, index) => (
              <button
                key={item.subject}
                type="button"
                onClick={() => setSelected(index)}
                style={{ textAlign: 'left', color: 'white', cursor: 'pointer', font: 'inherit', ...light, background: index === 0 ? 'rgba(255,214,102,0.16)' : light.background, outline: selected === index ? '2px solid #ffd666' : 'none' }}
              >
                <div style={{ fontSize: 12, opacity: 0.8 }}>優先 {index + 1}</div>
                <div style={{ fontSize: 17, fontWeight: 700, margin: '4px 0' }}>{item.subject}</div>
                {(hideAnswers ? [item.reasons[0]] : item.reasons).map((reason) => (
                  <div key={reason} style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.9 }}>{reason}</div>
                ))}
                {!hideAnswers && item.focusAreas.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#ffe082' }}>
                    ☐ {item.focusAreas.map(([area, count]) => `${area}（${count}問）`).join('、')}を復習
                  </div>
                )}
                {hideAnswers && <div style={{ marginTop: 6, fontSize: 12, color: '#ffe082' }}>☐ この科目の範囲を復習</div>}
              </button>
            ))}
          </div>

          {!hideAnswers && plan && (
            <div style={light}>
              <h4 style={{ margin: '0 0 10px' }}>{plan.subject}：復習したい問題（取りこぼし {plan.missed.length}問）</h4>
              {plan.missed.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>正答率70%以上の取りこぼしはありません。</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', opacity: 0.8 }}><th style={{ padding: 6 }}>試験</th><th>問題</th><th>出題基準</th><th>正答率</th><th>あなた</th><th>正答</th></tr></thead>
                    <tbody>
                      {plan.missed.slice(0, 10).map((hit) => (
                        <tr key={`${hit.examName}-${hit.label}`} style={{ borderTop: '1px solid rgba(255,255,255,0.12)' }}>
                          <td style={{ padding: 6 }}>{hit.examName}</td><td>{hit.label}</td><td>{hit.area}</td>
                          <td>{hit.correctRate}%</td><td>{hit.userAnswer || '−'}</td><td>{hit.correctAnswer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function WeakAreasPanel({ history, hideAnswers }: { history: HistoryEntry[]; hideAnswers: boolean }) {
  const groups = buildWeakAreas(history, hideAnswers);
  const recent = Math.min(RECENT_EXAM_COUNT, history.length);
  const hasWeak = groups.length > 0;
  const border = '1px solid #ffb74d';
  const th = { padding: 8, border } as const;
  const td = { padding: 8, border, textAlign: 'center' } as const;
  const percent = (wrong: number, asked: number) => (asked > 0 ? `${Math.round((wrong / asked) * 100)}%` : '—');
  return (
    <Panel
      title={`📚 苦手領域分析（全試験累積 / 直近${recent}回）`}
      color={hasWeak ? '#e65100' : '#2e7d32'}
      style={{ marginTop: 0, background: hasWeak ? '#fff3e0' : '#e8f5e9', border: hasWeak ? border : '1px solid #a5d6a7' }}
    >
      {!hasWeak ? <p style={{ margin: 0, color: '#555' }}>間違えた問題はありません！</p> : (
        <div>
          {groups.map((group) => (
            <div key={group.subject} style={{ marginBottom: 15 }}>
              <h4 style={{ margin: '0 0 8px', color: '#f57c00', borderBottom: '2px solid #ffb74d', paddingBottom: 4 }}>{group.subject}</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', background: 'white' }}>
                  <thead>
                    <tr style={{ background: '#ffe0b2' }}>
                      <th style={{ ...th, textAlign: 'left' }}>{hideAnswers ? '科目' : '出題領域'}</th>
                      <th style={{ ...th, textAlign: 'center' }}>全累積 間違い回数</th>
                      <th style={{ ...th, textAlign: 'center', width: 90 }}>全累積 誤答率</th>
                      <th style={{ ...th, textAlign: 'center' }}>直近{recent}回 間違い回数</th>
                      <th style={{ ...th, textAlign: 'center', width: 90 }}>直近{recent}回 誤答率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.areas.map((row) => (
                      <tr key={row.area}>
                        <td style={{ padding: 8, border }}>{hideAnswers ? group.subject : row.area}</td>
                        <td style={{ ...td, fontWeight: 'bold', color: row.wrong >= 3 ? '#c62828' : row.wrong >= 2 ? '#f57c00' : '#555' }}>{row.wrong}回/{row.asked}問</td>
                        <td style={td}>{percent(row.wrong, row.asked)}</td>
                        <td style={{ ...td, fontWeight: 'bold' }}>{row.recentWrong}回/{row.recentAsked}問</td>
                        <td style={td}>{percent(row.recentWrong, row.recentAsked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#666', fontStyle: 'italic' }}>
            ※ 全試験累積と直近{recent}回分を表示しています。
          </p>
        </div>
      )}
    </Panel>
  );
}

export function HighRateWrongPanel({ hits, title, hideAnswers = false, showWrongCount = false }: {
  hits: QuestionHit[]; title: string; hideAnswers?: boolean; showWrongCount?: boolean;
}) {
  const top5 = countBy(hits, (hit) => hit.subject).slice(0, 5);
  const [selected, setSelected] = useState('');
  const [showQuestions, setShowQuestions] = useState(false);
  const subject = top5.some(([name]) => name === selected) ? selected : top5[0]?.[0] ?? '';
  const inSubject = hits.filter((hit) => hit.subject === subject);
  const chart = countBy(inSubject, (hit) => hit.area);
  const maxCount = Math.max(...chart.map(([, count]) => count), 1);
  const blue = '#1565c0';

  return (
    <Panel title={title} style={{ marginTop: 20 }}>
      {top5.length === 0 ? <p style={{ margin: 0, color: '#555' }}>該当する誤答はありません。</p> : (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {top5.map(([name, count], index) => (
              <button key={name} type="button" onClick={() => setSelected(name)} style={{ padding: '6px 9px', border: subject === name ? `2px solid ${blue}` : '1px solid #90caf9', borderRadius: 5, background: subject === name ? '#e3f2fd' : 'white', color: blue, cursor: 'pointer', fontWeight: 600 }}>
                {index + 1}. {name}（{count}問）
              </button>
            ))}
          </div>
          {!hideAnswers && (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, minHeight: 200, padding: '15px 10px 0', overflowX: 'auto', background: 'white', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                {chart.map(([area, count]) => (
                  <div key={area} title={`${area}: ${count}問`} style={{ minWidth: 60, height: 190, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <strong style={{ color: blue, fontSize: 12, marginBottom: 4 }}>{count}</strong>
                    <div style={{ width: 34, height: `${Math.max(8, (count / maxCount) * 60)}%`, background: '#42a5f5', borderRadius: '4px 4px 0 0' }} />
                    <div style={{ marginTop: 6, fontSize: 11, color: '#334155', writingMode: 'vertical-rl', height: 60, overflow: 'hidden' }}>{area}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>{subject}：正答率50%以上で誤答した問題を領域別に集計（合計 {inSubject.length}件）</div>
              <button type="button" onClick={() => setShowQuestions(!showQuestions)} style={{ marginTop: 10, padding: '6px 10px', border: '1px solid #90caf9', borderRadius: 5, background: 'white', color: blue, cursor: 'pointer' }}>
                {showQuestions ? '該当問題詳細を閉じる' : '該当問題詳細を表示'}
              </button>
              {showQuestions && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', fontSize: 12 }}>
                    <thead><tr style={{ background: '#1976d2', color: 'white' }}>
                      {['試験回', '問題', '出題基準', '正答率', showWrongCount ? '誤答人数' : '本人の解答', '正答'].map((label) => <th key={label} style={{ padding: 7, textAlign: 'left' }}>{label}</th>)}
                    </tr></thead>
                    <tbody>
                      {(showWrongCount ? groupedByQuestion(inSubject) : inSubject).map((hit) => (
                        <tr key={`${hit.examName}-${hit.label}`} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: 7 }}>{hit.examName || '—'}</td><td style={{ padding: 7 }}>{hit.label}</td><td style={{ padding: 7 }}>{hit.area}</td>
                          <td style={{ padding: 7 }}>{hit.correctRate}%</td>
                          <td style={{ padding: 7 }}>{showWrongCount ? `${hit.wrongCount}名` : hit.userAnswer || '−'}</td>
                          <td style={{ padding: 7 }}>{hit.correctAnswer}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

function groupedByQuestion(hits: QuestionHit[]) {
  const map = new Map<string, QuestionHit>();
  hits.forEach((hit) => {
    const found = map.get(hit.label);
    if (found) found.wrongCount = (found.wrongCount ?? 0) + 1;
    else map.set(hit.label, { ...hit, wrongCount: 1 });
  });
  return [...map.values()].sort((a, b) => (b.wrongCount ?? 0) - (a.wrongCount ?? 0));
}

export function studentHighRateHits(history: HistoryEntry[]) {
  return history.flatMap((entry) => wrongHighRate(entry, 50));
}

export function TeacherReview({ track, examName = '' }: { track: HistoryEntry['track']; examName?: string }) {
  const review = buildClassReview(track, examName);
  const areas = (groups: typeof review.lecture, remedial: boolean) => groups.map((group) => (
    <div key={group.subject} style={{ marginBottom: 14 }}>
      <h4 style={{ margin: '0 0 6px', color: '#263238' }}>{group.subject}</h4>
      <ol style={{ margin: 0, paddingLeft: 24 }}>
        {group.rows.map((row) => (
          <li key={row.area} style={{ padding: '4px 0', color: '#37474f' }}>
            <strong>{row.area}</strong>
            <span style={{ marginLeft: 8, fontSize: 12, color: '#546e7a' }}>出題数 {row.questionCount}問</span>
            {remedial
              ? <span style={{ marginLeft: 8, fontSize: 12, color: '#6a1b9a', fontWeight: 600 }}>平均識別係数 r={row.averageDisc.toFixed(3)}</span>
              : <span style={{ marginLeft: 8, fontSize: 12, color: '#c62828' }}>誤答 {row.wrong}問</span>}
            <span style={{ marginLeft: 8, fontSize: 12, color: '#546e7a' }}>平均正答率 {row.averageRate}%</span>
          </li>
        ))}
      </ol>
    </div>
  ));
  const discBySubject = [...new Set(review.discQuestions.map((item) => item.subject))];

  return (
    <section style={{ marginTop: 30, paddingTop: 24, borderTop: '3px solid #1976d2' }}>
      <h2 style={{ margin: '0 0 15px', color: '#263238' }}>受験者全体の総評・復習ポイント</h2>
      <div style={{ background: '#e8f5e9', padding: 15, borderRadius: 8, marginBottom: 15 }}>
        <h3 style={{ margin: '0 0 8px', color: '#2e7d32' }}>総評</h3>
        <p style={{ margin: 0, lineHeight: 1.7 }}>
          受験者{review.studentCount}名の平均は{review.average.toFixed(1)}点（得点率{((review.average / review.max) * 100).toFixed(1)}%）でした。
          最高点は{review.highest}点、最低点は{review.lowest}点です。
          下位{review.lowCount}名を低学力者向け補習の分析対象としています。
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 15 }}>
        <div style={{ background: '#e3f2fd', padding: 15, borderRadius: 8, border: '1px solid #90caf9' }}>
          <h3 style={{ margin: '0 0 12px', color: '#1565c0' }}>全体の講義向け</h3>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#546e7a' }}>上位30%と下位30%を除外した中間層（{review.middleCount}名）を対象</p>
          {areas(review.lecture, false)}
        </div>
        <div style={{ background: '#fff3e0', padding: 15, borderRadius: 8, border: '1px solid #ffcc80' }}>
          <h3 style={{ margin: '0 0 12px', color: '#e65100' }}>低学力者の補習向け</h3>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6d4c41' }}>下位30%を対象に、平均識別係数0.2以上の領域</p>
          {review.remedial.length === 0 ? <p style={{ margin: 0, color: '#666' }}>補習対象に該当する問題領域がありません。</p> : areas(review.remedial, true)}
        </div>
      </div>
      <div style={{ marginTop: 15, background: '#f3e5f5', padding: 15, borderRadius: 8, border: '1px solid #ce93d8' }}>
        <h3 style={{ margin: '0 0 12px', color: '#6a1b9a' }}>低学力者向け：識別係数0.3以上の問題</h3>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6a1b9a' }}>総合点との相関が0.3以上の問題です。数値が高い問題ほど総合点との関連が強い問題です。</p>
        {discBySubject.length === 0 ? <p style={{ margin: 0, color: '#666' }}>識別係数0.3以上の問題はありません。</p> : discBySubject.map((subject) => (
          <div key={subject} style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 6px', color: '#263238' }}>{subject}</h4>
            <ol style={{ margin: 0, paddingLeft: 24 }}>
              {review.discQuestions.filter((item) => item.subject === subject).map((item) => (
                <li key={item.label} style={{ padding: '4px 0', color: '#37474f' }}>
                  <strong>問題 {item.label}</strong><span style={{ marginLeft: 8 }}>{item.area}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#6a1b9a', fontWeight: 600 }}>識別係数 r={item.r.toFixed(3)}</span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#c62828' }}>下位学生の誤答 {item.lowerWrong}/{review.lowCount}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <HighRateWrongPanel
        hits={review.wrongPairs}
        title="正答率50%以上で誤答した問題（全体・科目別TOP5）"
        showWrongCount
        key={track.questions.length}
      />
    </section>
  );
}
