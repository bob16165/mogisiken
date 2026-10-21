import { Fragment, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { buildTrackFromFiles } from './prototypeCsv';
import type { TrackFiles } from './prototypeCsv';
import { HighRateWrongPanel, StudyGuidance, studentHighRateHits, TeacherReview, WeakAreasPanel } from './prototypeAnalysisViews';
import type { HistoryEntry } from './prototypeAnalysis';
import {
  allStudentScores,
  EXAMS,
  maxOf,
  passLineOf,
  questionDetails,
  SCHOOL_GROUPS,
  TRACK_LABELS,
} from './qualificationPrototypeData';
import type { ExamData, QuestionDetailRow, TrackData, TrackId } from './qualificationPrototypeData';

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

function rangesFromQuestions(questions: TrackData['questions']): QuestionRange[] {
  const ranges: QuestionRange[] = [];
  questions.forEach((question) => {
    const current = ranges[ranges.length - 1];
    if (current && current.section === question.section && current.subject === question.subject &&
        current.end === question.no - 1) {
      current.end = question.no;
    } else {
      ranges.push({
        section: question.section,
        start: question.no,
        end: question.no,
        subject: question.subject,
      });
    }
  });
  return ranges;
}

function defaultRangesFor(type: Exclude<RegistrationType, 'both'>) {
  return rangesFromQuestions(EXAMS[0].tracks[type].questions);
}

const STORAGE_KEY = 'qualificationPrototype.registeredExams';

function loadRegisteredExams(): ExamData[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as ExamData[]) : [];
  } catch {
    return [];
  }
}

function saveRegisteredExams(exams: ExamData[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
  } catch {
    // 容量超過などで保存できなくても、画面上の登録は継続する。
  }
}

const BUILT_IN_STANDARD_NAMES = new Map(
  EXAMS.flatMap((exam) => Object.values(exam.tracks).flatMap((track) =>
    track.questions
      .filter((question) => question.standardNo !== null)
      .map((question): [string, string] => [`${question.subject}:${question.standardNo}`, question.standardName]),
  )),
);

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

