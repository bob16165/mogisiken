import { allStudentScores, maxOf, questionDetails } from '../qualCore';
import type { ExamData, TrackData } from '../qualCore';
import { wrongHighRate } from '../prototypeAnalysis';

type PdfWindow = Window & {
  html2canvas?: (element: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  jspdf?: { jsPDF: new (orientation: string, unit: string, format: string) => PdfDocument };
};

interface PdfDocument {
  internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
  addImage: (data: string, type: string, x: number, y: number, width: number, height: number) => void;
  addPage: () => void;
  save: (filename: string) => void;
}

export function sanitizeFilename(name: string) {
  return name ? name.replace(/[\\/:*?"<>|]/g, '_') : '未選択試験';
}

function escapeCsv(value: string | number) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(rows: (string | number)[][], filename: string) {
  const content = rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
  const blob = new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// 柔整版の一覧結果CSVと同じ並び（順位・学籍番号・氏名・総合点・資格別合計・科目別点）。
export function buildListCsv(track: TrackData): (string | number)[][] {
  const total = allStudentScores(track, () => true);
  const rules = track.rules.map((rule) => ({
    rule,
    scores: allStudentScores(track, (question) => question.subject !== rule.excludedSubject),
  }));
  const subjects = track.subjects.map((subject) => ({
    subject,
    scores: allStudentScores(track, (question) => question.subject === subject),
  }));
  const header = ['順位', '学籍番号', '氏名', '総合点', ...rules.map(({ rule }) => rule.label), ...subjects.map(({ subject }) => subject)];
  const order = track.students.map((_, index) => index).sort((a, b) => total[b] - total[a]);
  return [
    header,
    ...order.map((index, position) => [
      position + 1,
      track.students[index].id,
      track.students[index].name,
      total[index],
      ...rules.map(({ scores }) => scores[index]),
      ...subjects.map(({ scores }) => scores[index]),
    ]),
  ];
}

interface Stats { score: number; max: number; rate: number; rank: number; averageRate: number; stdDev: number }

function statsOf(scores: number[], max: number, index: number): Stats {
  const rates = scores.map((value) => (max > 0 ? (value / max) * 100 : 0));
  const average = rates.reduce((sum, value) => sum + value, 0) / Math.max(rates.length, 1);
  const variance = rates.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(rates.length, 1);
  const score = scores[index];
  return {
    score,
    max,
    rate: max > 0 ? Math.round((score / max) * 1000) / 10 : 0,
    rank: [...scores].sort((a, b) => b - a).findIndex((value) => value === score) + 1,
    averageRate: average,
    stdDev: Math.sqrt(variance),
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration> = {}, text?: string) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function sectionBase() {
  return el('div', {
    width: '794px', padding: '20px 24px', background: '#ffffff', color: '#222',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif", boxSizing: 'border-box',
  });
}

const title = (text: string) => el('h2', { margin: '0 0 12px 0', fontSize: '20px', color: '#1976d2' }, text);

function scoreItem(name: string, stats: Stats) {
  const item = el('div', { padding: '5px 2px 8px', borderBottom: '1px solid #dbe3ec' });
  const header = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' });
  header.append(
    el('strong', { fontSize: '11px' }, name),
    el('span', { fontSize: '10px', fontWeight: '700', color: '#334155' }, `${stats.score}/${stats.max}  ${stats.rate}%  ${stats.rank}位`),
  );
  item.appendChild(header);
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  const graph = el('div', { position: 'relative', height: '15px', margin: '5px 0 3px', overflow: 'hidden', borderRadius: '2px', background: '#e0e0e0' });
  graph.appendChild(el('div', { position: 'absolute', inset: '0 auto 0 0', width: `${clamp(stats.rate)}%`, background: 'linear-gradient(90deg, #2196f3, #64b5f6)' }));
  [
    { position: stats.averageRate - stats.stdDev, color: '#ff9800' },
    { position: stats.averageRate, color: '#4caf50' },
    { position: stats.averageRate + stats.stdDev, color: '#f44336' },
  ].forEach((marker) => graph.appendChild(el('div', { position: 'absolute', top: '0', bottom: '0', left: `${clamp(marker.position)}%`, width: '2px', background: marker.color })));
  item.appendChild(graph);
  const legend = el('div', { display: 'flex', justifyContent: 'space-between', gap: '4px', fontSize: '8px' });
  [
    [`D: ${clamp(stats.averageRate - stats.stdDev).toFixed(1)}%`, '#ff9800'],
    [`Ave.: ${clamp(stats.averageRate).toFixed(1)}%`, '#4caf50'],
    [`A: ${clamp(stats.averageRate + stats.stdDev).toFixed(1)}%`, '#f44336'],
  ].forEach(([text, color]) => legend.appendChild(el('span', { color }, text)));
  item.appendChild(legend);
  return item;
}

function buildCover(track: TrackData, index: number, examName: string) {
  const cover = sectionBase();
  cover.appendChild(title('個人試験結果'));
  cover.appendChild(el('div', { marginBottom: '18px', fontSize: '14px', color: '#475569' }, examName || '試験名未設定'));

  const info = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', marginBottom: '18px', padding: '12px 14px', background: '#f1f5f9', borderLeft: '4px solid #1976d2' });
  const student = track.students[index];
  [['学籍番号', student.id || '-'], ['氏名', student.name || '-']].forEach(([label, value]) => {
    const item = el('div', { fontSize: '13px' });
    item.append(el('span', { color: '#64748b' }, `${label}: `), el('strong', {}, value));
    info.appendChild(item);
  });
  cover.appendChild(info);

  const totalScores = allStudentScores(track, () => true);
  const total = statsOf(totalScores, maxOf(track, () => true), index);
  const ruleStats = track.rules.map((rule) => {
    const filter = (question: { subject: string }) => question.subject !== rule.excludedSubject;
    return { rule, stats: statsOf(allStudentScores(track, filter), maxOf(track, filter), index) };
  });
  const cards: [string, string][] = [
    ['総合得点', `${total.score}/${total.max}`],
    ['得点率', `${total.rate}%`],
    ['順位', `${total.rank}位 / ${track.students.length}名`],
    ['クラス平均', `${Math.round(total.averageRate * 10) / 10}%`],
    ...ruleStats.map(({ rule, stats }): [string, string] => [`${rule.label}合計`, `${stats.score}/${stats.max} (${stats.rate}%)`]),
  ];
  const totals = el('div', { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '14px' });
  cards.forEach(([label, value]) => {
    const item = el('div', { padding: '8px 5px', background: '#eaf3fb', borderTop: '2px solid #1976d2', textAlign: 'center' });
    item.append(el('div', { marginBottom: '4px', fontSize: '10px', color: '#475569' }, label), el('strong', { fontSize: '11px' }, value));
    totals.appendChild(item);
  });
  cover.appendChild(totals);

  cover.appendChild(el('h3', { margin: '0 0 4px 0', fontSize: '12px', color: '#334155' }, '得点率'));
  const grid = el('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '20px' });
  track.subjects.forEach((subject) => {
    const filter = (question: { subject: string }) => question.subject === subject;
    grid.appendChild(scoreItem(subject, statsOf(allStudentScores(track, filter), maxOf(track, filter), index)));
  });
  ruleStats.forEach(({ rule, stats }) => grid.appendChild(scoreItem(`${rule.label}合計`, stats)));
  cover.appendChild(grid);
  return cover;
}

function buildHighRateWrongSection(exam: ExamData, track: TrackData, index: number) {
  const section = sectionBase();
  section.appendChild(title('正答率50%以上で誤答した問題 TOP5'));
  section.appendChild(el('div', { marginBottom: '12px', fontSize: '12px', color: '#475569' }, `${exam.name || '試験名未設定'} / 本人が誤答した問題のうち、正答率50%以上`));

  const hits = wrongHighRate({ exam, track, index }, 50);
  const bySubject = new Map<string, typeof hits>();
  hits.forEach((hit) => bySubject.set(hit.subject, [...(bySubject.get(hit.subject) ?? []), hit]));
  const groups = [...bySubject.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'))
    .slice(0, 5);

  if (groups.length > 0) {
    const ranks = el('div', { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginBottom: '12px' });
    groups.forEach(([subject, items], position) => {
      const item = el('div', { padding: '7px 6px', background: position === 0 ? '#fff1e6' : '#f1f5f9', borderTop: `2px solid ${position === 0 ? '#e76f00' : '#64748b'}`, textAlign: 'center' });
      item.append(el('div', { fontSize: '10px', fontWeight: '700' }, `${position + 1}. ${subject}`), el('strong', { fontSize: '13px' }, `${items.length}問`));
      ranks.appendChild(item);
    });
    section.appendChild(ranks);
  }

  const rows = groups.flatMap(([, items]) => [...items].sort((a, b) => b.correctRate - a.correctRate));
  section.appendChild(el('div', { margin: '0 0 6px 0', fontSize: '10px', fontWeight: '700', color: '#334155' }, `TOP5科目の該当問題: ${rows.length}問`));
  if (rows.length === 0) {
    section.appendChild(el('div', { padding: '12px', background: '#f1f5f9', fontSize: '12px' }, '正答率50%以上で誤答した問題はありません。'));
    return section;
  }
  const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '9px' });
  const headRow = el('tr');
  ['科目', '問題', '正答率', '出題基準', '本人解答', '正答'].forEach((text, position) => {
    headRow.appendChild(el('th', { padding: '5px 4px', background: '#334155', color: '#fff', textAlign: position === 3 ? 'left' : 'center' }, text));
  });
  const head = el('thead');
  head.appendChild(headRow);
  table.appendChild(head);
  const body = el('tbody');
  rows.forEach((hit, rowIndex) => {
    const row = el('tr');
    [hit.subject, hit.label, `${hit.correctRate}%`, hit.area, hit.userAnswer ? String(hit.userAnswer) : '-', String(hit.correctAnswer)].forEach((text, cellIndex) => {
      const cell = el('td', { padding: '4px', borderBottom: '1px solid #dbe3ec', textAlign: cellIndex === 3 ? 'left' : 'center' }, text);
      if (rowIndex % 2 === 1) cell.style.background = '#f8fafc';
      if (cellIndex === 2) {
        cell.style.fontWeight = '700';
        cell.style.color = hit.correctRate >= 70 ? '#c2410c' : '#a16207';
      }
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function buildSubjectSections(track: TrackData, index: number, hideAnswers: boolean) {
  return track.subjects.map((subject) => {
    const section = sectionBase();
    section.appendChild(title(`${subject} 問題別詳細`));
    const rows = questionDetails(track, index, subject);
    if (rows.length === 0) {
      section.appendChild(el('div', { padding: '10px', background: '#f5f5f5', borderRadius: '6px' }, '問題詳細データがありません'));
      return section;
    }
    const table = el('table', { width: '100%', borderCollapse: 'collapse', fontSize: '12px' });
    const headers = hideAnswers ? ['問題番号', '自分の解答'] : ['問題番号', '自分の解答', '正答', '結果', '正答率', '出題基準'];
    const headRow = el('tr', { background: '#757575', color: '#fff' });
    headers.forEach((text) => headRow.appendChild(el('th', { padding: '6px', border: '1px solid #999', textAlign: text === '出題基準' ? 'left' : 'center' }, text)));
    const head = el('thead');
    head.appendChild(headRow);
    table.appendChild(head);
    const body = el('tbody');
    rows.forEach((row, rowIndex) => {
      const tr = el('tr', { background: rowIndex % 2 === 0 ? '#fff' : '#f9f9f9' });
      const cells = hideAnswers
        ? [row.label, row.userAnswer ? String(row.userAnswer) : '-']
        : [row.label, row.userAnswer ? String(row.userAnswer) : '-', String(row.correctAnswer), row.isCorrect ? '○' : '×', `${row.correctRate}%`, row.source];
      cells.forEach((text, cellIndex) => {
        const td = el('td', { padding: '6px', border: '1px solid #ddd', textAlign: !hideAnswers && cellIndex === 5 ? 'left' : 'center' }, text);
        if (!hideAnswers && cellIndex === 3) td.style.color = row.isCorrect ? '#2e7d32' : '#c62828';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    section.appendChild(table);
    return section;
  });
}

async function renderPdf(cover: HTMLElement, sections: HTMLElement[], filename: string) {
  const win = window as PdfWindow;
  if (!win.html2canvas || !win.jspdf) throw new Error('PDF生成ライブラリの読み込みに失敗しました');
  const pdf = new win.jspdf.jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const pages = [cover, ...sections];
  for (let i = 0; i < pages.length; i += 1) {
    const canvas = await win.html2canvas(pages[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    let width = pageWidth - margin * 2;
    let height = (canvas.height * width) / canvas.width;
    if (height > pageHeight - margin * 2) {
      height = pageHeight - margin * 2;
      width = (canvas.width * height) / canvas.height;
    }
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', (pageWidth - width) / 2, margin, width, height);
  }
  pdf.save(filename);
}

export async function downloadStudentPdf(exam: ExamData, track: TrackData, index: number, hideAnswers: boolean) {
  const root = el('div', { position: 'fixed', left: '-10000px', top: '0', width: '794px', background: '#fff' });
  const cover = buildCover(track, index, exam.name);
  const sections = [buildHighRateWrongSection(exam, track, index), ...buildSubjectSections(track, index, hideAnswers)];
  root.append(cover, ...sections);
  document.body.appendChild(root);
  try {
    await renderPdf(cover, sections, `個別結果_${sanitizeFilename(track.students[index].id || 'student')}_${sanitizeFilename(exam.name)}.pdf`);
  } finally {
    document.body.removeChild(root);
  }
}
