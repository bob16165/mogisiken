import { RAW_EXAMS } from './prototypeExamData';
import type { RawTrack } from './prototypeExamData';

export type Qualification = 'needling' | 'moxibustion' | 'massage';
export type TrackId = 'acupuncture' | 'massage';

export interface SchoolGroup {
  id: string;
  name: string;
  hasMassage: boolean;
}

export interface PrototypeStudent {
  id: string;
  name: string;
}

export interface QualificationRule {
  qualification: Qualification;
  label: string;
  excludedSubject: string;
}

export const PASS_RATE = 0.6;

export const SCHOOL_GROUPS: SchoolGroup[] = [
  { id: 'acupuncture-only', name: '鍼灸学科（鍼灸のみ）', hasMassage: false },
  { id: 'acupuncture-and-massage', name: '鍼灸・あん摩学科（両方）', hasMassage: true },
];

// はり師はきゅう理論、きゅう師ははり理論を除いて判定する。
export const QUALIFICATION_RULES: QualificationRule[] = [
  { qualification: 'needling', label: 'はり師', excludedSubject: 'きゅう理論' },
  { qualification: 'moxibustion', label: 'きゅう師', excludedSubject: 'はり理論' },
];

export interface TrackQuestion {
  section: '前半' | '後半';
  no: number;
  subject: string;
  standardNo: number | null;
  standardName: string;
  key: number;
}

export interface TrackData {
  id: TrackId;
  label: string;
  questions: TrackQuestion[];
  subjects: string[];
  students: PrototypeStudent[];
  picks: number[][];
  rules: QualificationRule[];
}

export interface ExamData {
  id: string;
  name: string;
  hideCorrectAnswer?: boolean;
  tracks: Partial<Record<TrackId, TrackData>>;
}

export const TRACK_LABELS: Record<TrackId, string> = {
  acupuncture: '鍼灸（はり師・きゅう師）',
  massage: 'あん摩マッサージ指圧師',
};

const TRACK_RULES: Record<TrackId, QualificationRule[]> = {
  acupuncture: QUALIFICATION_RULES,
  massage: [{ qualification: 'massage', label: 'あん摩マッサージ指圧師', excludedSubject: '' }],
};

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

type QuestionFilter = (question: TrackQuestion) => boolean;

export function maxOf(track: TrackData, filter: QuestionFilter) {
  return track.questions.filter(filter).length;
}

export function scoreOf(track: TrackData, studentIndex: number, filter: QuestionFilter) {
  return track.questions.reduce(
    (total, question, index) =>
      total + (filter(question) && track.picks[studentIndex][index] === question.key ? 1 : 0),
    0,
  );
}

export function allStudentScores(track: TrackData, filter: QuestionFilter) {
  return track.students.map((_, studentIndex) => scoreOf(track, studentIndex, filter));
}

export function passLineOf(maxScore: number) {
  return Math.ceil(maxScore * PASS_RATE - 1e-9);
}

export interface QuestionDetailRow {
  label: string;
  userAnswer: number;
  correctAnswer: number;
  isCorrect: boolean;
  correctRate: number;
  source: string;
}

export function questionDetails(track: TrackData, studentIndex: number, subjectName: string): QuestionDetailRow[] {
  return track.questions.flatMap((question, index) => {
    if (question.subject !== subjectName) return [];
    const correctCount = track.picks.filter((row) => row[index] === question.key).length;
    return [{
      label: `${question.section}${question.no}`,
      userAnswer: track.picks[studentIndex][index],
      correctAnswer: question.key,
      isCorrect: track.picks[studentIndex][index] === question.key,
      correctRate: Math.round((correctCount / track.students.length) * 1000) / 10,
      source: question.standardNo === null ? '基準なし' : question.standardName,
    }];
  });
}
