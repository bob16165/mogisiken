import { useMemo, useState } from 'react';
import { allStudentScores } from '../qualCore';
import type { ExamData, TrackData, TrackId } from '../qualCore';

interface Props {
  exams: ExamData[];
  trackId: TrackId;
  currentExamId: string;
  onOpenStudent: (studentId: string, examId: string) => void;
}

interface Point { examIndex: number; examName: string; deviation: number }
interface Hover {
  kind: 'cohort' | 'student';
  examName?: string;
  count?: number;
  median?: number;
  lower?: number;
  upper?: number;
  studentId?: string;
  studentName?: string;
  deviation?: number;
}

const colors = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#6A3D9A', '#4D4D4D', '#A6761D', '#1B9E77'];

function deviationOf(score: number, scores: number[]) {
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const std = Math.sqrt(scores.reduce((sum, value) => sum + (value - average) ** 2, 0) / scores.length);
  return std === 0 ? 50 : Math.round((((score - average) / std) * 10 + 50) * 10) / 10;
}

function quantile(sorted: number[], proportion: number) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] * (1 - (position - lower)) + sorted[upper] * (position - lower);
}

function metricFilter(track: TrackData, metric: string) {
  if (metric === 'total') return () => true;
  if (metric.startsWith('rule:')) {
    const excluded = track.rules.find((rule) => rule.qualification === metric.slice(5))?.excludedSubject;
    return (question: { subject: string }) => question.subject !== excluded;
  }
  const subject = metric.slice('subject:'.length);
  return (question: { subject: string }) => question.subject === subject;
}

