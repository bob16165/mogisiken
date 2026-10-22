import { useState } from 'react';
import { BarChart, deviation, rateStats, rank, scoreRate } from './QualificationApp';
import type { ParentScoreSet, ParentSummary, ServerExam } from './QualificationApp';
import { passLineOf, TRACK_LABELS } from '../qualCore';
import type { TrackId } from '../qualCore';

interface ScoreLine {
  name: string;
  score: number;
  max: number;
  rate: number;
  rank: number;
  deviation: number;
}

function lineOf(name: string, set: ParentScoreSet, ownIndex: number): ScoreLine {
  const score = set.scores[ownIndex];
  return {
    name,
    score,
    max: set.max,
    rate: scoreRate(score, set.max),
    rank: rank(score, set.scores),
    deviation: Math.round(deviation(score, set.scores) * 10) / 10,
  };
}

const cardStyle = { background: 'white', padding: 18, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 20 } as const;
const diffText = (value: number, unit = '') => `${value > 0 ? '+' : ''}${value}${unit}`;

function summaryOf(exam: ServerExam | undefined, trackId: TrackId) {
  return exam?.tracks[trackId]?.parentSummary;
}

function buildGuidance(summary: ParentSummary, previous: ParentSummary | undefined) {
  const own = summary.ownIndex;
  const total = lineOf('総合', summary.overall, own);
  const subjects = summary.subjects.map((item) => lineOf(item.name, item, own));
  const previousByName = new Map((previous?.subjects ?? []).map((item) => [item.name, lineOf(item.name, item, previous!.ownIndex)]));
  const previousTotal = previous ? lineOf('総合', previous.overall, previous.ownIndex) : null;

  const improved: { line: ScoreLine; prev: ScoreLine; diff: number; rateDiff: number }[] = [];
  const needsEffort: { line: ScoreLine; diff: number | null; belowAverage: boolean }[] = [];
  subjects.forEach((line) => {
    const prev = previousByName.get(line.name);
    const diff = prev ? Math.round((line.deviation - prev.deviation) * 10) / 10 : null;
    if (prev && diff !== null && diff >= 2) improved.push({ line, prev, diff, rateDiff: Math.round((line.rate - prev.rate) * 10) / 10 });
    const belowAverage = line.deviation < 45;
    if ((diff !== null && diff <= -2) || belowAverage) needsEffort.push({ line, diff, belowAverage });
  });
  improved.sort((a, b) => b.diff - a.diff);
  needsEffort.sort((a, b) => a.line.deviation - b.line.deviation);

  const loss = [...subjects].sort((a, b) => (b.max - b.score) - (a.max - a.score)).slice(0, 3).map((line) => line.name).join('、');
  const passLine = passLineOf(summary.overall.max);
  const ruleResults = summary.rules.map((rule) => {
    const line = lineOf(rule.label, rule, own);
    const pass = passLineOf(rule.max);
    return { line, pass, ok: line.score >= pass, gap: Math.max(0, pass - line.score) };
  });
  const judged = ruleResults.length > 0
    ? ruleResults
    : [{ line: total, pass: passLine, ok: total.score >= passLine, gap: Math.max(0, passLine - total.score) }];
  const allOk = judged.every((item) => item.ok);

  const level = total.deviation >= 55 ? 'high' : total.deviation >= 45 ? 'mid' : 'low';
  const scoreText = judged.map((item) => (item.ok
    ? `${item.line.name}は${item.line.score}点で、国家試験の合格基準（${item.pass}点）に達しています。`
    : `${item.line.name}は${item.line.score}点で、合格基準（${item.pass}点）まであと${item.gap}点です。`)).join('');
  const levelText = {
    high: `総合の偏差値は${total.deviation}で、受験者全体の中でも上位に位置しています。`,
    mid: `総合の偏差値は${total.deviation}で、受験者全体の中では平均的な位置にいます。`,
    low: `総合の偏差値は${total.deviation}で、今回は全体の平均をやや下回りました。`,
  }[level];
  const overall = allOk
    ? (level === 'low'
      ? '点数は基準に達しており、今回の模試が比較的易しかった可能性もあります。基礎を固めながら、さらに得点を積み上げていきましょう。'
      : '点数・偏差値の両面から、順調に学習が進んでいると言えます。この調子で継続していきましょう。')
    : level === 'low'
      ? '点数・偏差値ともに伸びしろのある状況です。国家試験までにはまだ時間がありますので、得意・不得意を整理しながら、一歩ずつ力をつけていきましょう。'
      : '点数は基準にあと少し届いていませんが、偏差値で見ると周囲と比べて決して悪い位置ではありません。模試の難易度による影響も大きいため、点数だけで判断せず、引き続き着実に力を伸ばしていきましょう。';

  const paragraphs = [scoreText + levelText + overall];
  if (previousTotal) {
    const devDiff = Math.round((total.deviation - previousTotal.deviation) * 10) / 10;
    paragraphs.push(devDiff >= 2
      ? `前回と比べて総合の偏差値は${devDiff}ポイント上昇しており、学習の成果が表れています。`
      : devDiff <= -2
        ? `前回より総合の偏差値は${Math.abs(devDiff)}ポイント下がりましたが、模試ごとの難易度や出題の偏りでも変動します。一度の結果で心配しすぎず、次回以降の推移を見守ってください。`
        : '前回と比べて総合の偏差値はほぼ横ばいで、安定した成績です。');
  }
  paragraphs.push(allOk
    ? `基準を超えています。${loss}は、まだ得点を伸ばせる余地が大きい科目ですので、ここを復習するとさらに安定します。`
    : `基準まであと${judged.filter((item) => !item.ok).map((item) => `${item.line.name}${item.gap}点`).join('、')}です。各科目をバランスよく伸ばしつつ、特に${loss}の取りこぼしを減らすことが近道です。`);
  return { total, subjects, judged, improved, needsEffort, hasPrevious: Boolean(previous), paragraphs };
}