export default function QualificationPrototype() {
  const [groupId, setGroupId] = useState(SCHOOL_GROUPS[0].id);
  const [studentIndex, setStudentIndex] = useState(0);
  const [registered, setRegistered] = useState<ExamData[]>(loadRegisteredExams);
  const [examId, setExamId] = useState(EXAMS[0].id);
  const [fromTeacher, setFromTeacher] = useState(false);
  const [trackId, setTrackId] = useState<TrackId>('acupuncture');
  const [viewMode, setViewMode] = useState<'student' | 'teacher' | 'registration'>('student');
  const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
  const group = SCHOOL_GROUPS.find((item) => item.id === groupId) ?? SCHOOL_GROUPS[0];
  const visibleExams = [...EXAMS, ...registered].filter((item) =>
    item.tracks.acupuncture || (group.hasMassage && item.tracks.massage));
  const exam = visibleExams.find((item) => item.id === examId) ?? visibleExams[0];
  const wantedTrack = group.hasMassage ? trackId : 'acupuncture';
  const track = exam.tracks[wantedTrack] ?? exam.tracks.acupuncture ?? exam.tracks.massage as TrackData;
  const hideAnswers = Boolean(exam.hideCorrectAnswer) && !fromTeacher;
  const registerExam = (item: ExamData) => {
    const next = [...registered, item];
    setRegistered(next);
    saveRegisteredExams(next);
    setExamId(item.id);
    setTrackId(item.tracks.acupuncture ? 'acupuncture' : 'massage');
    setStudentIndex(0);
    setExpandedSubject(null);
    setFromTeacher(false);
    setViewMode('student');
  };
  const STUDENTS = track.students;
  const activeIndex = Math.min(studentIndex, STUDENTS.length - 1);
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

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <p style={styles.eyebrow}>LOCAL PROTOTYPE</p>
          <h1 style={styles.title}>模擬試験結果閲覧システム</h1>
          <p style={styles.subtitle}>資格別結果・教員用一覧・CSV登録画面のローカル試作</p>
        </div>
      </header>

      <div style={styles.content}>
        <aside style={styles.notice}>
          ローカル確認用の試作です。ログイン認証・学校IDによるアクセス制御・Supabaseへの保存は行いません。
        </aside>

        <section style={styles.toolbar} aria-label="表示対象の選択">
          <label style={styles.selectLabel} htmlFor="school-group">
            学科グループ
            <select
              id="school-group"
              value={groupId}
              onChange={(event) => {
                setGroupId(event.target.value);
                setTrackId('acupuncture');
                setExpandedSubject(null);
              }}
              style={styles.select}
            >
              {SCHOOL_GROUPS.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
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
          <label style={styles.selectLabel} htmlFor="view-mode">
            表示画面
            <select
              id="view-mode"
              value={viewMode}
              onChange={(event) => {
                if (event.target.value === 'student' || event.target.value === 'teacher' || event.target.value === 'registration') {
                  setFromTeacher(false);
                  setViewMode(event.target.value);
                }
              }}
              style={styles.select}
            >
              <option value="student">学生用結果画面</option>
              <option value="teacher">教員用成績一覧</option>
              <option value="registration">CSV登録</option>
            </select>
          </label>
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

        {viewMode === 'registration' ? (
          <RegistrationView key={group.id} group={group} onRegister={registerExam} />
        ) : viewMode === 'teacher' ? (
          <>
          <TeacherClassView
            students={STUDENTS}
            overallScores={overallScores}
            overallMax={overallMax}
            qualifications={qualificationRows}
            subjects={subjectRows.map(({ subject, max, scores }) => ({ name: subject.name, max, scores }))}
            onSelectStudent={(index) => {
              setStudentIndex(index);
              setExpandedSubject(null);
              setFromTeacher(true);
              setViewMode('student');
            }}
          />
          <TeacherReview track={track} />
          </>
        ) : (
          <>
        <h2 style={{ textAlign: 'center', color: '#333', margin: '24px 0 20px' }}>試験結果</h2>
        <div style={{ background: '#f5f5f5', padding: 15, borderRadius: 8, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 10px 0' }}>学生情報</h3>
          <p style={{ margin: '5px 0' }}><strong>受験番号:</strong> {student.id}</p>
          <p style={{ margin: '5px 0' }}><strong>氏名:</strong> {student.name}</p>
        </div>

        {history.length > 0 && <StudyGuidance history={history} hideAnswers={hideAnswers} isTeacher={fromTeacher} />}

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
          {track.rules.map((rule) => {
            const counted = (question: { subject: string }) => question.subject !== rule.excludedSubject;
            const max = maxOf(track, counted);
            const scores = allStudentScores(track, counted);
            const score = scores[activeIndex];
            const passLine = passLineOf(max);
            const passed = score >= passLine;
            const { average, stdDev } = rateStats(scores, max);
            return (
              <div key={rule.qualification} style={{ marginTop: 20 }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: 14 }}>
                  {rule.label} 合計 {score}/{max}（合格ライン {passLine}問）
                  <span style={{ ...styles.badge, ...(passed ? styles.badgePass : styles.badgeFail), marginLeft: 8 }}>
                    {passed ? '合格ライン到達' : `あと ${passLine - score} 問`}
                  </span>
                </h4>
                <BarChart scoreRate={scoreRate(score, max)} averageRate={average} stdDeviation={stdDev} />
                <StatGrid
                  rate={scoreRate(score, max)}
                  rankText={`${rank(score, scores)}位`}
                  dev={deviation(score, scores)}
                  average={average}
                />
                {rule.excludedSubject && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>※ {rule.excludedSubject}を除く</div>
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
            <WeakAreasPanel history={history} hideAnswers={hideAnswers} />
            {!hideAnswers && (
              <HighRateWrongPanel hits={studentHighRateHits(history)} title="正答率50%以上で誤答した問題" />
            )}
          </>
        )}
          </>
        )}
        <footer style={styles.footer}>柔整の既存画面・採点処理は変更していません。</footer>
      </div>
    </main>
  );
}

function RegistrationView({ group, onRegister }: { group: (typeof SCHOOL_GROUPS)[number]; onRegister: (exam: ExamData) => void }) {
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
    subjects: EXAMS[0].tracks[type].subjects,
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
      setError('');
      setWarnings(collected);
      setShowPreview(true);
      onRegister({
        id: `registered-${Date.now()}`,
        name: examName.trim(),
        hideCorrectAnswer,
        tracks: built,
      });
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
          <p style={styles.sectionLabel}>CSV登録（ローカル試作）</p>
          <h2 style={styles.sectionTitle}>模擬試験の登録</h2>
        </div>
        <span style={styles.groupBadge}>{group.name}</span>
      </div>
      <aside style={styles.registrationNotice}>
        資格の登録方法を選ぶと、対応する科目・問題範囲マスターが自動で表示されます。
        範囲は試験ごとに変更できます。問題番号の上限は前半Q128・後半Q122です。
        前半・後半CSV（学籍番号＋Q列）と模範解答CSV（「模範解答前半」「模範解答後半」の横並び1行）を読み込んで採点します。登録した試験はこのブラウザ内にのみ保存されます。
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
            登録しました。試験選択から結果を確認できます。
          </p>
        </section>
      )}
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
                <td style={{ ...styles.teacherCell, fontWeight: 700 }}>{index + 1}</td>
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
  header: { background: '#123b55', color: '#fff', padding: '28px 24px' },
  headerInner: { width: 'min(100%, 1040px)', margin: '0 auto' },
  eyebrow: { margin: '0 0 8px', fontSize: 11, letterSpacing: 2, opacity: 0.75 },
  title: { margin: 0, fontSize: 27, lineHeight: 1.3 },
  subtitle: { margin: '9px 0 0', color: '#dceaf2', fontSize: 14 },
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
