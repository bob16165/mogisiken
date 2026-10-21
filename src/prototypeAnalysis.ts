import type { ExamData, TrackData } from './qualCore';

export interface HistoryEntry {
  exam: ExamData;
  track: TrackData;
  index: number;
}

export interface QuestionHit {
  examName: string;
  label: string;
  subject: string;
  area: string;
  correctRate: number;
  userAnswer: number;
  correctAnswer: number;
  wrongCount?: number;
}

const areaOf = (standardName: string) => standardName || '領域未設定';

export function isCorrect(track: TrackData, student: number, question: number) {
  return track.picks[student][question] === track.questions[question].key;
}

export function totalScores(track: TrackData) {
  return track.students.map((_, student) =>
    track.questions.reduce((sum, _q, question) => sum + (isCorrect(track, student, question) ? 1 : 0), 0));
}

export function questionRates(track: TrackData) {
  const count = Math.max(track.students.length, 1);
  return track.questions.map((_q, question) => {
    let correct = 0;
    track.students.forEach((_s, student) => { if (isCorrect(track, student, question)) correct += 1; });
    return Math.round((correct / count) * 1000) / 10;
  });
}

// 問題の正誤と総合点のピアソン相関（識別係数）。
export function discriminations(track: TrackData) {
  const totals = totalScores(track);
  const n = totals.length;
  const mean = totals.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  const varT = totals.reduce((a, b) => a + (b - mean) ** 2, 0);
  return track.questions.map((_q, question) => {
    const xs = track.students.map((_s, student) => (isCorrect(track, student, question) ? 1 : 0));
    const meanX = xs.reduce((a: number, b: number) => a + b, 0) / Math.max(n, 1);
    const varX = xs.reduce((a: number, b: number) => a + (b - meanX) ** 2, 0);
    if (varX === 0 || varT === 0) return 0;
    const cov = xs.reduce((a: number, x: number, i: number) => a + (x - meanX) * (totals[i] - mean), 0);
    return cov / Math.sqrt(varX * varT);
  });
}

export function subjectScoreTable(track: TrackData, student: number) {
  const totals = track.subjects.map((subject) => {
    const indexes = track.questions.flatMap((question, i) => (question.subject === subject ? [i] : []));
    const scores = track.students.map((_s, s) => indexes.filter((i) => isCorrect(track, s, i)).length);
    const max = indexes.length;
    const mean = scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1);
    const std = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(scores.length, 1));
    const score = scores[student];
    return {
      subject,
      max,
      score,
      rate: max > 0 ? (score / max) * 100 : 0,
      deviation: std === 0 ? 50 : 50 + (10 * (score - mean)) / std,
    };
  });
  return totals;
}

// 他の受験者の正答率が一定以上なのに本人が誤答した問題。
export function wrongHighRate(entry: HistoryEntry, threshold: number): QuestionHit[] {
  const { track, index, exam } = entry;
  const rates = questionRates(track);
  return track.questions.flatMap((question, i) => {
    if (isCorrect(track, index, i) || rates[i] < threshold) return [];
    return [{
      examName: exam.name,
      label: `${question.section}${question.no}`,
      subject: question.subject,
      area: areaOf(question.standardName),
      correctRate: rates[i],
      userAnswer: track.picks[index][i],
      correctAnswer: question.key,
    }];
  });
}

