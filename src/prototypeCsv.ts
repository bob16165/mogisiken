import type { PrototypeStudent, TrackData, TrackId, TrackQuestion } from './qualificationPrototypeData';
import { TRACK_LABELS, QUALIFICATION_RULES } from './qualificationPrototypeData';

export interface RangeInput {
  section: '前半' | '後半';
  start: number;
  end: number;
  subject: string;
}

export interface TrackFiles {
  front: File | null;
  back: File | null;
  answers: File | null;
  sources: File | null;
}

// UTF-8（BOM除去）で読み、文字化けしていればShift-JISで読み直す。
export async function decodeCsvFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('shift_jis').decode(buffer);
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

// 4択以外（空欄・Excelの時刻化けなど）は0（未回答）として扱う。
function toChoice(value: string | undefined) {
  const text = (value ?? '').trim();
  return text === '1' || text === '2' || text === '3' || text === '4' ? Number(text) : 0;
}

interface StudentAnswers {
  ids: string[];
  rows: Map<string, number[]>;
  invalid: number;
}

function parseStudentCsv(text: string): StudentAnswers {
  const [header, ...body] = parseCsv(text);
  const columns = header.map((name) => /^Q(\d+)$/i.exec(name.trim())?.[1]).map((no) => (no ? Number(no) : 0));
  const rows = new Map<string, number[]>();
  const ids: string[] = [];
  let invalid = 0;
  body.forEach((cells, rowIndex) => {
    const id = (cells[0] ?? '').trim() || `#row${rowIndex}`;
    const answers: number[] = [];
    columns.forEach((no, column) => {
      if (!no) return;
      const raw = (cells[column] ?? '').trim();
      const choice = toChoice(raw);
      if (raw !== '' && choice === 0) invalid += 1;
      answers[no] = choice;
    });
    ids.push(id);
    rows.set(id, answers);
  });
  return { ids, rows, invalid };
}

// 「模範解答前半」「出題基準前半」のように、前半と後半が横に並ぶ1行形式。
function parseHorizontal(text: string, label: string) {
  const [header, values] = parseCsv(text);
  if (!header || !values) throw new Error(`${label}CSVに見出し行とデータ行が必要です。`);
  const front: string[] = [];
  const back: string[] = [];
  let target: string[] | null = null;
  header.forEach((name, column) => {
    const title = name.trim();
    if (title.includes('後半')) target = back;
    else if (title.includes('前半')) target = front;
    const no = /^Q(\d+)$/i.exec(title)?.[1];
    if (no && target) target[Number(no)] = (values[column] ?? '').trim();
  });
  if (front.length === 0 && back.length === 0) {
    throw new Error(`${label}CSVの見出しに「${label}前半」「${label}後半」が見つかりません。`);
  }
  return { front, back };
}

export interface BuildResult {
  track: TrackData;
  warnings: string[];
}

export async function buildTrackFromFiles(
  type: TrackId,
  files: TrackFiles,
  ranges: RangeInput[],
  standardNames: Map<string, string>,
): Promise<BuildResult> {
  const label = TRACK_LABELS[type];
  if (!files.front && !files.back) throw new Error(`${label}: 前半または後半のCSVを選択してください。`);
  if (!files.answers) throw new Error(`${label}: 模範解答CSVを選択してください。`);

  const front = files.front ? parseStudentCsv(await decodeCsvFile(files.front)) : null;
  const back = files.back ? parseStudentCsv(await decodeCsvFile(files.back)) : null;
  const key = parseHorizontal(await decodeCsvFile(files.answers), '模範解答');
  const source = files.sources ? parseHorizontal(await decodeCsvFile(files.sources), '出題基準') : null;

  const sectionKeys = { 前半: key.front, 後半: key.back } as const;
  const sectionSources = { 前半: source?.front ?? [], 後半: source?.back ?? [] } as const;
  const questions: TrackQuestion[] = [];
  const problems: string[] = [];
  for (const section of ['前半', '後半'] as const) {
    if ((section === '前半' ? front : back) === null) {
      if (ranges.some((range) => range.section === section)) {
        problems.push(`${section}のCSVが未選択ですが、問題範囲マスターに${section}の範囲があります。`);
      }
      continue;
    }
    const sorted = ranges.filter((range) => range.section === section).sort((a, b) => a.start - b.start);
    for (const range of sorted) {
      for (let no = range.start; no <= range.end; no += 1) {
        const answer = toChoice(sectionKeys[section][no]);
        if (answer === 0) problems.push(`${section}Q${no}の模範解答が1〜4ではありません（「${sectionKeys[section][no] ?? '空欄'}」）。`);
        const rawStandard = (sectionSources[section][no] ?? '').trim();
        const standardNo = /^\d+$/.test(rawStandard) ? Number(rawStandard) : null;
        questions.push({
          section,
          no,
          subject: range.subject,
          standardNo,
          standardName: standardNo === null
            ? ''
            : standardNames.get(`${range.subject}:${standardNo}`) ?? `出題基準${standardNo}`,
          key: answer,
        });
      }
    }
  }
  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join('\n');
    throw new Error(`${label}: ${shown}${problems.length > 5 ? `\n…ほか${problems.length - 5}件` : ''}`);
  }
  if (questions.length === 0) throw new Error(`${label}: 登録できる問題がありません。問題範囲マスターを確認してください。`);

  const ids = front?.ids ?? back?.ids ?? [];
  const warnings: string[] = [];
  const picks = ids.map((id, rowIndex) => {
    const frontRow = front?.rows.get(id);
    // 後半CSVの学籍番号が空欄でも、行順で前半の学生と対応づける。
    const backRow = back ? back.rows.get(id) ?? back.rows.get(back.ids[rowIndex]) : undefined;
    return questions.map((question) => {
      const row = question.section === '前半' ? frontRow : backRow;
      return row?.[question.no] ?? 0;
    });
  });
  if (front && back && back.ids.some((id) => !front.rows.has(id) && !id.startsWith('#row'))) {
    warnings.push('前半と後半で学籍番号が一致しない行があります。行順で対応づけました。');
  }
  const invalid = (front?.invalid ?? 0) + (back?.invalid ?? 0);
  if (invalid > 0) warnings.push(`解答欄に1〜4以外の値が${invalid}件あり、未回答として採点しました（Excelの時刻化けなど）。`);

  const students: PrototypeStudent[] = ids.map((id) => ({ id, name: '（氏名未登録）' }));
  return {
    track: {
      id: type,
      label,
      questions,
      subjects: [...new Set(questions.map((question) => question.subject))],
      students,
      picks,
      rules: type === 'acupuncture'
        ? QUALIFICATION_RULES
        : [{ qualification: 'massage', label: TRACK_LABELS.massage, excludedSubject: '' }],
    },
    warnings,
  };
}