export function DeviationTrend({ exams, trackId, currentExamId, onOpenStudent }: Props) {
  const available = exams
    .map((exam) => ({ exam, track: exam.tracks[trackId] }))
    .filter((item): item is { exam: ExamData; track: TrackData } => Boolean(item.track));
  const [selected, setSelected] = useState<Set<string>>(() => new Set(available.some((item) => item.exam.id === currentExamId) ? [currentExamId] : []));
  const [metric, setMetric] = useState('total');
  const [highlight, setHighlight] = useState('');
  const [hover, setHover] = useState<Hover | null>(null);

  const chosen = available.filter((item) => selected.has(item.exam.id));
  const anchor = chosen[chosen.length - 1];
  const metrics = useMemo(() => {
    const track = anchor?.track ?? available[available.length - 1]?.track;
    if (!track) return [{ value: 'total', label: '総合計' }];
    return [
      { value: 'total', label: '総合計' },
      ...track.rules.map((rule) => ({ value: `rule:${rule.qualification}`, label: `${rule.label} 合計` })),
      ...track.subjects.map((subject) => ({ value: `subject:${subject}`, label: subject })),
    ];
  }, [anchor, available]);
  const activeMetric = metrics.some((item) => item.value === metric) ? metric : 'total';

  const perExam = chosen.map(({ exam, track }) => {
    const filter = metricFilter(track, activeMetric);
    const scores = allStudentScores(track, filter);
    const hasQuestions = track.questions.some(filter);
    const byStudent = new Map(track.students.map((student, i) => [student.id, hasQuestions ? deviationOf(scores[i], scores) : null]));
    return { exam, byStudent };
  });
  const rows = (anchor?.track.students ?? []).map((student) => {
    const points = perExam.map(({ exam, byStudent }, examIndex): Point | null => {
      const value = byStudent.get(student.id);
      return value === undefined || value === null ? null : { examIndex, examName: exam.name, deviation: value };
    });
    return { id: student.id, name: student.name, points };
  });

  const values = rows.flatMap((row) => row.points.flatMap((point) => (point ? [point.deviation] : [])));
  const yMin = Math.floor(((values.length ? Math.min(...values) : 40) - 5) / 10) * 10;
  const yMax = Math.max(yMin + 20, Math.ceil(((values.length ? Math.max(...values) : 60) + 5) / 10) * 10);
  const chart = { width: 1000, height: 420 };
  const plot = { left: 70, right: 965, top: 28, bottom: 345 };
  const x = (index: number) => (chosen.length <= 1 ? (plot.left + plot.right) / 2 : plot.left + (index / (chosen.length - 1)) * (plot.right - plot.left));
  const y = (value: number) => plot.bottom - ((value - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);

  const cohort = chosen.map(({ exam }, examIndex) => {
    const sorted = rows.flatMap((row) => (row.points[examIndex] ? [row.points[examIndex]!.deviation] : [])).sort((a, b) => a - b);
    return { examName: exam.name, examIndex, count: sorted.length, lower: quantile(sorted, 0.25), median: quantile(sorted, 0.5), upper: quantile(sorted, 0.75) };
  });
  const drops = rows.flatMap((row) => {
    const valid = row.points.filter((point): point is Point => point !== null);
    const latest = valid[valid.length - 1];
    const previous = valid[valid.length - 2];
    return latest && previous && latest.deviation < 55 && previous.deviation - latest.deviation >= 5
      ? [{ ...row, previous, latest, drop: Math.round((previous.deviation - latest.deviation) * 10) / 10 }]
      : [];
  }).sort((a, b) => b.drop - a.drop);
  const highlighted = highlight === '__watchlist__' ? drops : rows.filter((row) => row.id === highlight);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const open = (studentId: string) => anchor && onOpenStudent(studentId, anchor.exam.id);

  const box = { background: 'white', border: '1px solid #e0e6ea', borderRadius: 10, padding: '18px 20px' } as const;
  const bandUpper = cohort.flatMap((point) => (point.upper === null ? [] : [{ x: x(point.examIndex), y: y(point.upper) }]));
  const bandLower = cohort.flatMap((point) => (point.lower === null ? [] : [{ x: x(point.examIndex), y: y(point.lower) }])).reverse();
  const band = bandUpper.length > 1
    ? `${bandUpper.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} ${bandLower.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z`
    : '';
  const medians = cohort.filter((point) => point.median !== null);

  return (
    <div style={{ marginTop: 20 }}>
      <h2 style={{ textAlign: 'center', color: '#263238', margin: '8px 0 16px' }}>偏差値推移分析</h2>
      <section style={{ ...box, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', color: '#263238', fontSize: 16 }}>比較する試験</h3>
            <p style={{ margin: 0, color: '#78909c', fontSize: 12 }}>選択した試験を時系列で比較します。学生の集合は、選択した中で最も新しい試験の受験者です。</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#546e7a' }}>{chosen.length}/{available.length}件選択</span>
            <button type="button" onClick={() => setSelected(new Set(available.map((item) => item.exam.id)))} style={{ border: 0, background: 'transparent', color: '#1565c0', fontWeight: 600, cursor: 'pointer' }}>すべて選択</button>
            <button type="button" onClick={() => setSelected(new Set())} style={{ border: 0, background: 'transparent', color: '#546e7a', cursor: 'pointer' }}>解除</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, maxHeight: 190, overflowY: 'auto' }}>
          {available.map(({ exam, track }) => {
            const checked = selected.has(exam.id);
            return (
              <label key={exam.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 11px', border: `1px solid ${checked ? '#90caf9' : '#e4eaee'}`, borderRadius: 7, background: checked ? '#f1f8ff' : 'white', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(exam.id)} style={{ marginTop: 2 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', color: '#37474f', fontSize: 13, fontWeight: checked ? 600 : 400, overflowWrap: 'anywhere' }}>{exam.name}</span>
                  <span style={{ display: 'block', marginTop: 3, color: '#90a4ae', fontSize: 11 }}>{track.students.length} 名</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', color: '#263238', fontSize: 17 }}>全体傾向と個人推移</h3>
            <p style={{ margin: 0, color: '#78909c', fontSize: 12 }}>
              {anchor ? `${anchor.exam.name} の受験者 ${rows.length} 名` : '試験を選択してください'} ・ 帯は中央50%の範囲、太線は中央値です
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#455a64', fontSize: 13, fontWeight: 600 }}>
              指標
              <select value={activeMetric} onChange={(event) => setMetric(event.target.value)} style={{ padding: '9px 12px', border: '1px solid #cfd8dc', borderRadius: 6, background: 'white', minWidth: 130 }}>
                {metrics.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#455a64', fontSize: 13, fontWeight: 600 }}>
              個人を重ねる
              <select value={highlight} onChange={(event) => setHighlight(event.target.value)} style={{ padding: '9px 12px', border: '1px solid #cfd8dc', borderRadius: 6, background: 'white', minWidth: 180, maxWidth: 260 }}>
                <option value="">表示しない（全体傾向のみ）</option>
                <option value="__watchlist__">要チェック対象者（{drops.length}名）</option>
                {rows.map((row) => <option key={row.id} value={row.id}>{row.name}（{row.id}）</option>)}
              </select>
            </label>
          </div>
        </div>
        {!anchor || rows.length === 0 ? (
          <div style={{ padding: '48px 16px', textAlign: 'center', color: '#78909c' }}>比較する試験を1つ以上選択してください。</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="偏差値推移グラフ" style={{ display: 'block', width: '100%', minWidth: chosen.length > 8 ? 850 : 620, height: 'auto' }}>
              {Array.from({ length: Math.floor((yMax - yMin) / 10) + 1 }, (_, index) => {
                const tick = yMin + index * 10;
                return (
                  <g key={tick}>
                    <line x1={plot.left} y1={y(tick)} x2={plot.right} y2={y(tick)} stroke="#e8edf0" />
                    <text x={plot.left - 12} y={y(tick) + 4} textAnchor="end" fill="#607d8b" fontSize="12">{tick}</text>
                  </g>
                );
              })}
              <line x1={plot.left} y1={y(50)} x2={plot.right} y2={y(50)} stroke="#90a4ae" strokeDasharray="5 5" />
              <text x={plot.left + 4} y={y(50) - 7} fill="#78909c" fontSize="11">偏差値50</text>
              {band && <path d={band} fill="#e6e8eb" fillOpacity="0.55" stroke="none" />}
              {medians.length > 1 && (
                <path d={medians.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.examIndex)} ${y(point.median!)}`).join(' ')} fill="none" stroke="#1565c0" strokeWidth="3" strokeLinejoin="round" />
              )}
              {medians.map((point) => (
                <g key={`cohort-${point.examIndex}`} onMouseEnter={() => setHover({ kind: 'cohort', examName: point.examName, count: point.count, median: point.median!, lower: point.lower!, upper: point.upper! })} onMouseLeave={() => setHover(null)}>
                  <circle cx={x(point.examIndex)} cy={y(point.median!)} r="14" fill="transparent" />
                  <circle cx={x(point.examIndex)} cy={y(point.median!)} r="5" fill="#1565c0" stroke="white" strokeWidth="2" />
                </g>
              ))}
              {highlighted.map((row, rowIndex) => {
                const color = highlight === '__watchlist__' ? colors[(rowIndex + 1) % colors.length] : '#d55e00';
                const valid = row.points.filter((point): point is Point => point !== null);
                const faded = hover?.kind === 'student' && hover.studentId !== row.id;
                return (
                  <g key={row.id}>
                    {valid.length > 1 && (
                      <path d={valid.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.examIndex)} ${y(point.deviation)}`).join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeOpacity={faded ? 0.16 : 0.95} />
                    )}
                    {valid.map((point) => (
                      <g key={point.examIndex} role="button" tabIndex={0} aria-label={`${row.name}、${point.examName}、偏差値${point.deviation}。クリックで個人詳細`}
                        onClick={() => open(row.id)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(row.id); } }}
                        onMouseEnter={() => setHover({ kind: 'student', studentId: row.id, studentName: row.name, examName: point.examName, deviation: point.deviation })}
                        onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                        <circle cx={x(point.examIndex)} cy={y(point.deviation)} r="10" fill="transparent" />
                        <circle cx={x(point.examIndex)} cy={y(point.deviation)} r="5" fill={color} stroke="white" strokeWidth="2" />
                      </g>
                    ))}
                  </g>
                );
              })}
              {hover && (
                <g pointerEvents="none">
                  <rect x={plot.left + 8} y={plot.top + 5} width="270" height="49" rx="6" fill="#263238" opacity="0.94" />
                  {hover.kind === 'cohort' ? (
                    <>
                      <text x={plot.left + 20} y={plot.top + 24} fill="white" fontSize="12" fontWeight="600">{hover.examName} ・ 受験者 {hover.count} 名</text>
                      <text x={plot.left + 20} y={plot.top + 42} fill="#e0f2f1" fontSize="11">中央値 {hover.median!.toFixed(1)} ／ 中央50% {hover.lower!.toFixed(1)}〜{hover.upper!.toFixed(1)}</text>
                    </>
                  ) : (
                    <>
                      <text x={plot.left + 20} y={plot.top + 24} fill="white" fontSize="12" fontWeight="600">{hover.studentName}</text>
                      <text x={plot.left + 20} y={plot.top + 42} fill="#e0f2f1" fontSize="11">{hover.examName} ・ 偏差値 {hover.deviation}</text>
                    </>
                  )}
                </g>
              )}
              {chosen.map(({ exam }, index) => (
                <g key={exam.id}>
                  <line x1={x(index)} y1={plot.bottom} x2={x(index)} y2={plot.bottom + 5} stroke="#78909c" />
                  <text x={x(index)} y={plot.bottom + 22} textAnchor="middle" fill="#455a64" fontSize="11">{exam.name.length > 16 ? `${exam.name.slice(0, 15)}…` : exam.name}</text>
                </g>
              ))}
              <text x="18" y={(plot.top + plot.bottom) / 2} transform={`rotate(-90 18 ${(plot.top + plot.bottom) / 2})`} textAnchor="middle" fill="#546e7a" fontSize="12">偏差値</text>
            </svg>
          </div>
        )}
      </section>

      <section style={{ ...box, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#263238', fontSize: 17 }}>要チェック</h3>
          <span style={{ color: '#78909c', fontSize: 12 }}>選択した試験のうち、直近の受験回から偏差値が5以上下落</span>
        </div>
        {drops.length === 0 ? (
          <p style={{ margin: 0, color: '#78909c', fontSize: 13 }}>該当する学生はいません。</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {drops.map((row) => (
              <button key={row.id} type="button" onClick={() => open(row.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, textAlign: 'left', padding: '11px 12px', border: '1px solid #f3c5bd', borderRadius: 7, background: '#fffaf9', color: '#4e342e', cursor: 'pointer' }}>
                <span><strong>{row.name}</strong><span style={{ display: 'block', marginTop: 3, fontSize: 12, color: '#78909c' }}>{row.previous.examName} → {row.latest.examName}</span></span>
                <span style={{ whiteSpace: 'nowrap', fontWeight: 700, color: '#c62828' }}>−{row.drop}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
