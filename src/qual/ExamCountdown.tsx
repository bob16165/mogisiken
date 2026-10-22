import type { ServerExam } from './QualificationApp';
import type { TrackId } from '../qualCore';

export interface QualSchedule {
  label: string;
  examNumber: number;
  examDate: string;
  sourceUrl: string;
}
export type QualScheduleMap = Partial<Record<'harishi' | 'kyushi' | 'anma', QualSchedule>>;
export interface AcademicInfo { enrollmentYear?: number | string; courseYears?: number | string }

const TRACK_QUALIFICATIONS: Record<TrackId, ('harishi' | 'kyushi' | 'anma')[]> = {
  acupuncture: ['harishi', 'kyushi'],
  massage: ['anma'],
};

const OFFICIAL_URLS = {
  harishi: 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/harishi/',
  kyushi: 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/kyushi/',
  anma: 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/anma/',
};
const LABELS = { harishi: 'はり師', kyushi: 'きゅう師', anma: 'あん摩マッサージ指圧師' };

const academicYear = (date = new Date()) => {
  const japan = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return japan.getUTCFullYear() - (japan.getUTCMonth() < 3 ? 1 : 0);
};

export function isNationalExamYear(info: AcademicInfo | null | undefined) {
  const enrollment = Number(info?.enrollmentYear);
  const years = Number(info?.courseYears);
  if (!Number.isInteger(enrollment) || ![3, 4].includes(years)) return false;
  return academicYear() - enrollment + 1 === years;
}

function examDateOf(schedule: QualSchedule | undefined, info: AcademicInfo | null | undefined) {
  const enrollment = Number(info?.enrollmentYear);
  const years = Number(info?.courseYears);
  const match = String(schedule?.examDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !Number.isInteger(enrollment) || ![3, 4].includes(years)) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year !== enrollment + years) return null;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

const daysUntil = (date: Date) => {
  const now = new Date();
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
};

export function qualificationsOf(exams: ServerExam[]) {
  const wanted = new Set<'harishi' | 'kyushi' | 'anma'>();
  exams.forEach((exam) => (Object.keys(exam.tracks) as TrackId[]).forEach((id) => TRACK_QUALIFICATIONS[id].forEach((key) => wanted.add(key))));
  return (['harishi', 'kyushi', 'anma'] as const).filter((key) => wanted.has(key));
}

export function nationalExamNote(
  exams: ServerExam[],
  info: AcademicInfo | null | undefined,
  schedule: QualScheduleMap | null | undefined,
) {
  if (!isNationalExamYear(info)) return null;
  const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const parts = qualificationsOf(exams).flatMap((key) => {
    const date = examDateOf(schedule?.[key], info);
    if (!date || !schedule?.[key]) return [];
    return [`第${schedule[key]!.examNumber}回${LABELS[key]}国家試験は${dateFormat.format(date)}に${daysUntil(date) < 0 ? '実施されました' : '実施予定です'}`];
  });
  return parts;
}

export function OfficialLinks({ exams }: { exams: ServerExam[] }) {
  return (
    <div style={{ marginTop: 6, fontSize: 13, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {qualificationsOf(exams).map((key) => (
        <a key={key} href={OFFICIAL_URLS[key]} target="_blank" rel="noreferrer" style={{ color: '#1565c0' }}>
          厚生労働省の{LABELS[key]}国家試験に関する公式情報
        </a>
      ))}
    </div>
  );
}

export function ExamCountdown({ exams, info, schedule, loadError }: {
  exams: ServerExam[];
  info: AcademicInfo | null | undefined;
  schedule: QualScheduleMap | null | undefined;
  loadError: boolean;
}) {
  if (!isNationalExamYear(info)) return null;
  const keys = qualificationsOf(exams);
  if (keys.length === 0) return null;
  const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const lines = keys.map((key) => {
    const item = schedule?.[key];
    const date = examDateOf(item, info);
    const remaining = date ? daysUntil(date) : null;
    const message = loadError
      ? '厚生労働省の試験日程を取得できませんでした。公式情報をご確認ください。'
      : !schedule
        ? '厚生労働省の試験日程を確認しています。'
        : !date || !item
          ? '今年度の試験日を確認できません。厚生労働省の公式情報をご確認ください。'
          : remaining! < 0
            ? '今年度の国家試験は終了しました。'
            : remaining === 0
              ? `本日は第${item.examNumber}回${LABELS[key]}国家試験です。`
              : `国家試験まであと ${remaining} 日`;
    return { key, message, date, showLabel: keys.length > 1 };
  });
  return (
    <div style={{ margin: '16px 0 0', padding: '14px 18px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, color: '#5d4037' }}>
      {lines.map(({ key, message, date, showLabel }) => (
        <div key={key} style={{ marginBottom: 4 }}>
          {showLabel && <span style={{ marginRight: 8, fontWeight: 700 }}>{LABELS[key]}</span>}
          <strong style={{ fontSize: 18 }}>{message}</strong>
          {date && <span style={{ marginLeft: 10 }}>（{dateFormat.format(date)}）</span>}
        </div>
      ))}
      <OfficialLinks exams={exams} />
    </div>
  );
}