export function countBy<T>(items: T[], key: (item: T) => string) {
  const map = new Map<string, number>();
  items.forEach((item) => map.set(key(item), (map.get(key(item)) ?? 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}

export interface ActionPlan {
  subject: string;
  score: number;
  max: number;
  rate: number;
  deviation: number;
  trend: number | null;
  priority: number;
  reasons: string[];
  missed: QuestionHit[];
  focusAreas: [string, number][];
}

// 優先度 = 失点の大きさ・得点率の低さ・偏差値の低さ・取りこぼし・悪化傾向を合算した指標。
export function buildGuidance(history: HistoryEntry[]) {
  const current = history[history.length - 1];
  const table = subjectScoreTable(current.track, current.index);
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const previousTable = previous ? subjectScoreTable(previous.track, previous.index) : null;
  const recent = history.slice(-3);
  const missedAll = recent.flatMap((entry) => wrongHighRate(entry, 70));
  const focusAll = history.flatMap((entry) => wrongHighRate(entry, 50));
  const totalLost = table.reduce((sum, row) => sum + (row.max - row.score), 0) || 1;

  const plans: ActionPlan[] = table.map((row) => {
    const before = previousTable?.find((item) => item.subject === row.subject);
    const trend = before ? row.rate - before.rate : null;
    const missed = missedAll.filter((hit) => hit.subject === row.subject);
    const focus = focusAll.filter((hit) => hit.subject === row.subject);
    const priority =
      ((row.max - row.score) / totalLost) * 35 +
      ((100 - row.rate) / 100) * 25 +
      (Math.max(0, 50 - row.deviation) / 20) * 15 +
      Math.min(missed.length, 10) * 1.5 +
      (trend !== null && trend < 0 ? Math.min(-trend, 20) / 2 : 0);
    const reasons = [`得点率 ${row.rate.toFixed(1)}%・偏差値 ${row.deviation.toFixed(1)}`];
    if (missed.length > 0) reasons.push(`他の受験者の正答率70%以上の取りこぼし ${missed.length}問`);
    if (trend !== null && trend < 0) reasons.push(`前回より得点率 ${Math.abs(trend).toFixed(1)}ポイント低下`);
    return {
      subject: row.subject,
      score: row.score,
      max: row.max,
      rate: row.rate,
      deviation: row.deviation,
      trend,
      priority,
      reasons,
      missed: missed.sort((a, b) => b.correctRate - a.correctRate),
      focusAreas: countBy(focus, (hit) => hit.area).slice(0, 3),
    };
  }).sort((a, b) => b.priority - a.priority);

  const top = plans.slice(0, 3);
  const average = table.reduce((sum, row) => sum + row.rate, 0) / Math.max(table.length, 1);
  return {
    plans,
    top,
    analyzedExamCount: history.length,
    summary: `${top.map((plan) => plan.subject).join('・')}の優先度が高くなっています。科目別の平均得点率は${average.toFixed(1)}%で、` +
      `解析対象は${history.length}回分です。`,
  };
}

export interface WeakAreaRow {
  area: string;
  wrong: number;
  asked: number;
  recentWrong: number;
  recentAsked: number;
}

export const RECENT_EXAM_COUNT = 3;

// 領域ごとに、全試験累積と直近3回の誤答回数・出題数を集計する。
export function buildWeakAreas(history: HistoryEntry[], bySubjectOnly = false) {
  const recentStart = Math.max(0, history.length - RECENT_EXAM_COUNT);
  const rows = new Map<string, Map<string, WeakAreaRow>>();
  history.forEach(({ track, index }, position) => {
    track.questions.forEach((question, i) => {
      const area = bySubjectOnly ? '' : areaOf(question.standardName);
      const bySubject = rows.get(question.subject) ?? new Map<string, WeakAreaRow>();
      const row = bySubject.get(area) ?? { area, wrong: 0, asked: 0, recentWrong: 0, recentAsked: 0 };
      const wrong = isCorrect(track, index, i) ? 0 : 1;
      row.asked += 1;
      row.wrong += wrong;
      if (position >= recentStart) {
        row.recentAsked += 1;
        row.recentWrong += wrong;
      }
      bySubject.set(area, row);
      rows.set(question.subject, bySubject);
    });
  });
  const order = history[history.length - 1]?.track.subjects ?? [];
  return [...rows.entries()]
    .map(([subject, areas]) => ({
      subject,
      areas: [...areas.values()]
        .filter((row) => row.wrong > 0)
        .sort((x, y) => y.wrong - x.wrong || y.wrong / y.asked - x.wrong / x.asked || x.area.localeCompare(y.area, 'ja')),
    }))
    .filter((group) => group.areas.length > 0)
    .sort((x, y) => order.indexOf(x.subject) - order.indexOf(y.subject));
}

export function buildClassReview(track: TrackData, examName = '') {
  const totals = totalScores(track);
  const n = totals.length;
  const order = totals.map((score, student) => ({ score, student })).sort((a, b) => b.score - a.score);
  const lowCount = Math.max(1, Math.round(n * 0.3));
  const highCount = Math.max(1, Math.round(n * 0.3));
  const lower = order.slice(n - lowCount).map((item) => item.student);
  const middle = order.slice(highCount, n - lowCount).map((item) => item.student);
  const rates = questionRates(track);
  const disc = discriminations(track);

  const groupAreas = (students: number[]) => {
    const rows = new Map<string, { subject: string; area: string; questions: number[]; wrong: number }>();
    track.questions.forEach((question, i) => {
      const key = `${question.subject}\u0000${areaOf(question.standardName)}`;
      const row = rows.get(key) ?? { subject: question.subject, area: areaOf(question.standardName), questions: [], wrong: 0 };
      row.questions.push(i);
      row.wrong += students.filter((s) => !isCorrect(track, s, i)).length;
      rows.set(key, row);
    });
    return [...rows.values()].map((row) => ({
      subject: row.subject,
      area: row.area,
      questionCount: row.questions.length,
      wrong: row.wrong,
      averageRate: Math.round((row.questions.reduce((a, i) => a + rates[i], 0) / row.questions.length) * 10) / 10,
      averageDisc: row.questions.reduce((a, i) => a + disc[i], 0) / row.questions.length,
    }));
  };

  const bySubject = <T extends { subject: string }>(rows: T[]) =>
    track.subjects.map((subject) => ({ subject, rows: rows.filter((row) => row.subject === subject) }));

  const lecture = bySubject(groupAreas(middle).sort((a, b) => b.wrong - a.wrong).slice(0, 12))
    .map((group) => ({ ...group, rows: group.rows.slice(0, 3) }))
    .filter((group) => group.rows.length > 0);
  const remedial = bySubject(groupAreas(lower).filter((row) => row.averageDisc >= 0.2).sort((a, b) => b.averageDisc - a.averageDisc))
    .filter((group) => group.rows.length > 0);
  const discQuestions = track.questions.flatMap((question, i) =>
    disc[i] >= 0.3
      ? [{
        subject: question.subject,
        label: `${question.section}${question.no}`,
        area: areaOf(question.standardName),
        r: disc[i],
        lowerWrong: lower.filter((s) => !isCorrect(track, s, i)).length,
      }]
      : []);

  const wrongPairs: QuestionHit[] = [];
  track.students.forEach((_s, student) => {
    wrongHighRate({ exam: { id: '', name: examName, tracks: {} }, track, index: student }, 50).forEach((hit) => wrongPairs.push(hit));
  });

  return {
    studentCount: n,
    average: totals.reduce((a, b) => a + b, 0) / Math.max(n, 1),
    highest: order[0]?.score ?? 0,
    lowest: order[n - 1]?.score ?? 0,
    max: track.questions.length,
    lowCount,
    middleCount: middle.length,
    lecture,
    remedial,
    discQuestions,
    subjectTop5: countBy(wrongPairs, (hit) => hit.subject).slice(0, 5),
    wrongPairs,
  };
}
