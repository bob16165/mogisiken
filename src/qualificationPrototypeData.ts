import { RAW_EXAMS } from './prototypeExamData';
import type { RawTrack } from './prototypeExamData';
import { TRACK_LABELS, TRACK_RULES } from './qualCore';
import type { ExamData, TrackData, TrackId, TrackQuestion } from './qualCore';

export * from './qualCore';

export interface SchoolGroup {
  id: string;
  name: string;
  hasMassage: boolean;
}

export const SCHOOL_GROUPS: SchoolGroup[] = [
  { id: 'acupuncture-only', name: '鍼灸学科（鍼灸のみ）', hasMassage: false },
  { id: 'acupuncture-and-massage', name: '鍼灸・あん摩学科（両方）', hasMassage: true },
];

function buildTrack(id: TrackId, raw: RawTrack, studentIds: string[]): TrackData {
  const questions: TrackQuestion[] = raw.questions.map(([section, no, subject, standardNo, standardName, key]) => ({
    section: section === 0 ? '前半' : '後半',
    no,
    subject,
    standardNo,
    standardName,
    key,
  }));
  return {
    id,
    label: TRACK_LABELS[id],
    questions,
    subjects: [...new Set(questions.map((question) => question.subject))],
    students: studentIds.map((studentId) => ({ id: studentId, name: '（氏名未登録）' })),
    picks: raw.picks.map((row) => [...row].map(Number)),
    rules: TRACK_RULES[id],
  };
}

export type BuiltInExam = ExamData & { tracks: Record<TrackId, TrackData> };

export const EXAMS: BuiltInExam[] = RAW_EXAMS.map((exam) => ({
  id: exam.id,
  name: exam.name,
  tracks: {
    acupuncture: buildTrack('acupuncture', exam.tracks.acupuncture, exam.students),
    massage: buildTrack('massage', exam.tracks.massage, exam.students),
  },
}));