export default function ParentView({ exams, onLogout }: { exams: ServerExam[]; onLogout: () => void }) {
  const trackIds = (['acupuncture', 'massage'] as TrackId[]).filter((id) => exams.some((exam) => summaryOf(exam, id)));
  const [trackId, setTrackId] = useState<TrackId | ''>('');
  const activeTrack = (trackId && trackIds.includes(trackId) ? trackId : trackIds[0]) as TrackId | undefined;
  const childExams = activeTrack ? exams.filter((exam) => summaryOf(exam, activeTrack)) : [];
  const [examIndex, setExamIndex] = useState(-1);
  const safeIndex = examIndex >= 0 && examIndex < childExams.length ? examIndex : childExams.length - 1;
  const currentExam = childExams[safeIndex];
  const summary = activeTrack ? summaryOf(currentExam, activeTrack) : undefined;
  const previous = activeTrack && safeIndex > 0 ? summaryOf(childExams[safeIndex - 1], activeTrack) : undefined;

  const header = (
    <div style={{ background: '#2e7d32', color: 'white', padding: 20, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>模擬試験結果（保護者用）</h1>
          {currentExam && <p style={{ margin: '5px 0 0 0', fontSize: 14, opacity: 0.9 }}>📋 {currentExam.name}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {trackIds.length > 1 && (
            <select value={activeTrack} onChange={(event) => { setTrackId(event.target.value as TrackId); setExamIndex(-1); }} style={{ padding: '10px 15px', fontSize: 14, borderRadius: 6, border: 'none', fontWeight: 600 }}>
              {trackIds.map((id) => <option key={id} value={id}>{TRACK_LABELS[id]}</option>)}
            </select>
          )}
          {childExams.length > 1 && (
            <select value={safeIndex} onChange={(event) => setExamIndex(Number(event.target.value))} style={{ padding: '10px 15px', fontSize: 14, borderRadius: 6, border: 'none', fontWeight: 600 }}>
              {childExams.map((exam, index) => <option key={exam.batchId} value={index}>{exam.name}</option>)}
            </select>
          )}
          <button type="button" onClick={onLogout} style={{ padding: '10px 20px', fontSize: 14, fontWeight: 600, background: '#f44336', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}>ログアウト</button>
        </div>
      </div>
    </div>
  );

  if (!summary || !activeTrack) {
    return (
      <div style={{ minHeight: '100vh', background: '#fafafa' }}>
        {header}
        <div style={{ maxWidth: 1000, margin: '40px auto', padding: 30, background: 'white', borderRadius: 8, textAlign: 'center', color: '#666' }}>
          公開されている試験結果がまだありません。結果が公開されると、こちらで確認できます。
        </div>
      </div>
    );
  }

  const guidance = buildGuidance(summary, previous);
  const { total } = guidance;
  const totalRate = rateStats(summary.overall.scores, summary.overall.max);
  const judgeBadge = (ok: boolean) => (
    <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 13, fontWeight: 700, color: 'white', background: ok ? '#2e7d32' : '#e65100' }}>
      {ok ? '基準クリア' : 'これから伸ばす分野'}
    </span>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      {header}
      <div style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ background: '#f5f5f5', padding: 15, borderRadius: 8, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>学生情報</h3>
          <p style={{ margin: '5px 0' }}><strong>受験番号:</strong> {summary.studentId}</p>
          <p style={{ margin: '5px 0' }}><strong>氏名:</strong> {summary.studentName}</p>
        </div>

        <div style={{ background: '#e3f2fd', padding: 15, borderRadius: 8, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>総合成績</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 15 }}>
            <div><strong>総合点:</strong> <span style={{ color: '#1976d2', fontWeight: 'bold' }}>{total.score}/{total.max}</span></div>
            {summary.rules.map((rule) => (
              <div key={rule.label}><strong>{rule.label}合計:</strong> {rule.scores[summary.ownIndex]}/{rule.max}</div>
            ))}
          </div>
          <div style={{ marginTop: 20 }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: 14 }}>総合点得点率</h4>
            <BarChart scoreRate={total.rate} averageRate={totalRate.average} stdDeviation={totalRate.stdDev} />
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, fontSize: 13 }}>
              <div><strong>得点率:</strong> {total.rate}%</div>
              <div><strong>順位:</strong> {total.rank}位</div>
              <div><strong>偏差値:</strong> {total.deviation}</div>
              <div><strong>Ave.:</strong> {Math.round(totalRate.average * 10) / 10}%</div>
            </div>
          </div>
        </div>

        <h3>科目別成績</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 30, background: 'white' }}>
            <thead>
              <tr style={{ background: '#1976d2', color: 'white' }}>
                {['科目', '得点', '得点率', '順位', '偏差値'].map((label) => <th key={label} style={{ padding: 12, textAlign: 'left' }}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {guidance.subjects.map((line, index) => (
                <tr key={line.name} style={{ background: index % 2 === 0 ? 'white' : '#f9f9f9' }}>
                  <td style={{ padding: 12, fontWeight: 'bold' }}>{line.name}</td>
                  <td style={{ padding: 12 }}>{line.score}/{line.max}</td>
                  <td style={{ padding: 12 }}>{line.rate}%</td>
                  <td style={{ padding: 12 }}>{line.rank}位</td>
                  <td style={{ padding: 12 }}>{line.deviation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 10px 0' }}>国家試験の合格基準と今回の結果</h3>
          <p style={{ margin: '0 0 12px 0', fontSize: 14, color: '#555', lineHeight: 1.7 }}>
            国家試験は、<strong>総得点の60%以上</strong>が合格の目安です。
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {guidance.judged.map((item) => (
              <div key={item.line.name} style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{item.line.name}（基準 {item.pass}/{item.line.max}点）</strong>{judgeBadge(item.ok)}
                </div>
                <div style={{ marginTop: 8, fontSize: 22, fontWeight: 'bold' }}>{item.line.score}<span style={{ fontSize: 14, color: '#666' }}> / {item.line.max}点</span></div>
                <div style={{ fontSize: 13, color: '#555' }}>{item.ok ? `基準を${item.line.score - item.pass}点上回っています` : `基準まであと${item.gap}点`}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 10px 0' }}>前回との比較</h3>
          {!guidance.hasPrevious && <p style={{ margin: '0 0 10px 0', fontSize: 13, color: '#666' }}>前回の公開済み試験がないため、今回の結果のみで評価しています。</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            <div style={{ background: '#e8f5e9', borderRadius: 8, padding: 12 }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#1b5e20' }}>📈 改善が見られる科目</h4>
              {guidance.improved.length === 0
                ? <p style={{ margin: 0, fontSize: 13, color: '#555' }}>{guidance.hasPrevious ? '今回は大きく伸びた科目はありませんでした。' : '前回データがないため比較できません。'}</p>
                : guidance.improved.map((item) => (
                  <div key={item.line.name} style={{ fontSize: 14, marginBottom: 6 }}>
                    <strong>{item.line.name}</strong>：偏差値 {item.prev.deviation} → {item.line.deviation}（{diffText(item.diff)}）／得点率 {diffText(item.rateDiff, '%')}
                  </div>
                ))}
            </div>
            <div style={{ background: '#fff3e0', borderRadius: 8, padding: 12 }}>
              <h4 style={{ margin: '0 0 8px 0', color: '#e65100' }}>💪 努力が必要な科目</h4>
              {guidance.needsEffort.length === 0
                ? <p style={{ margin: 0, fontSize: 13, color: '#555' }}>特に気になる科目はありません。</p>
                : guidance.needsEffort.map((item) => (
                  <div key={item.line.name} style={{ fontSize: 14, marginBottom: 6 }}>
                    <strong>{item.line.name}</strong>：偏差値 {item.line.deviation}
                    {item.diff !== null && <>（前回比 {diffText(item.diff)}）</>}
                    {item.belowAverage && <span style={{ color: '#e65100' }}> 伸びしろがあります</span>}
                  </div>
                ))}
            </div>
          </div>
          <p style={{ margin: '10px 0 0 0', fontSize: 12, color: '#888' }}>※ 試験ごとの難易度の差を除くため、偏差値の変化で判定しています（偏差値が2以上上昇＝改善、2以上低下または45未満＝努力が必要）。</p>
        </div>

        <div style={{ ...cardStyle, borderLeft: '5px solid #2e7d32' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>保護者の皆様へ ― 今後の学習目標</h3>
          {guidance.paragraphs.map((text, index) => (
            <p key={index} style={{ margin: '0 0 12px 0', lineHeight: 1.8, fontSize: 15, color: '#333' }}>{text}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
