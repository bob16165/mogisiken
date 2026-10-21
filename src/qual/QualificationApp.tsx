import { buildListCsv, downloadCsv, downloadStudentPdf, sanitizeFilename } from './exports';
import { Fragment, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { buildTrackFromFiles, decodeCsvFile, parseCsv } from '../prototypeCsv';
import { SAMPLE_DOWNLOADS } from './samples';
import type { TrackFiles } from '../prototypeCsv';
import { RegradeDialog } from './RegradeDialog';
import type { RegradeOverrides, RegradeTrack } from './RegradeDialog';
import { DeviationTrend } from './DeviationTrend';
import { StudyCoach, WeeklyPlanTracker } from './StudyTools';
import { HighRateWrongPanel, StudyGuidance, studentHighRateHits, TeacherReview, WeakAreasPanel } from '../prototypeAnalysisViews';
import type { HistoryEntry } from '../prototypeAnalysis';
import {
  allStudentScores,
  maxOf,
  passLineOf,
  questionDetails,
  TRACK_LABELS,
  TRACK_RULES,
} from '../qualCore';
import type { ExamData, QuestionDetailRow, TrackData, TrackId } from '../qualCore';
import {
  DEFAULT_RANGES_ACUPUNCTURE,
  DEFAULT_RANGES_MASSAGE,
  STANDARD_NAMES,
  SUBJECTS_ACUPUNCTURE,
  SUBJECTS_MASSAGE,
} from '../qualMaster';

export interface ServerTrack {
  questions: TrackData['questions'];
  subjects: string[];
  students: TrackData['students'];
  picks: number[][];
  displayPicks?: number[];
  regrade?: { questions: TrackData['questions']; overrides: RegradeOverrides };
}

export interface ServerExam {
  batchId: string;
  name: string;
  hideCorrectAnswer: boolean;
  isPublished: boolean;
  tracks: Partial<Record<TrackId, ServerTrack>>;
}

export interface SaveExamInput {
  examName: string;
  hideCorrectAnswer: boolean;
  tracks: Partial<Record<TrackId, ServerTrack>>;
}

export interface SchoolOption {
  id: string;
  name: string;
  qualification_group?: string;
}

export interface QualificationAppProps {
  role: 'student' | 'teacher' | 'admin';
  userName: string;
  studentId: string;
  groupId: 'acupuncture' | 'acupuncture_massage';
  schools: SchoolOption[];
  selectedSchoolId: string;
  onSchoolChange: (schoolId: string) => void;
  exams: ServerExam[];
  loading: boolean;
  loadError: string;
  onSave: (input: SaveExamInput) => Promise<void>;
  onUpdate: (batchId: string, patch: { isPublished?: boolean }) => Promise<void>;
  onDelete: (batchId: string) => Promise<void>;
  onRegrade: (batchId: string, overrides: Partial<Record<TrackId, RegradeOverrides>>) => Promise<void>;
  onOpenPasswordChange: () => void;
  onLogout: () => void;
  studentCount: number;
  onStudentMasterUpload: (
    master: Record<string, StudentMasterInput>,
    replace: boolean,
    resetParentPasswords: boolean,
  ) => Promise<StudentCredential[] | null>;
}

export interface StudentMasterInput {
  name: string;
  password: string;
  enrollmentYear: number | null;
  courseYears: number | null;
}

export interface StudentCredential {
  loginId: string;
  studentId: string;
  name: string;
  password: string;
  parentLoginId?: string;
  parentPassword?: string;
}

interface AppGroup {
  id: string;
  name: string;
  hasMassage: boolean;
}

const GROUPS: Record<QualificationAppProps['groupId'], AppGroup> = {
  acupuncture: { id: 'acupuncture', name: '鍼灸学科（鍼灸のみ）', hasMassage: false },
  acupuncture_massage: { id: 'acupuncture_massage', name: '鍼灸・あん摩学科（両方）', hasMassage: true },
};

const MASTER_SUBJECTS: Record<TrackId, string[]> = {
  acupuncture: SUBJECTS_ACUPUNCTURE,
  massage: SUBJECTS_MASSAGE,
};

function toExamData(exam: ServerExam): ExamData {
  const tracks: ExamData['tracks'] = {};
  (Object.keys(exam.tracks) as TrackId[]).forEach((id) => {
    const track = exam.tracks[id];
    if (!track) return;
    tracks[id] = { ...track, id, label: TRACK_LABELS[id], rules: TRACK_RULES[id] };
  });
  return { id: exam.batchId, name: exam.name, hideCorrectAnswer: exam.hideCorrectAnswer, tracks };
}

type RegistrationType = 'acupuncture' | 'massage' | 'both';
type ExamSection = '前半' | '後半';

interface QuestionRange {
  section: ExamSection;
  start: number | '';
  end: number | '';
  subject: string;
}

function hasRangeNumbers(range: QuestionRange): range is QuestionRange & { start: number; end: number } {
  return range.start !== '' && range.end !== '';
}

const SECTION_LIMITS: Record<ExamSection, number> = { 前半: 128, 後半: 122 };

function defaultRangesFor(type: Exclude<RegistrationType, 'both'>): QuestionRange[] {
  return (type === 'acupuncture' ? DEFAULT_RANGES_ACUPUNCTURE : DEFAULT_RANGES_MASSAGE).map((range) => ({ ...range }));
}

const BUILT_IN_STANDARD_NAMES = new Map<string, string>(STANDARD_NAMES);

function scoreRate(score: number, maxScore: number) {
  return maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
}

function deviation(score: number, scores: number[]) {
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance = scores.reduce((sum, value) => sum + (value - average) ** 2, 0) / scores.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation === 0
    ? 50
    : Math.round((((score - average) / standardDeviation) * 10 + 50) * 10) / 10;
}

function rateStats(scores: number[], max: number) {
  const rates = scores.map((value) => (max > 0 ? (value / max) * 100 : 0));
  const average = rates.reduce((sum, value) => sum + value, 0) / rates.length;
  const variance = rates.reduce((sum, value) => sum + (value - average) ** 2, 0) / rates.length;
  return { average, stdDev: Math.sqrt(variance) };
}

function rank(score: number, scores: number[]) {
  return [...scores].sort((left, right) => right - left).findIndex((value) => value === score) + 1;
}

export default function QualificationApp(props: QualificationAppProps) {
  const { role, groupId, exams, onSave, onUpdate, onDelete, onLogout } = props;
  const isStudent = role === 'student';
  const group = GROUPS[groupId];
  const [studentIndex, setStudentIndex] = useState(0);
  const [examId, setExamId] = useState('');
  const [fromTeacher, setFromTeacher] = useState(false);
  const [trackId, setTrackId] = useState<TrackId>('acupuncture');
  const [viewMode, setViewMode] = useState<'student' | 'teacher' | 'trend' | 'registration' | 'students'>(isStudent ? 'student' : 'teacher');
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [showRegrade, setShowRegrade] = useState(false);
  const allExams = exams.map((item) => ({ server: item, data: toExamData(item) }));
  const visibleEntries = allExams.filter(({ data }) =>
    data.tracks.acupuncture || (group.hasMassage && data.tracks.massage));
  const visibleExams = visibleEntries.map(({ data }) => data);
  const currentEntry = visibleEntries.find(({ data }) => data.id === examId) ?? visibleEntries[visibleEntries.length - 1];
  const exam = currentEntry?.data;
  const wantedTrack = group.hasMassage ? trackId : 'acupuncture';
  const track = exam
    ? (exam.tracks[wantedTrack] ?? exam.tracks.acupuncture ?? exam.tracks.massage as TrackData)
    : undefined;
  const hideAnswers = Boolean(exam?.hideCorrectAnswer) && !fromTeacher;
  const registerExam = async (input: SaveExamInput) => {
    await onSave(input);
    setExamId('');
    setStudentIndex(0);
    setExpandedSubject(null);
    setFromTeacher(false);
    setViewMode('teacher');
  };

  const toolbarHeader = (
    <header style={styles.header}>
      <div style={{ ...styles.headerInner, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={styles.title}>模擬試験分析システム</h1>
          {!isStudent && <p style={styles.subtitle}>教員モード: {props.userName}</p>}
          {exam && <p style={styles.subtitle}>📋 {exam.name}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {!isStudent && currentEntry && (
            <button type="button" onClick={() => setShowRegrade(true)} style={{ ...styles.headerButton, background: '#e8eaf6', color: '#283593' }}>採点訂正・再集計</button>
          )}
          {role === 'teacher' && (
            <button type="button" onClick={props.onOpenPasswordChange} style={{ ...styles.headerButton, background: '#fff', color: '#1565c0' }}>パスワード変更</button>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <button type="button" onClick={onLogout} style={styles.logoutButton}>ログアウト</button>
            {!isStudent && (
              <>
                <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>お問い合わせはコチラから</div>
                <a
                  href="mailto:inoue@mea-analysis.jp?subject=%E6%A8%A1%E6%93%AC%E8%A9%A6%E9%A8%93%E7%B5%90%E6%9E%9C%E9%96%B2%E8%A6%A7%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0%E3%81%AE%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B"
                  style={{ marginTop: 5, padding: '7px 12px', fontSize: 12, color: '#fff', background: '#1565c0', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 5, fontWeight: 600, textDecoration: 'none' }}
                >
                  メールで問い合わせる
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );

  if (!exam || !track) {
    return (
      <main style={styles.page}>
        {toolbarHeader}
        <div style={styles.content}>
          {props.role === 'admin' && props.schools.length > 0 && (
            <SchoolPicker schools={props.schools} value={props.selectedSchoolId} onChange={props.onSchoolChange} />
          )}
          {props.loading ? <p>読み込み中…</p> : props.loadError ? (
            <p role="alert" style={styles.formError}>{props.loadError}</p>
          ) : isStudent ? (
            <p style={{ textAlign: 'center', color: '#555', margin: '40px 0' }}>公開されている試験結果はまだありません。</p>
          ) : (
            <>
              <p style={{ color: '#555' }}>登録済みの試験がありません。学生を登録してから、試験のCSVを登録してください。</p>
              <StudentMasterView count={props.studentCount} onUpload={props.onStudentMasterUpload} />
              <RegistrationView key={group.id} group={group} onRegister={registerExam} />
            </>
          )}
        </div>
      </main>
    );
  }
  const STUDENTS = track.students;
  const ownIndex = isStudent ? STUDENTS.findIndex((item) => item.id === props.studentId) : -1;
  const activeIndex = isStudent ? Math.max(0, ownIndex) : Math.min(studentIndex, STUDENTS.length - 1);
  const student = STUDENTS[activeIndex];

  const examPosition = visibleExams.findIndex((item) => item.id === exam.id);
  const history: HistoryEntry[] = visibleExams.slice(0, examPosition + 1).flatMap((item) => {
    const itemTrack = item.tracks[track.id];
    const index = itemTrack ? itemTrack.students.findIndex((entry) => entry.id === student.id) : -1;
    return itemTrack && index >= 0 ? [{ exam: item, track: itemTrack, index }] : [];
  });

  const overallMax = maxOf(track, () => true);
  const overallScores = allStudentScores(track, () => true);
  const overallScore = overallScores[activeIndex];
  const overallRate = rateStats(overallScores, overallMax);
  const subjectRows = track.subjects.map((subject) => {
    const filter = (question: { subject: string }) => question.subject === subject;
    const scores = allStudentScores(track, filter);
    return {
      subject: { name: subject },
      max: maxOf(track, filter),
      score: scores[activeIndex],
      scores,
    };
  });
  const qualificationRows = track.rules.map((rule) => {
    const filter = (question: { subject: string }) => question.subject !== rule.excludedSubject;
    return {
      rule,
      max: maxOf(track, filter),
      scores: allStudentScores(track, filter),
    };
  });

  const runAction = async (action: () => Promise<void>) => {
    setActionError('');
    try {
      await action();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '操作に失敗しました。');
    }
  };

  return (
    <main style={styles.page}>
      {toolbarHeader}
      {showRegrade && currentEntry && (
        <RegradeDialog
          examName={currentEntry.server.name}
          tracks={(Object.keys(currentEntry.server.tracks) as TrackId[]).flatMap((trackKey): RegradeTrack[] => {
            const regrade = currentEntry.server.tracks[trackKey]?.regrade;
            return regrade ? [{ trackId: trackKey, questions: regrade.questions, overrides: regrade.overrides }] : [];
          })}
          onClose={() => setShowRegrade(false)}
          onApply={(overrides) => props.onRegrade(currentEntry.server.batchId, overrides)}
        />
      )}

      <div style={styles.content}>
        {props.role === 'admin' && props.schools.length > 0 && (
          <SchoolPicker schools={props.schools} value={props.selectedSchoolId} onChange={props.onSchoolChange} />
        )}
        {actionError && <p role="alert" style={styles.formError}>{actionError}</p>}

        <section style={styles.toolbar} aria-label="表示対象の選択">
          {!isStudent && (
            <label style={styles.selectLabel} htmlFor="student-select">
              受験者
              <select
                id="student-select"
                value={activeIndex}
                onChange={(event) => setStudentIndex(Number(event.target.value))}
                style={styles.select}
                disabled={viewMode !== 'student'}
              >
                {STUDENTS.map((item, index) => (
                  <option key={item.id} value={index}>{item.id} - {item.name}</option>
                ))}
              </select>
            </label>
          )}
          {!isStudent && (
            <label style={styles.selectLabel} htmlFor="view-mode">
              表示画面
              <select
                id="view-mode"
                value={viewMode}
                onChange={(event) => {
                  if (event.target.value === 'student' || event.target.value === 'teacher' || event.target.value === 'trend' || event.target.value === 'registration' || event.target.value === 'students') {
                    setFromTeacher(false);
                    setViewMode(event.target.value);
                  }
                }}
                style={styles.select}
              >
                <option value="teacher">教員用成績一覧</option>
                <option value="trend">偏差値推移</option>
                <option value="student">学生用結果画面</option>
                <option value="registration">CSV登録</option>
                <option value="students">学生登録</option>
              </select>
            </label>
          )}
          <label style={styles.selectLabel} htmlFor="exam-select">
            試験
            <select
              id="exam-select"
              value={exam.id}
              onChange={(event) => {
                setExamId(event.target.value);
                setExpandedSubject(null);
              }}
              style={styles.select}
            >
              {visibleExams.map((item) => (
                <option key={item.id} value={item.id}>{item.name}{item.hideCorrectAnswer ? '（卒判）' : ''}</option>
              ))}
            </select>
          </label>
          {group.hasMassage && (
            <label style={styles.selectLabel} htmlFor="track-select">
              資格
              <select
                id="track-select"
                value={track.id}
                onChange={(event) => {
                  setTrackId(event.target.value === 'massage' ? 'massage' : 'acupuncture');
                  setExpandedSubject(null);
                }}
                style={styles.select}
              >
                {(Object.keys(TRACK_LABELS) as TrackId[]).filter((id) => exam.tracks[id]).map((id) => (
                  <option key={id} value={id}>{TRACK_LABELS[id]}</option>
                ))}
              </select>
            </label>
          )}
        </section>

        {!isStudent && currentEntry && (
          <div style={styles.examActions}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280 }}>
              <strong style={{ fontSize: 14 }}>公開設定</strong>
              {visibleEntries.map(({ server }) => (
                <div key={server.batchId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '6px 10px', background: '#fff', borderRadius: 4 }}>
                  <span style={{ fontSize: 13 }}>{server.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={server.isPublished}
                    onClick={() => runAction(() => onUpdate(server.batchId, { isPublished: !server.isPublished }))}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{ position: 'relative', width: 40, height: 22, borderRadius: 11, background: server.isPublished ? '#4CAF50' : '#9E9E9E', transition: 'background .2s' }}>
                      <span style={{ position: 'absolute', top: 2, left: server.isPublished ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: server.isPublished ? '#2e7d32' : '#616161', minWidth: 36 }}>{server.isPublished ? '公開' : '非公開'}</span>
                  </button>
                </div>
              ))}
            </div>
            <DownloadPanel exam={exam} track={track} />
            <button
              type="button"
              style={styles.deleteButton}
              onClick={() => {
                if (window.confirm(`「${exam.name}」を削除します。元に戻せません。よろしいですか？`)) {
                  runAction(async () => {
                    await onDelete(currentEntry.server.batchId);
                    setExamId('');
                  });
                }
              }}
            >
              この試験を削除
            </button>
          </div>
        )}

        {viewMode === 'students' ? (
          <StudentMasterView count={props.studentCount} onUpload={props.onStudentMasterUpload} />
        ) : viewMode === 'registration' ? (
          <RegistrationView key={group.id} group={group} onRegister={registerExam} />
        ) : viewMode === 'trend' ? (
          <DeviationTrend
            key={track.id}
            exams={visibleExams}
            trackId={track.id}
            currentExamId={exam.id}
            onOpenStudent={(studentId, targetExamId) => {
              const target = visibleExams.find((item) => item.id === targetExamId)?.tracks[track.id];
              const found = target ? target.students.findIndex((item) => item.id === studentId) : -1;
              setExamId(targetExamId);
              setStudentIndex(found >= 0 ? found : 0);
              setExpandedSubject(null);
              setFromTeacher(true);
              setViewMode('student');
            }}
          />
        ) : viewMode === 'teacher' ? (
          <>
          <TeacherClassView
            students={STUDENTS}
            overallScores={overallScores}
            overallMax={overallMax}
            qualifications={track.id === 'massage' ? [] : qualificationRows}
            subjects={subjectRows.map(({ subject, max, scores }) => ({ name: subject.name, max, scores }))}
            onSelectStudent={(index) => {
              setStudentIndex(index);
              setExpandedSubject(null);
              setFromTeacher(true);
              setViewMode('student');
            }}
          />
          <TeacherReview track={track} examName={exam.name} />
          </>
        ) : (
          <>
        <h2 style={{ textAlign: 'center', color: '#333', margin: '24px 0 20px' }}>試験結果</h2>
        <div style={{ background: '#f5f5f5', padding: 15, borderRadius: 8, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>学生情報</h3>
          <p style={{ margin: '5px 0' }}><strong>受験番号:</strong> {student.id}</p>
          <p style={{ margin: '5px 0' }}><strong>氏名:</strong> {student.name}</p>
        </div>

        <CollapsibleSection title="総合成績" initialExpanded>
          <div style={{ background: '#e3f2fd', padding: 15, borderRadius: 8 }}>
            <strong>総合点:</strong>{' '}
            <span style={{ color: '#1976d2', fontWeight: 'bold' }}>{overallScore}/{overallMax}</span>
          </div>
          <div style={{ marginTop: 20 }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: 14 }}>総合点得点率</h4>
            <BarChart
              scoreRate={scoreRate(overallScore, overallMax)}
              averageRate={overallRate.average}
              stdDeviation={overallRate.stdDev}
            />
            <StatGrid
              rate={scoreRate(overallScore, overallMax)}
              rankText={`${rank(overallScore, overallScores)}位`}
              dev={deviation(overallScore, overallScores)}
              average={overallRate.average}
            />
          </div>
          {track.id === 'massage' ? (
            <div style={{ marginTop: 12, fontSize: 13, color: '#555' }}>合格ライン {passLineOf(overallMax)}問（{overallScore >= passLineOf(overallMax) ? '到達' : `あと ${passLineOf(overallMax) - overallScore} 問`}）</div>
          ) : track.rules.map((rule) => {
            const counted = (question: { subject: string }) => question.subject !== rule.excludedSubject;
            const max = maxOf(track, counted);
            const score = allStudentScores(track, counted)[activeIndex];
            const passLine = passLineOf(max);
            const passed = score >= passLine;
            return (
              <div key={rule.qualification} style={{ marginTop: 14, background: '#f5f5f5', padding: '10px 15px', borderRadius: 8 }}>
                <strong>{rule.label} 合計:</strong> {score}/{max}（合格ライン {passLine}問）
                <span style={{ ...styles.badge, ...(passed ? styles.badgePass : styles.badgeFail), marginLeft: 8 }}>
                  {passed ? '合格ライン到達' : `あと ${passLine - score} 問`}
                </span>
                {rule.excludedSubject && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#666' }}>※ {rule.excludedSubject}を除く</span>
                )}
              </div>
            );
          })}
        </CollapsibleSection>

        <CollapsibleSection title="科目別成績" initialExpanded>
          <table style={{ width: '100%', borderCollapse: 'collapse', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', background: 'white' }}>
            <thead>
              <tr style={{ background: '#1976d2', color: 'white' }}>
                {['科目', '得点', '得点率', '順位', '偏差値'].map((label) => (
                  <th key={label} style={{ padding: 12, textAlign: 'left' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subjectRows.map(({ subject, max, score, scores }, index) => {
                const isExpanded = expandedSubject === subject.name;
                const { average, stdDev } = rateStats(scores, max);
                return (
                  <Fragment key={subject.name}>
                    <tr
                      style={{ background: index % 2 === 0 ? 'white' : '#f9f9f9', cursor: 'pointer' }}
                      onClick={() => setExpandedSubject(isExpanded ? null : subject.name)}
                    >
                      <td style={{ padding: 12 }}><strong>{subject.name}</strong></td>
                      <td style={{ padding: 12 }}>{score}/{max}</td>
                      <td style={{ padding: 12 }}>{scoreRate(score, max)}%</td>
                      <td style={{ padding: 12 }}>{rank(score, scores)}位</td>
                      <td style={{ padding: 12 }}>{deviation(score, scores).toFixed(1)}</td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={5} style={{ padding: 20, background: '#f8fbff' }}>
                          <h4 style={{ margin: '0 0 10px 0' }}>{subject.name}得点率</h4>
                          <BarChart scoreRate={scoreRate(score, max)} averageRate={average} stdDeviation={stdDev} />
                          <QuestionDetailTable rows={questionDetails(track, activeIndex, subject.name)} hideAnswers={hideAnswers} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </CollapsibleSection>

        {history.length > 0 && (
          <>
            <StudyGuidance history={history} hideAnswers={hideAnswers} isTeacher={fromTeacher} />
            <WeakAreasPanel history={history} hideAnswers={hideAnswers} />
            {!hideAnswers && (
              <HighRateWrongPanel hits={studentHighRateHits(history)} title="正答率50%以上で誤答した問題" />
            )}
            <div style={{ marginTop: 20 }}>
              <StudyCoach hits={hideAnswers ? [] : studentHighRateHits(history)} subjects={track.subjects} hideAnswers={hideAnswers} />
              <WeeklyPlanTracker history={history} hideAnswers={hideAnswers} storageId={`${student.id}_${exam.id}_${track.id}`} />
            </div>
          </>
        )}
          </>
        )}
      </div>
    </main>
  );
}

function SchoolPicker({ schools, value, onChange }: { schools: SchoolOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <label style={{ ...styles.selectLabel, maxWidth: 320, marginBottom: 12 }}>
      学校（学科）
      <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.select}>
        {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
      </select>
    </label>
  );
}

function RegistrationView({ group, onRegister }: { group: AppGroup; onRegister: (input: SaveExamInput) => Promise<void> }) {
  const [registrationType, setRegistrationType] = useState<RegistrationType>('acupuncture');
  const [examName, setExamName] = useState('');
  const [rangesByQualification, setRangesByQualification] = useState({
    acupuncture: defaultRangesFor('acupuncture'),
    massage: defaultRangesFor('massage'),
  });
  const [files, setFiles] = useState<Record<string, string>>({});
  const [fileObjects, setFileObjects] = useState<Record<string, File | null>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setFile = (key: string, file: File | null | undefined) => {
    setFiles((current) => ({ ...current, [key]: file?.name ?? '' }));
    setFileObjects((current) => ({ ...current, [key]: file ?? null }));
  };
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [hideCorrectAnswer, setHideCorrectAnswer] = useState(false);

  const selectedTypes: Exclude<RegistrationType, 'both'>[] =
    registrationType === 'both' ? ['acupuncture', 'massage'] : [registrationType];
  const tracks = selectedTypes.map((type) => ({
    type,
    label: TRACK_LABELS[type],
    subjects: MASTER_SUBJECTS[type],
    ranges: rangesByQualification[type],
  }));

  const updateRange = (
    type: Exclude<RegistrationType, 'both'>,
    index: number,
    update: Partial<QuestionRange>,
  ) => {
    setRangesByQualification((current) => ({
      ...current,
      [type]: current[type].map((range, rangeIndex) =>
        rangeIndex === index ? { ...range, ...update } : range,
      ),
    }));
  };

  const addRange = (type: Exclude<RegistrationType, 'both'>) => {
    setRangesByQualification((current) => ({
      ...current,
      [type]: [...current[type], { section: '前半', start: '', end: '', subject: '' }],
    }));
  };

  const removeRange = (type: Exclude<RegistrationType, 'both'>, index: number) => {
    setRangesByQualification((current) => ({
      ...current,
      [type]: current[type].filter((_, rangeIndex) => rangeIndex !== index),
    }));
  };

  const resetRanges = (type: Exclude<RegistrationType, 'both'>) => {
    setRangesByQualification((current) => ({ ...current, [type]: defaultRangesFor(type) }));
  };

  const validateRanges = (ranges: QuestionRange[]) => {
    const errors: string[] = [];
    for (const section of ['前半', '後半'] as const) {
      const sectionRanges = ranges.filter((range) => range.section === section);
      for (const [index, range] of sectionRanges.entries()) {
        if (!hasRangeNumbers(range) || !range.subject) {
          errors.push(`${section}に未入力の範囲があります`);
          continue;
        }
        if (range.start < 1 || range.end < range.start || range.end > SECTION_LIMITS[section]) {
          errors.push(`${section}は1〜${SECTION_LIMITS[section]}の範囲で指定してください`);
        }
        if (sectionRanges.slice(index + 1).some((other) =>
          hasRangeNumbers(other) &&
          range.start <= other.end && other.start <= range.end,
        )) {
          errors.push(`${section}の問題範囲が重複しています`);
        }
      }
    }
    return [...new Set(errors)];
  };

  const countsFor = (ranges: QuestionRange[], section: ExamSection) =>
    ranges.reduce((total, range) =>
      range.section === section && hasRangeNumbers(range) &&
      range.start >= 1 && range.end >= range.start && range.end <= SECTION_LIMITS[section]
        ? total + range.end - range.start + 1
        : total,
    0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWarnings([]);
    if (!examName.trim()) {
      setError('試験名を入力してください。');
      setShowPreview(false);
      return;
    }
    const errors = tracks.flatMap(({ label, ranges }) => validateRanges(ranges).map((message) => `${label}: ${message}`));
    if (errors.length > 0) {
      setError(errors[0]);
      setShowPreview(false);
      return;
    }
    setIsSubmitting(true);
    try {
      const built: Partial<Record<TrackId, TrackData>> = {};
      const collected: string[] = [];
      for (const { type, ranges } of tracks) {
        const trackFiles: TrackFiles = {
          front: fileObjects[`${type}-前半`] ?? null,
          back: fileObjects[`${type}-後半`] ?? null,
          answers: fileObjects[`${type}-answers`] ?? null,
          sources: fileObjects[`${type}-sources`] ?? null,
        };
        const result = await buildTrackFromFiles(
          type,
          trackFiles,
          ranges.filter(hasRangeNumbers),
          BUILT_IN_STANDARD_NAMES,
        );
        built[type] = result.track;
        collected.push(...result.warnings.map((message) => `${TRACK_LABELS[type]}: ${message}`));
      }
      const payload: SaveExamInput['tracks'] = {};
      (Object.keys(built) as TrackId[]).forEach((type) => {
        const item = built[type];
        if (item) {
          payload[type] = {
            questions: item.questions,
            subjects: item.subjects,
            students: item.students,
            picks: item.picks,
          };
        }
      });
      await onRegister({ examName: examName.trim(), hideCorrectAnswer, tracks: payload });
      setError('');
      setWarnings(collected);
      setShowPreview(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'CSVの読み込みに失敗しました。');
      setShowPreview(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.registrationPanel}>
      <div style={styles.registrationHeader}>
        <div>
          <p style={styles.sectionLabel}>CSV登録</p>
          <h2 style={styles.sectionTitle}>模擬試験の登録</h2>
        </div>
        <span style={styles.groupBadge}>{group.name}</span>
      </div>
      <aside style={styles.registrationNotice}>
        資格の登録方法を選ぶと、対応する科目・問題範囲マスターが自動で表示されます。
        範囲は試験ごとに変更できます。問題番号の上限は前半Q128・後半Q122です。
        前半・後半CSV（学籍番号＋Q列）と模範解答CSV（「模範解答前半」「模範解答後半」の横並び1行）を読み込んで採点します。登録した試験は学校（学科）ごとに保存され、「学生に公開する」をオンにすると学生が閲覧できます。
      </aside>

      <label style={styles.formLabel}>
        試験名 <span style={{ color: '#c62828' }}>*</span>
        <input
          required
          value={examName}
          onChange={(event) => setExamName(event.target.value)}
          placeholder="例：第1回模擬試験"
          style={styles.textInput}
        />
      </label>

      <fieldset style={styles.registrationChoices}>
        <legend style={styles.formLegend}>今回登録する資格</legend>
        <label style={styles.choiceOption}>
          <input
            type="radio"
            name="registration-type"
            checked={registrationType === 'acupuncture'}
            onChange={() => { setRegistrationType('acupuncture'); setShowPreview(false); }}
          />
          鍼灸（はり師・きゅう師）
        </label>
        {group.hasMassage && (
          <>
            <label style={styles.choiceOption}>
              <input
                type="radio"
                name="registration-type"
                checked={registrationType === 'massage'}
                onChange={() => { setRegistrationType('massage'); setShowPreview(false); }}
              />
              あん摩マッサージ指圧師のみ
            </label>
            <label style={styles.choiceOption}>
              <input
                type="radio"
                name="registration-type"
                checked={registrationType === 'both'}
                onChange={() => { setRegistrationType('both'); setShowPreview(false); }}
              />
              鍼灸とあん摩を登録（資格ごとに別々の問題セット）
            </label>
          </>
        )}
      </fieldset>

      {tracks.map(({ type, label, subjects, ranges }) => (
        <section key={type} style={styles.registrationTrack}>
          <h3 style={styles.trackTitle}>{label}</h3>
          {(['前半', '後半'] as const).map((section) => {
            const fileKey = `${type}-${section}`;
            return (
              <label key={fileKey} style={styles.fileLabel}>
                {section}データ（Q1〜Q{SECTION_LIMITS[section]}）{trackFileSuffix(type)}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(fileKey, event.target.files?.[0])}
                  style={styles.fileInput}
                />
                <span style={styles.fileName}>{files[fileKey] || 'CSVファイルを選択'}</span>
              </label>
            );
          })}
          <div style={styles.fileGrid}>
            {(['answers', 'sources'] as const).map((kind) => {
              const key = `${type}-${kind}`;
              const labelText = kind === 'answers' ? '模範解答CSV' : '出題基準CSV';
              return (
                <label key={key} style={styles.fileLabel}>
                  {labelText}{kind === 'answers' ? '' : '（任意）'}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setFile(key, event.target.files?.[0])}
                    style={styles.fileInput}
                  />
                  <span style={styles.fileName}>{files[key] || (kind === 'answers' ? 'CSVファイルを選択' : 'CSVファイルを選択（任意）')}</span>
                </label>
              );
            })}
          </div>

          <div style={styles.masterPanel}>
            <div style={styles.masterHeader}>
              <div>
                <h4 style={styles.masterTitle}>問題範囲マスター</h4>
                <p style={styles.masterDescription}>
                  科目は資格に応じて自動設定済みです。問題数は模擬試験に合わせて範囲を調整してください。
                </p>
              </div>
              <div style={styles.masterActions}>
                <button type="button" onClick={() => addRange(type)} style={styles.secondaryButton}>範囲を追加</button>
                <button type="button" onClick={() => resetRanges(type)} style={styles.secondaryButton}>初期値に戻す</button>
              </div>
            </div>
            <div style={styles.rangeSummary}>
              {(['前半', '後半'] as const).map((section) => (
                <span key={section}>
                  {section}: {countsFor(ranges, section)}問 / 上限{SECTION_LIMITS[section]}問
                </span>
              ))}
            </div>
            {validateRanges(ranges).map((message) => (
              <p key={message} role="alert" style={styles.rangeWarning}>{message}</p>
            ))}
            <div style={{ overflowX: 'auto' }}>
              <table style={styles.rangeTable}>
                <thead>
                  <tr style={styles.rangeTableHead}>
                    <th style={styles.rangeCell}>データ</th>
                    <th style={styles.rangeCell}>開始</th>
                    <th style={styles.rangeCell}>終了</th>
                    <th style={styles.rangeCell}>科目</th>
                    <th style={styles.rangeCell}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ranges.map((range, index) => (
                    <tr key={`${range.section}-${range.start}-${range.subject}-${index}`}>
                      <td style={styles.rangeCell}>
                        <select
                          aria-label={`${label} 範囲${index + 1} データ`}
                          value={range.section}
                          onChange={(event) => {
                            if (event.target.value === '前半' || event.target.value === '後半') {
                              updateRange(type, index, { section: event.target.value });
                            }
                          }}
                          style={styles.rangeSelect}
                        >
                          <option value="前半">前半 Q</option>
                          <option value="後半">後半 Q</option>
                        </select>
                      </td>
                      <td style={styles.rangeCell}>
                        <input
                          aria-label={`${label} 範囲${index + 1} 開始`}
                          type="number"
                          min={1}
                          max={SECTION_LIMITS[range.section]}
                          value={range.start}
                          onChange={(event) => updateRange(type, index, { start: event.target.value === '' ? '' : Number(event.target.value) })}
                          style={styles.rangeNumber}
                        />
                      </td>
                      <td style={styles.rangeCell}>
                        <input
                          aria-label={`${label} 範囲${index + 1} 終了`}
                          type="number"
                          min={1}
                          max={SECTION_LIMITS[range.section]}
                          value={range.end}
                          onChange={(event) => updateRange(type, index, { end: event.target.value === '' ? '' : Number(event.target.value) })}
                          style={styles.rangeNumber}
                        />
                      </td>
                      <td style={styles.rangeCell}>
                        <select
                          aria-label={`${label} 範囲${index + 1} 科目`}
                          value={range.subject}
                          onChange={(event) => updateRange(type, index, { subject: event.target.value })}
                          style={styles.subjectSelect}
                        >
                          <option value="">科目を選択</option>
                          {subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
                        </select>
                      </td>
                      <td style={styles.rangeCell}>
                        <button type="button" onClick={() => removeRange(type, index)} style={styles.removeButton}>削除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}

      <label style={styles.graduationExamOption}>
        <input
          type="checkbox"
          checked={hideCorrectAnswer}
          onChange={(event) => setHideCorrectAnswer(event.target.checked)}
          style={{ width: 18, height: 18, margin: '0 8px 0 0' }}
        />
        <span>
          <strong>卒業判定試験（学生に正答・結果・正答率・出典を非表示）</strong>
          <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
            チェックすると、学生側には正答や結果などの情報を表示しない設定になります。
          </small>
        </span>
      </label>

      {error && <p role="alert" style={{ ...styles.formError, whiteSpace: 'pre-line' }}>{error}</p>}
      {warnings.map((message) => <p key={message} style={styles.rangeWarning}>{message}</p>)}
      <div style={styles.submitRow}>
        <button type="submit" disabled={isSubmitting} style={styles.submitButton}>{isSubmitting ? '読み込み中…' : 'データをアップロード'}</button>
      </div>
      {showPreview && (
        <section aria-live="polite" style={styles.previewPanel}>
          <h3 style={{ margin: '0 0 8px' }}>アップロード内容</h3>
          <p style={{ margin: '4px 0' }}><strong>試験名:</strong> {examName}</p>
          <p style={{ margin: '4px 0' }}><strong>登録形式:</strong> {tracks.map(({ label }) => label).join(' / ')}</p>
          <p style={{ margin: '4px 0' }}>
            <strong>学生への正答等の表示:</strong> {hideCorrectAnswer ? '非表示（卒業判定試験）' : '表示'}
          </p>
          {tracks.map(({ type, label, ranges }) => (
            <p key={type} style={{ margin: '4px 0' }}>
              <strong>{label}:</strong> 前半 {countsFor(ranges, '前半')}問、後半 {countsFor(ranges, '後半')}問
            </p>
          ))}
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#596579' }}>
            登録しました。公開設定は試験選択の下で変更できます。
          </p>
        </section>
      )}
      <SampleLinks />
    </form>
  );
}

function SampleLinks() {
  return (
    <div style={{ marginTop: 25, padding: 15, background: '#f5f5f5', borderRadius: 6, fontSize: 12, color: '#666' }}>
      <strong>📝 CSVサンプルをダウンロード:</strong>
      <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {SAMPLE_DOWNLOADS.map((sample) => (
          <a
            key={sample.label}
            href="#"
            onClick={(event) => { event.preventDefault(); sample.run(); }}
            style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
          >
            {sample.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function StudentMasterView({ count, onUpload }: { count: number; onUpload: QualificationAppProps['onStudentMasterUpload'] }) {
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [resetParent, setResetParent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!file) {
      setError('学生マスターファイルを選択してください');
      return;
    }
    setBusy(true);
    try {
      const [, ...rows] = parseCsv(await decodeCsvFile(file));
      const master: Record<string, StudentMasterInput> = {};
      for (const cells of rows) {
        const studentId = (cells[0] ?? '').trim();
        const name = (cells[1] ?? '').trim();
        const given = (cells[2] ?? '').trim();
        const password = given.length >= 6 ? given : String(Math.floor(100000 + Math.random() * 900000));
        const year = (cells[3] ?? '').trim();
        const course = (cells[4] ?? '').trim();
        const enrollmentYear = year ? Number(year) : null;
        const courseYears = course ? Number(course) : null;
        if ((year || course) && (!Number.isInteger(enrollmentYear) || (enrollmentYear as number) < 1900 ||
            (enrollmentYear as number) > 2200 || ![3, 4].includes(courseYears as number))) {
          throw new Error(`${studentId || '学生'}の入学年度・課程年数を確認してください（課程年数は3または4）`);
        }
        if (studentId && name) master[studentId] = { name, password, enrollmentYear, courseYears };
      }
      if (Object.keys(master).length === 0) throw new Error('登録できる学生がありません。1行目は見出し、2行目以降に学生を入力してください。');
      const credentials = await onUpload(master, replace, resetParent);
      if (!credentials) throw new Error('学生アカウントの保存に失敗しました。');
      if (credentials.length > 0) {
        const lines = ['ログインID,学籍番号,氏名,初期パスワード,保護者ログインID,保護者初期パスワード',
          ...credentials.map((item) => [item.loginId, item.studentId, item.name, item.password,
            item.parentLoginId ?? '', item.parentPassword ?? '（登録済み・変更なし）'].join(','))];
        const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = '学生ログイン情報.csv';
        link.click();
        URL.revokeObjectURL(link.href);
      }
      setMessage(`${Object.keys(master).length}名の学生アカウントを${replace ? '上書き' : '追加'}しました。ログイン情報CSVを保存しました。`);
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '学生マスターの保存に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={styles.registrationPanel}>
      <p style={styles.sectionLabel}>学生登録</p>
      <h2 style={styles.sectionTitle}>学生氏名マスター登録</h2>
      <p style={{ fontSize: 13, color: '#666' }}>
        現在 {count} 名が登録されています。学籍番号と氏名を登録すると、学生のログインアカウントと氏名表示が作成されます。
      </p>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '12px 0' }}>
        <label style={styles.choiceOption}>
          <input type="radio" checked={!replace} onChange={() => setReplace(false)} /> 追加登録（既存データに追加）
        </label>
        <label style={{ ...styles.choiceOption, color: '#d32f2f' }}>
          <input type="radio" checked={replace} onChange={() => setReplace(true)} /> 上書き登録（年度更新時）
        </label>
      </div>
      <label style={{ ...styles.choiceOption, marginBottom: 10 }}>
        <input type="checkbox" checked={resetParent} onChange={(event) => setResetParent(event.target.checked)} />
        登録済みの保護者パスワードも再発行する（未登録の保護者は常に自動発行）
      </label>
      <input
        type="file"
        accept=".csv"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        style={{ width: '100%', padding: 10, fontSize: 14, border: '2px solid #e0e0e0', borderRadius: 6, marginBottom: 10, boxSizing: 'border-box' }}
      />
      <div style={{ fontSize: 12, color: '#666', marginBottom: 10, lineHeight: 1.7 }}>
        CSVの1行目は見出し、2行目以降に学生を入力してください。列の順番は固定です。<br />
        学籍番号,氏名,初期パスワード(空欄なら自動発行),入学年度,課程年数(3または4)
      </div>
      {error && <p role="alert" style={{ ...styles.formError, whiteSpace: 'pre-line' }}>{error}</p>}
      {message && <p style={{ color: '#2e7d32', fontSize: 14 }}>{message}</p>}
      <div style={styles.submitRow}>
        <button type="submit" disabled={busy} style={styles.submitButton}>{busy ? '登録中…' : '学生を登録'}</button>
      </div>
      <SampleLinks />
    </form>
  );
}

function trackFileSuffix(type: Exclude<RegistrationType, 'both'>) {
  return type === 'acupuncture' ? '（鍼灸）' : '（あん摩）';
}

interface TeacherQualificationRow {
  rule: TrackData['rules'][number];
  max: number;
  scores: number[];
}

interface TeacherSubjectRow {
  name: string;
  max: number;
  scores: number[];
}

function DownloadPanel({ exam, track }: { exam: ExamData; track: TrackData }) {
  const [kind, setKind] = useState<'csv' | 'pdf'>('csv');
  const [target, setTarget] = useState(0);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (kind === 'csv') {
      downloadCsv(buildListCsv(track), `一覧結果_${sanitizeFilename(exam.name)}.csv`);
      return;
    }
    setBusy(true);
    try {
      await downloadStudentPdf(exam, track, Math.min(target, track.students.length - 1), Boolean(exam.hideCorrectAnswer));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'PDFの作成に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ fontSize: 14 }}>ダウンロード</strong>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={kind} onChange={(event) => setKind(event.target.value === 'pdf' ? 'pdf' : 'csv')} style={styles.select} aria-label="ダウンロード種別">
          <option value="csv">一覧結果CSV</option>
          <option value="pdf">個別結果PDF</option>
        </select>
        {kind === 'pdf' && (
          <select value={target} onChange={(event) => setTarget(Number(event.target.value))} style={styles.select} aria-label="対象学生">
            {track.students.map((student, index) => (
              <option key={student.id} value={index}>{student.id} {student.name}</option>
            ))}
          </select>
        )}
        <button type="button" onClick={run} disabled={busy} style={styles.detailButton}>{busy ? '作成中...' : 'ダウンロード'}</button>
      </div>
    </div>
  );
}

function TeacherClassView({
  students,
  overallScores,
  overallMax,
  qualifications,
  subjects,
  onSelectStudent,
}: {
  students: TrackData['students'];
  overallScores: number[];
  overallMax: number;
  qualifications: TeacherQualificationRow[];
  subjects: TeacherSubjectRow[];
  onSelectStudent: (index: number) => void;
}) {
  const [sortKey, setSortKey] = useState('overall');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const rows = students.map((student, index) => ({
    student,
    index,
    overall: overallScores[index],
    qualifications: qualifications.map(({ rule, scores }) => ({
      label: rule.label,
      score: scores[index],
    })),
    subjects: subjects.map(({ name, scores }) => ({ name, score: scores[index] })),
  }));
  const sortedRows = [...rows].sort((left, right) => {
    const value = (row: (typeof rows)[number]) => {
      if (sortKey === 'studentId') return row.student.id;
      if (sortKey === 'overall') return row.overall;
      if (sortKey.startsWith('qualification:')) {
        return row.qualifications.find((item) => item.label === sortKey.slice(14))?.score ?? 0;
      }
      return row.subjects.find((item) => item.name === sortKey)?.score ?? 0;
    };
    const leftValue = value(left);
    const rightValue = value(right);
    const compare = typeof leftValue === 'string' && typeof rightValue === 'string'
      ? leftValue.localeCompare(rightValue, 'ja', { numeric: true })
      : Number(leftValue) - Number(rightValue);
    if (compare !== 0) return sortDirection === 'desc' ? -compare : compare;
    return left.student.id.localeCompare(right.student.id, 'ja', { numeric: true });
  });
  const sortBy = (key: string) => {
    if (sortKey === key) setSortDirection((direction) => direction === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };
  const indicator = (key: string) => sortKey === key ? (sortDirection === 'desc' ? ' ▼' : ' ▲') : '';
  const averageTotalRate = rateStats(overallScores, overallMax).average;
  const byTotal = students.map((_, index) => index).sort((a, b) => overallScores[b] - overallScores[a]);
  const lowCount = Math.max(1, Math.ceil(students.length * 0.3));
  const topCount = Math.ceil(students.length * 0.3);
  const groupOf = (index: number) => {
    const position = byTotal.indexOf(index);
    return position >= students.length - lowCount ? 'low' : position >= topCount ? 'middle' : 'top';
  };
  const middleCount = Math.max(0, students.length - lowCount - topCount);

  return (
    <section style={styles.teacherPanel}>
      <h2 style={styles.teacherHeading}>全学生成績一覧（{sortKey === 'studentId' ? '学籍番号' : sortKey.startsWith('qualification:') ? sortKey.slice(14) : subjects.some(({ name }) => name === sortKey) ? sortKey : '総合点'}順）</h2>
      <div style={styles.teacherSummary}>
        <div><strong>受験者数:</strong> {students.length}名</div>
        <div><strong>総合平均得点率:</strong> {averageTotalRate.toFixed(1)}%</div>
        {qualifications.map(({ rule, max, scores }) => {
          const passLine = passLineOf(max);
          const passedCount = scores.filter((score) => score >= passLine).length;
          return (
            <div key={rule.qualification}>
              <strong>{rule.label}合格ライン到達:</strong> {passedCount}/{students.length}名
            </div>
          );
        })}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.teacherTable}>
          <thead>
            <tr style={styles.teacherTableHead}>
              <th style={styles.teacherCell}>順位</th>
              <th style={styles.teacherCell}>
                <button type="button" onClick={() => sortBy('studentId')} style={styles.sortButton}>学籍番号{indicator('studentId')}</button>
              </th>
              <th style={{ ...styles.teacherCell, textAlign: 'left' }}>氏名</th>
              <th style={styles.teacherCell}>
                <button type="button" onClick={() => sortBy('overall')} style={styles.sortButton}>総合点{indicator('overall')}</button>
              </th>
              {qualifications.map(({ rule }) => {
                const key = `qualification:${rule.label}`;
                return (
                  <th key={key} style={styles.teacherCell}>
                    <button type="button" onClick={() => sortBy(key)} style={styles.sortButton}>{rule.label}{indicator(key)}</button>
                  </th>
                );
              })}
              {subjects.map(({ name }) => (
                <th key={name} style={styles.teacherCell}>
                  <button type="button" onClick={() => sortBy(name)} style={styles.sortButton}>{name}{indicator(name)}</button>
                </th>
              ))}
              <th style={styles.teacherCell}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, index) => (
              <tr key={row.student.id} style={{ background: index % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                <td style={{ ...styles.teacherCell, fontWeight: 700 }}>
                  <div>{index + 1}</div>
                  {groupOf(row.index) !== 'top' && (
                    <span
                      title={groupOf(row.index) === 'low' ? '補習対象' : '中間層'}
                      aria-label={groupOf(row.index) === 'low' ? '補習対象' : '中間層'}
                      style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: groupOf(row.index) === 'low' ? '#F44336' : '#9e9e9e' }}
                    />
                  )}
                </td>
                <td style={styles.teacherCell}>{row.student.id}</td>
                <td style={{ ...styles.teacherCell, textAlign: 'left' }}>{row.student.name}</td>
                <td style={{ ...styles.teacherCell, fontWeight: 700, color: '#1976d2' }}>
                  {row.overall}/{overallMax}
                </td>
                {row.qualifications.map(({ label, score }) => (
                  <td key={label} style={styles.teacherCell}>{score}</td>
                ))}
                {row.subjects.map(({ name, score }) => (
                  <td key={name} style={styles.teacherCell}>{score}</td>
                ))}
                <td style={styles.teacherCell}>
                  <button type="button" onClick={() => onSelectStudent(row.index)} style={styles.detailButton}>詳細</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ margin: '12px 0', padding: '10px 14px', background: '#f5f7fa', borderRadius: 6, fontSize: 13, lineHeight: 1.8 }}>
        <strong>順位欄の見方</strong>
        <div>印なし：上位30%（{topCount}名）</div>
        <div><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#9e9e9e', marginRight: 6 }} />中間層（{middleCount}名）</div>
        <div><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#F44336', marginRight: 6 }} />下位30%・補習対象（{lowCount}名）</div>
      </div>
      <p style={styles.teacherFootnote}>列見出しを選ぶと、その項目の順に並べ替えできます。詳細から学生側の結果画面を確認できます。</p>
    </section>
  );
}

function CollapsibleSection({ title, children, initialExpanded = false }: { title: string; children: ReactNode; initialExpanded?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  return (
    <section style={{ marginBottom: 20, border: '1px solid #d1d5db', borderRadius: 6, background: 'white', overflow: 'hidden' }}>
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', border: 'none', background: '#f8fafc', color: '#1f2937', cursor: 'pointer', textAlign: 'left', fontSize: 17, fontWeight: 700 }}
      >
        <span>{title}</span>
        <span aria-hidden="true">{isExpanded ? '▼' : '▶'}</span>
      </button>
      {isExpanded && <div style={{ padding: 12 }}>{children}</div>}
    </section>
  );
}

function BarChart({ scoreRate: rate, averageRate, stdDeviation }: { scoreRate: number; averageRate: number; stdDeviation: number }) {
  const dRate = Math.max(0, averageRate - stdDeviation);
  const aRate = Math.min(100, averageRate + stdDeviation);
  const marker = (left: number, color: string, text: string, z: number, offset: number) => (
    <div style={{ position: 'absolute', left: `${left}%`, width: 2, height: '100%', background: color, zIndex: z }}>
      <div style={{ position: 'absolute', top: -20, left: offset, fontSize: 10, color, fontWeight: 'bold' }}>{text}</div>
    </div>
  );
  return (
    <div style={{ marginBottom: 15, paddingTop: 20 }}>
      <div style={{ position: 'relative', height: 40, background: '#e0e0e0', borderRadius: 4 }}>
        {marker(dRate, '#FF9800', 'D', 1, -10)}
        {marker(averageRate, '#4CAF50', 'Ave', 2, -12)}
        {marker(aRate, '#F44336', 'A', 1, -10)}
        <div style={{ position: 'absolute', left: 0, width: `${rate}%`, height: '100%', background: 'linear-gradient(90deg, #2196F3 0%, #64B5F6 100%)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 8, color: 'white', fontWeight: 'bold', fontSize: 14 }}>
          {rate > 10 && `${rate.toFixed(1)}%`}
        </div>
        {rate <= 10 && (
          <div style={{ position: 'absolute', left: `${rate + 2}%`, top: '50%', transform: 'translateY(-50%)', color: '#2196F3', fontWeight: 'bold', fontSize: 14 }}>
            {rate.toFixed(1)}%
          </div>
        )}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: '#666', display: 'flex', justifyContent: 'space-between' }}>
        <span>0%</span>
        <span style={{ fontSize: 10 }}>
          <span style={{ color: '#FF9800' }}>D: {dRate.toFixed(1)}%</span>{' | '}
          <span style={{ color: '#4CAF50' }}>Ave.: {averageRate.toFixed(1)}%</span>{' | '}
          <span style={{ color: '#F44336' }}>A: {aRate.toFixed(1)}%</span>
        </span>
        <span>100%</span>
      </div>
    </div>
  );
}

function StatGrid({ rate, rankText, dev, average }: { rate: number; rankText: string; dev: number; average: number }) {
  return (
    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 13 }}>
      <div><strong>得点率:</strong> {rate}%</div>
      <div><strong>順位:</strong> {rankText}</div>
      <div><strong>偏差値:</strong> {dev.toFixed(1)}</div>
      <div><strong>Ave.:</strong> {average.toFixed(1)}%</div>
    </div>
  );
}

function QuestionDetailTable({ rows, hideAnswers = false }: { rows: QuestionDetailRow[]; hideAnswers?: boolean }) {
  const cell = { padding: 8, textAlign: 'center' } as const;
  return (
    <div style={{ marginTop: 15 }}>
      <h5 style={{ marginBottom: 10 }}>問題別詳細</h5>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <thead>
          <tr style={{ background: '#757575', color: 'white' }}>
            {(hideAnswers ? ['問題番号', '自分の解答'] : ['問題番号', '自分の解答', '正答', '結果', '正答率']).map((label) => (
              <th key={label} style={cell}>{label}</th>
            ))}
            {!hideAnswers && <th style={{ ...cell, textAlign: 'left' }}>出題基準</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.label} style={{ background: index % 2 === 0 ? 'white' : '#f9f9f9' }}>
              <td style={cell}>{row.label}</td>
              <td style={{ ...cell, fontWeight: 'bold', color: hideAnswers ? '#333' : row.isCorrect ? '#4CAF50' : '#F44336' }}>{row.userAnswer || '−'}</td>
              {!hideAnswers && <>
              <td style={{ ...cell, fontWeight: 'bold' }}>{row.correctAnswer}</td>
              <td style={cell}>
                <span style={{ padding: '3px 8px', borderRadius: 3, fontSize: 11, fontWeight: 'bold', background: row.isCorrect ? '#C8E6C9' : '#FFCDD2', color: row.isCorrect ? '#2E7D32' : '#C62828' }}>
                  {row.isCorrect ? '○' : '×'}
                </span>
              </td>
              <td style={{ ...cell, fontSize: 12, fontWeight: 600, color: row.correctRate >= 70 ? '#4CAF50' : row.correctRate >= 50 ? '#FF9800' : '#F44336' }}>
                {row.correctRate}%
              </td>
              <td style={{ padding: 8, fontSize: 12 }}>{row.source}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  headerButton: { padding: '10px 12px', fontSize: 13, border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600 },
  logoutButton: { padding: '8px 16px', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 6, background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 14 },
  examActions: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, margin: '0 0 16px', padding: '10px 14px', background: '#f5f7fa', borderRadius: 6 },
  deleteButton: { padding: '6px 14px', border: '1px solid #c62828', borderRadius: 6, background: '#fff', color: '#c62828', cursor: 'pointer', fontSize: 13 },
  teacherPanel: { padding: 20, maxWidth: 1400, margin: '0 auto', background: '#fff', borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.08)' },
  teacherHeading: { margin: '0 0 20px', color: '#333', fontSize: 21 },
  teacherSummary: { display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginBottom: 16, padding: '14px 16px', background: '#f5f7fa', borderRadius: 6, color: '#334155', fontSize: 14 },
  teacherTable: { width: '100%', borderCollapse: 'collapse', background: 'white', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', fontSize: 13, whiteSpace: 'nowrap' },
  teacherTableHead: { background: '#1976d2', color: 'white' },
  teacherCell: { padding: 10, textAlign: 'center', borderBottom: '1px solid #e5e7eb' },
  sortButton: { padding: 0, border: 'none', background: 'transparent', color: 'white', font: 'inherit', fontWeight: 700, cursor: 'pointer' },
  detailButton: { padding: '5px 12px', fontSize: 12, background: '#1976d2', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' },
  teacherFootnote: { margin: '10px 0 0', color: '#64748b', fontSize: 12 },
  registrationPanel: { padding: 20, maxWidth: 1100, margin: '24px auto', background: '#fff', borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.08)' },
  registrationHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  groupBadge: { padding: '6px 10px', borderRadius: 999, background: '#e3f2fd', color: '#1565c0', fontSize: 12, fontWeight: 700 },
  registrationNotice: { marginBottom: 18, padding: '12px 14px', border: '1px solid #90caf9', borderRadius: 6, background: '#f3f8ff', color: '#334155', fontSize: 13, lineHeight: 1.7 },
  graduationExamOption: { display: 'flex', alignItems: 'flex-start', padding: 15, margin: '18px 0', border: '1px solid #ffb74d', borderRadius: 6, background: '#fff3e0', color: '#e65100', cursor: 'pointer', fontSize: 14, lineHeight: 1.6 },
  formLabel: { display: 'grid', gap: 8, marginBottom: 18, color: '#555', fontSize: 14, fontWeight: 600 },
  textInput: { width: '100%', boxSizing: 'border-box', padding: 12, border: '2px solid #e0e0e0', borderRadius: 6, fontSize: 16 },
  registrationChoices: { display: 'flex', flexWrap: 'wrap', gap: '10px 22px', padding: 14, margin: '0 0 20px', border: '1px solid #d7e1ea', borderRadius: 6 },
  formLegend: { padding: '0 5px', color: '#334155', fontWeight: 700 },
  choiceOption: { display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, cursor: 'pointer' },
  registrationTrack: { marginBottom: 24, padding: 16, border: '1px solid #dbe4ec', borderRadius: 7, background: '#fbfdff' },
  trackTitle: { margin: '0 0 16px', color: '#1565c0', fontSize: 17 },
  fileGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginTop: 12 },
  fileLabel: { display: 'grid', gap: 7, padding: 12, border: '1px solid #dce3ea', borderRadius: 6, background: '#fff', color: '#455a64', fontSize: 13, fontWeight: 600 },
  fileInput: { width: '100%', fontSize: 12 },
  fileName: { overflow: 'hidden', color: '#667085', fontSize: 12, fontWeight: 400, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  masterPanel: { marginTop: 18, padding: 14, border: '1px solid #90caf9', borderRadius: 6, background: '#f3f8ff' },
  masterHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  masterTitle: { margin: 0, color: '#1565c0', fontSize: 16 },
  masterDescription: { margin: '5px 0 0', color: '#555', fontSize: 12 },
  masterActions: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  secondaryButton: { padding: '6px 10px', border: '1px solid #90caf9', borderRadius: 4, background: '#fff', color: '#1565c0', fontSize: 12, cursor: 'pointer' },
  rangeSummary: { display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginBottom: 10, color: '#455a64', fontSize: 12, fontWeight: 600 },
  rangeWarning: { margin: '6px 0', color: '#c62828', fontSize: 12, fontWeight: 600 },
  rangeTable: { width: '100%', borderCollapse: 'collapse', background: '#fff', fontSize: 13 },
  rangeTableHead: { background: '#e3f2fd', color: '#334155' },
  rangeCell: { padding: 6, borderBottom: '1px solid #e5e7eb', textAlign: 'left' },
  rangeSelect: { minWidth: 90, padding: 6 },
  rangeNumber: { width: 76, boxSizing: 'border-box', padding: 6 },
  subjectSelect: { minWidth: 160, maxWidth: '100%', padding: 6 },
  removeButton: { padding: '5px 8px', border: '1px solid #ef9a9a', borderRadius: 4, background: '#fff', color: '#c62828', cursor: 'pointer' },
  formError: { padding: 10, borderRadius: 5, background: '#ffebee', color: '#c62828', fontSize: 13 },
  submitRow: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 },
  submitButton: { padding: '10px 18px', border: 'none', borderRadius: 5, background: '#1976d2', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  previewPanel: { marginTop: 16, padding: 14, border: '1px solid #a5d6a7', borderRadius: 6, background: '#f1f8e9', color: '#334155' },
  chartGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 24, marginTop: 16 },
  chartCard: { background: '#fff', padding: 15, borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
  chartTitle: { textAlign: 'center', margin: '0 0 10px 0', color: '#333' },
  page: {
    minHeight: '100vh',
    background: '#f3f6fa',
    color: '#1c2733',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: { background: '#1976d2', color: '#fff', padding: 20, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
  headerInner: { width: 'min(100%, 1040px)', margin: '0 auto' },
  eyebrow: { margin: '0 0 8px', fontSize: 11, letterSpacing: 2, opacity: 0.75 },
  title: { margin: 0, fontSize: '2em' },
  subtitle: { margin: '5px 0 0', fontSize: 14, opacity: 0.9 },
  content: { width: 'min(calc(100% - 32px), 1040px)', margin: '22px auto 48px' },
  notice: {
    marginBottom: 15,
    padding: '11px 15px',
    border: '1px solid #ead39a',
    borderRadius: 8,
    background: '#fff9e9',
    color: '#624e1d',
    fontSize: 12,
    lineHeight: 1.6,
  },
  toolbar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    alignItems: 'end',
    gap: 14,
    padding: 18,
    marginBottom: 16,
    borderRadius: 9,
    background: '#1976d2',
    color: '#fff',
  },
  selectLabel: { display: 'grid', gap: 6, fontSize: 12, fontWeight: 700 },
  select: {
    width: '100%',
    minHeight: 40,
    padding: '7px 10px',
    border: '1px solid #d7e1ea',
    borderRadius: 5,
    background: '#fff',
    color: '#1c2733',
    fontSize: 14,
  },
  examName: { display: 'grid', gap: 5, minWidth: 0, fontSize: 13 },
  mutedLabel: { color: '#d5e6f5', fontSize: 11 },
  studentInfo: {
    padding: '16px 19px',
    marginBottom: 16,
    border: '1px solid #e1e7ed',
    borderRadius: 9,
    background: '#fff',
  },
  sectionTitle: { margin: 0, fontSize: 19, lineHeight: 1.4 },
  studentDetails: { display: 'flex', flexWrap: 'wrap', gap: '8px 32px', marginTop: 8, fontSize: 14 },
  overallPanel: {
    padding: 20,
    marginBottom: 20,
    border: '1px solid #d3e4f1',
    borderRadius: 9,
    background: '#e3f2fd',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'end',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 15,
  },
  sectionLabel: { margin: '0 0 5px', color: '#6b7d8d', fontSize: 11, fontWeight: 700 },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: 11,
  },
  summaryItem: {
    display: 'grid',
    gap: 7,
    padding: '12px 14px',
    borderRadius: 7,
    background: 'rgba(255,255,255,.85)',
  },
  summaryLabel: { color: '#637382', fontSize: 12 },
  summaryValue: { fontSize: 18 },
  totalGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: 14,
    marginBottom: 20,
  },
  totalCard: {
    padding: '17px 19px',
    border: '1px solid #e1e7ed',
    borderTop: '4px solid #1976d2',
    borderRadius: 9,
    background: '#fff',
    boxShadow: '0 2px 8px rgba(25, 45, 65, 0.04)',
  },
  pendingCard: { borderTopColor: '#8e5bb7', background: '#fbf9fd' },
  cardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cardLabel: { margin: 0, fontSize: 15, fontWeight: 700 },
  badge: { padding: '4px 9px', borderRadius: 14, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  badgePass: { background: '#e3f4ea', color: '#1b6b3a' },
  badgeFail: { background: '#fdeceb', color: '#b3372d' },
  badgePending: { background: '#efe6f6', color: '#6c3f93' },
  score: { margin: '10px 0 2px', fontSize: 31, fontWeight: 750, letterSpacing: -1 },
  maxScore: { color: '#536474', fontSize: 15, fontWeight: 500, letterSpacing: 0 },
  passLine: { margin: '0 0 10px', color: '#5e6d7b', fontSize: 12 },
  cardStats: { display: 'flex', flexWrap: 'wrap', gap: '6px 20px', color: '#566674', fontSize: 12 },
  subtotalStats: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 16px',
    marginTop: 11,
    paddingTop: 10,
    borderTop: '1px solid #e8edf1',
    color: '#5e6d7b',
    fontSize: 12,
    fontWeight: 650,
  },
  pendingNote: { margin: '12px 0 0', color: '#6b5a79', fontSize: 12, lineHeight: 1.7 },
  resultsPanel: {
    padding: 20,
    marginBottom: 17,
    border: '1px solid #e1e7ed',
    borderRadius: 9,
    background: '#fff',
    boxShadow: '0 2px 8px rgba(25, 45, 65, 0.04)',
  },
  tableDescription: { margin: 0, color: '#687786', fontSize: 12 },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 },
  th: {
    padding: '11px 9px',
    borderBottom: '2px solid #d8e0e7',
    background: '#1976d2',
    color: '#fff',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  thLight: {
    padding: '9px',
    borderBottom: '2px solid #d8e0e7',
    color: '#536474',
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  td: { padding: '11px 9px', borderBottom: '1px solid #e8edf1', whiteSpace: 'nowrap' },
  tdWrap: { padding: '11px 9px', borderBottom: '1px solid #e8edf1', lineHeight: 1.5 },
  tag: {
    display: 'inline-block',
    padding: '3px 8px',
    borderRadius: 12,
    background: '#f0f3f6',
    fontSize: 11,
    fontWeight: 700,
  },
  details: { borderTop: '1px solid #e8edf1', padding: '4px 0 10px' },
  summary: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 4px',
    cursor: 'pointer',
    fontSize: 14,
  },
  summaryNote: { color: '#687786', fontSize: 12 },
  unaskedRow: { color: '#9aa6b1', background: '#fafbfc' },
  footer: { padding: '18px 4px', color: '#748290', fontSize: 12, textAlign: 'center' },
};
