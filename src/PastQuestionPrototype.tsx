import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from '@e965/xlsx';
import './PastQuestionPrototype.css';

interface PastQuestion {
  id: string;
  subject: string;
  majorCategory: string;
  number: string;
  prompt: string;
  options: string[];
  answerText: string;
  answerOptions: number[];
  occurrence: string;
  figure: string;
  exam: string;
}

interface DisplayQuestion {
  question: PastQuestion;
  options: { sourceIndex: number; text: string }[];
}

interface StoredQuestionBank {
  id: string;
  fileName: string;
  questions: PastQuestion[];
}

const DATABASE_NAME = 'mogisiken-past-question-bank';
const STORE_NAME = 'workbooks';
const DATABASE_VERSION = 1;
const STORAGE_KEY = 'latest';

const cellText = (value: unknown) => String(value ?? '').trim();
const normalized = (value: string) => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase('ja');

function correctKnownExamMetadata(questions: PastQuestion[]) {
  let changed = false;
  const corrected = questions.map((question) => {
    if (question.subject !== '外科学' || question.number !== '366' || question.exam !== '34') return question;
    changed = true;
    return { ...question, exam: '33' };
  });
  return { questions: corrected, changed };
}

function searchTerms(value: string) {
  return value.split(/[\s　、,，/]+/).map(normalized).filter(Boolean);
}

function answerOptions(answer: string) {
  return [...new Set((answer.match(/[1-4]/g) ?? []).map(Number))];
}

function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const questions: PastQuestion[] = [];

  workbook.SheetNames.forEach((subject) => {
    const sheet = workbook.Sheets[subject];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    rows.slice(1).forEach((row, index) => {
      const prompt = cellText(row[2]);
      if (!prompt) return;
      const answerText = cellText(row[7]);
      questions.push({
        id: `${subject}-${index + 2}`,
        subject,
        majorCategory: cellText(row[1]) || '大項目未設定',
        number: cellText(row[0]),
        prompt,
        options: row.slice(3, 7).map(cellText),
        answerText,
        answerOptions: answerOptions(answerText),
        occurrence: cellText(row[8]),
        figure: cellText(row[9]),
        exam: cellText(row[10]),
      });
    });
  });

  if (questions.length === 0) {
    throw new Error('設問が見つかりません。1行目が見出しで、C列に問題文があるExcelを選択してください。');
  }
  return correctKnownExamMetadata(questions).questions;
}

function openQuestionDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('このブラウザーではローカル教材保存（IndexedDB）を利用できません。'));
      return;
    }
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('教材保存領域を開けませんでした。'));
  });
}

async function loadQuestionBank() {
  const database = await openQuestionDatabase();
  return new Promise<StoredQuestionBank | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(STORAGE_KEY);
    request.onsuccess = () => resolve((request.result as StoredQuestionBank | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error('保存済み教材を読み込めませんでした。'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

async function saveQuestionBank(fileName: string, questions: PastQuestion[]) {
  const database = await openQuestionDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ id: STORAGE_KEY, fileName, questions } satisfies StoredQuestionBank);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('教材をブラウザーに保存できませんでした。'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('教材の保存が中断されました。'));
    };
  });
}

function shuffle<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function createOutput(pool: PastQuestion[], requestedCount: number): DisplayQuestion[] {
  return shuffle(pool).slice(0, Math.min(requestedCount, pool.length)).map((question) => {
    const preserveNumericOptions = Boolean(question.figure)
      && question.options.length === 4
      && question.options.every((option) => /^[1-4]$/.test(option));
    const options = question.options.map((text, sourceIndex) => ({ sourceIndex, text }));
    return {
      question,
      options: preserveNumericOptions ? options : shuffle(options),
    };
  });
}

function outputCorrectPositions(item: DisplayQuestion) {
  return item.options.flatMap((option, index) =>
    item.question.answerOptions.includes(option.sourceIndex + 1) ? [index + 1] : []);
}

function figureAssetUrl(reference: string) {
  const fileName = /\.png$/i.test(reference) ? reference : `${reference}.png`;
  return `/local-assets/past-question-images/${encodeURIComponent(fileName)}`;
}

function printPage() {
  window.print();
}

export default function PastQuestionPrototype() {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const trackerSubject = query.get('subject') ?? '';
  const trackerArea = query.get('area') ?? '';
  const trackerDay = query.get('day') ?? '';
  const autoRun = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLElement>(null);
  const answerOpenStates = useRef<boolean[] | null>(null);
  const [questions, setQuestions] = useState<PastQuestion[]>([]);
  const [fileName, setFileName] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [searchMode, setSearchMode] = useState<'area' | 'exam'>('area');
  const [subject, setSubject] = useState('');
  const [exam, setExam] = useState('');
  const [categorySearch, setCategorySearch] = useState(trackerArea);
  const [questionSearch, setQuestionSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [requestedCount, setRequestedCount] = useState('30');
  const [studentOutputMode, setStudentOutputMode] = useState<'screen' | 'pdf'>('screen');
  const [output, setOutput] = useState<DisplayQuestion[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number[]>>({});
  const [checkedAnswers, setCheckedAnswers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await loadQuestionBank();
        if (!stored?.questions?.length) return;
        const corrected = correctKnownExamMetadata(stored.questions);
        setQuestions(corrected.questions);
        setFileName(stored.fileName);
        if (corrected.changed) {
          setMessage(`${stored.fileName} を読み込みました。外科学・問題366の出題回を第33回に訂正しています。`);
          try {
            await saveQuestionBank(stored.fileName, corrected.questions);
            setMessage(`${stored.fileName} を読み込み、外科学・問題366の出題回を第33回に訂正して保存しました。`);
          } catch (error) {
            setStorageWarning(error instanceof Error ? error.message : '訂正内容をブラウザーに保存できませんでした。');
          }
        } else {
          setMessage(`${stored.fileName} をこのブラウザーから読み込みました（${stored.questions.length}問）。`);
        }
      } catch (error) {
        setStorageWarning(error instanceof Error ? error.message : '保存済み教材の読み込みに失敗しました。');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const subjects = useMemo(() => [...new Set(questions.map((question) => question.subject))], [questions]);
  const exams = useMemo(
    () => [...new Set(questions.map((question) => question.exam).filter(Boolean))]
      .sort((left, right) => Number(left) - Number(right)),
    [questions],
  );
  const categories = useMemo(
    () => [...new Set(questions
      .filter((question) => !subject || question.subject === subject)
      .map((question) => question.majorCategory))]
      .sort((left, right) => left.localeCompare(right, 'ja')),
    [questions, subject],
  );
  const visibleCategories = useMemo(() => {
    const term = normalized(categorySearch);
    return categories.filter((category) => !term || normalized(category).includes(term));
  }, [categories, categorySearch]);
  const matchingQuestions = useMemo(() => {
    const terms = searchTerms(questionSearch);
    return questions.filter((question) => {
      if (searchMode === 'area') {
        if (subject && question.subject !== subject) return false;
        if (selectedCategories.length > 0 && !selectedCategories.includes(question.majorCategory)) return false;
        if (selectedCategories.length === 0) return false;
      } else if (exam && question.exam !== exam) {
        return false;
      }
      if (terms.length === 0) return true;
      const searchableText = normalized([
        question.subject,
        question.majorCategory,
        question.number,
        question.prompt,
        ...question.options,
        question.answerText,
        question.occurrence,
        question.figure,
        question.exam,
      ].join(' '));
      return terms.every((term) => searchableText.includes(term));
    });
  }, [questions, searchMode, subject, selectedCategories, exam, questionSearch]);
  const countValue = Number(requestedCount);
  const validCount = Number.isInteger(countValue) && countValue > 0;
  const score = output.filter((item) => checkedAnswers[item.question.id]).length;
  const checkedCount = Object.keys(checkedAnswers).length;

  useEffect(() => {
    const showTeacherAnswers = () => {
      if (role !== 'teacher' || !outputRef.current) return;
      const details = [...outputRef.current.querySelectorAll<HTMLDetailsElement>('.answer-reveal')];
      answerOpenStates.current = details.map((item) => item.open);
      details.forEach((item) => { item.open = true; });
    };
    const restoreAnswerStates = () => {
      if (!outputRef.current || !answerOpenStates.current) return;
      const details = [...outputRef.current.querySelectorAll<HTMLDetailsElement>('.answer-reveal')];
      details.forEach((item, index) => { item.open = answerOpenStates.current?.[index] ?? false; });
      answerOpenStates.current = null;
    };
    window.addEventListener('beforeprint', showTeacherAnswers);
    window.addEventListener('afterprint', restoreAnswerStates);
    return () => {
      window.removeEventListener('beforeprint', showTeacherAnswers);
      window.removeEventListener('afterprint', restoreAnswerStates);
    };
  }, [role]);

  useEffect(() => {
    if (!trackerSubject || !questions.length || autoRun.current) return;
    autoRun.current = true;
    setRole('student');
    setSearchMode('area');
    setSubject(subjects.includes(trackerSubject) ? trackerSubject : '');
    setRequestedCount('30');
    setStudentOutputMode('screen');
    if (!trackerArea) {
      const targetCategories = [...new Set(questions
        .filter((question) => question.subject === trackerSubject)
        .map((question) => question.majorCategory))];
      setSelectedCategories(targetCategories);
      const pool = questions.filter((question) => question.subject === trackerSubject);
      setOutput(createOutput(pool, 30));
      setSelectedAnswers({});
      setCheckedAnswers({});
      setMessage(`${trackerDay || '課題'}：${trackerSubject}全体から${Math.min(30, pool.length)}問を出力しました。`);
      return;
    }
    const target = normalized(trackerArea);
    const matchingCategories = [...new Set(questions
      .filter((question) => question.subject === trackerSubject)
      .map((question) => question.majorCategory))].filter((category) => {
      const categoryName = normalized(category);
      return categoryName === target
        || (target.length >= 2 && (categoryName.includes(target) || target.includes(categoryName)));
    });
    if (matchingCategories.length === 0) {
      setCategorySearch('');
      setMessage(`${trackerDay || '課題'}の領域「${trackerArea}」に一致する大項目がありません。該当科目の大項目を選んでください。`);
      return;
    }
    const category = matchingCategories[0];
    setSelectedCategories([category]);
    setCategorySearch(category);
    const pool = questions.filter((question) =>
      question.subject === trackerSubject && question.majorCategory === category);
    setOutput(createOutput(pool, 30));
    setSelectedAnswers({});
    setCheckedAnswers({});
    setMessage(`${trackerDay || '課題'}：${trackerSubject} / ${category} から${Math.min(30, pool.length)}問を出力しました。`);
  }, [trackerSubject, trackerArea, trackerDay, questions, subjects, categories]);

  const importWorkbook = async (file: File) => {
    setBusy(true);
    setMessage('');
    setStorageWarning('');
    try {
      const imported = parseWorkbook(await file.arrayBuffer());
      setQuestions(imported);
      setFileName(file.name);
      setOutput([]);
      setSelectedAnswers({});
      setCheckedAnswers({});
      setSubject(subjects.includes(trackerSubject) ? trackerSubject : imported[0].subject);
      setSelectedCategories([]);
      setExam('');
      setMessage(`${file.name} を読み込みました（${imported.length}問）。教材をブラウザー内に保存しています。`);
      try {
        await saveQuestionBank(file.name, imported);
        setMessage(`${file.name} を読み込み、教材をこのブラウザーに保存しました（${imported.length}問）。`);
      } catch (error) {
        setStorageWarning(error instanceof Error ? error.message : '教材をブラウザーに保存できませんでした。');
        setMessage(`${file.name} を読み込みました（${imported.length}問）。このタブで過去問を利用できます。`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excelファイルの読み込みに失敗しました。');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const setCategorySelected = (category: string, checked: boolean) => {
    setSelectedCategories((current) => checked
      ? [...new Set([...current, category])]
      : current.filter((value) => value !== category));
  };

  const generateQuestions = () => {
    if (!validCount || matchingQuestions.length === 0) return;
    const nextOutput = createOutput(matchingQuestions, countValue);
    setOutput(nextOutput);
    setSelectedAnswers({});
    setCheckedAnswers({});
    setMessage(`${nextOutput.length}問を出力しました。`);
    if (role === 'student' && studentOutputMode === 'pdf') {
      window.setTimeout(printPage, 100);
    }
  };

  const toggleAnswer = (questionId: string, answer: number, multiple: boolean) => {
    setSelectedAnswers((current) => {
      const selected = current[questionId] ?? [];
      const next = multiple
        ? selected.includes(answer) ? selected.filter((item) => item !== answer) : [...selected, answer]
        : selected.includes(answer) ? [] : [answer];
      return { ...current, [questionId]: next };
    });
    setCheckedAnswers((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
  };

  const checkAnswer = (item: DisplayQuestion) => {
    const correct = outputCorrectPositions(item);
    const selected = selectedAnswers[item.question.id] ?? [];
    const isCorrect = correct.length > 0
      && correct.length === selected.length
      && correct.every((answer) => selected.includes(answer));
    setCheckedAnswers((current) => ({ ...current, [item.question.id]: isCorrect }));
  };

  return (
    <main className={`past-question-prototype ${role}`}>
      <header className="past-question-header">
        <div>
          <a className="back-link" href="../app/index.html">柔整版へ戻る</a>
          <h1>柔整国家試験 過去問トライアル</h1>
          <p>Excelを読み込み、科目・大項目または国家試験出題回から問題を作成します。</p>
        </div>
        <button type="button" className="secondary-button print-button" onClick={printPage} disabled={output.length === 0}>
          {role === 'teacher' ? '印刷 / PDF保存' : 'PDFとして保存'}
        </button>
      </header>

      <section className="workbook-panel">
        <div>
          <h2>教材ファイル</h2>
          <p>指定列（B〜K）を読み込みます。Excelの内容はサーバーに送信せず、このブラウザー内に保存します。</p>
          {fileName && <p className="workbook-name">読み込み中の教材: {fileName}（{questions.length}問）</p>}
          {loading && <p role="status">前回の教材を確認しています…</p>}
          {message && <p className="status-message" role="status">{message}</p>}
          {storageWarning && <p className="warning-message" role="alert">{storageWarning}</p>}
        </div>
        <div className="upload-control">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.xls"
            aria-label="過去問Excelファイル"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void importWorkbook(file);
            }}
          />
          {busy && <span role="status">読み込み中…</span>}
        </div>
      </section>

      {questions.length > 0 && (
        <>
          <nav className="role-tabs" aria-label="利用者">
            <button type="button" className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>学生用</button>
            <button type="button" className={role === 'teacher' ? 'active' : ''} onClick={() => setRole('teacher')}>教員用</button>
          </nav>

          {role === 'student' && (
            <section className="student-mode-panel">
              <span className="panel-label">解き方</span>
              <label><input type="radio" name="student-output-mode" checked={studentOutputMode === 'screen'} onChange={() => setStudentOutputMode('screen')} />画面で解く</label>
              <label><input type="radio" name="student-output-mode" checked={studentOutputMode === 'pdf'} onChange={() => setStudentOutputMode('pdf')} />PDFで解く（印刷画面からPDF保存）</label>
            </section>
          )}

          <section className="search-panel">
            <h2>問題を検索</h2>
            <div className="search-mode-tabs" role="group" aria-label="検索方法">
              <button type="button" className={searchMode === 'area' ? 'active' : ''} onClick={() => setSearchMode('area')}>科目・大項目から探す</button>
              <button type="button" className={searchMode === 'exam' ? 'active' : ''} onClick={() => setSearchMode('exam')}>国家試験出題回から探す</button>
            </div>

            {searchMode === 'area' ? (
              <>
                <label className="field-label">
                  科目
                  <select value={subject} onChange={(event) => { setSubject(event.target.value); setSelectedCategories([]); }}>
                    <option value="">科目を選択</option>
                    {subjects.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="field-label">
                  大項目を文字検索
                  <input value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="大項目名で絞り込み" />
                </label>
                <div className="category-heading">
                  <span>大項目（{selectedCategories.length}件選択 / {visibleCategories.length}件表示）</span>
                  <div>
                    <button type="button" className="text-button" onClick={() => setSelectedCategories([...new Set([...selectedCategories, ...visibleCategories])])}>表示分を選択</button>
                    <button type="button" className="text-button" onClick={() => setSelectedCategories([])}>選択解除</button>
                  </div>
                </div>
                <div className="category-list" role="group" aria-label="大項目">
                  {visibleCategories.length === 0
                    ? <span className="muted">科目を選ぶと大項目が表示されます。</span>
                    : visibleCategories.map((category) => (
                      <label key={category}>
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(category)}
                          onChange={(event) => setCategorySelected(category, event.target.checked)}
                        />
                        {category}
                      </label>
                    ))}
                </div>
              </>
            ) : (
              <label className="field-label">
                国家試験出題回
                <select value={exam} onChange={(event) => setExam(event.target.value)}>
                  <option value="">出題回を選択（すべて）</option>
                  {exams.map((item) => <option key={item} value={item}>第{item}回</option>)}
                </select>
              </label>
            )}

            <label className="field-label">
              問題文・大項目・選択肢のキーワード検索（複数語は空白区切り）
              <input value={questionSearch} onChange={(event) => setQuestionSearch(event.target.value)} placeholder="例: ハチ刺傷 アドレナリン" />
            </label>
            <div className="output-controls">
              <label className="field-label count-field">
                出力問題数
                <input type="number" min="1" step="1" value={requestedCount} onChange={(event) => setRequestedCount(event.target.value)} />
              </label>
              <p className="match-count">
                該当 {matchingQuestions.length}問。指定数が該当数より多い場合は、該当する問題をすべて出力します。
              </p>
              <button type="button" className="primary-button generate-button" onClick={generateQuestions} disabled={!validCount || matchingQuestions.length === 0 || busy}>
                {role === 'student' && studentOutputMode === 'pdf' ? '問題を作成してPDFへ' : '問題を出力'}
              </button>
            </div>
            {!validCount && <p className="warning-message" role="alert">問題数は1以上の整数を指定してください。</p>}
            {searchMode === 'area' && selectedCategories.length === 0 && <p className="muted">大項目を1つ以上選択してください。</p>}
          </section>

          {output.length > 0 && (
            <section className="output-panel" aria-live="polite" ref={outputRef}>
              <div className="output-heading">
                <div>
                  <h2>{role === 'teacher' ? '出力問題' : '過去問'}</h2>
                  <p>{output.length}問 / {searchMode === 'exam' && exam ? `第${exam}回` : `${subject || '全科目'}・選択した大項目`}</p>
                </div>
                {role === 'student' && studentOutputMode === 'screen' && (
                  <p className="score-summary">正解 {score} / 解答済み {checkedCount}</p>
                )}
              </div>
              <ol className="question-list">
                {output.map((item, index) => {
                  const correct = outputCorrectPositions(item);
                  const chosen = selectedAnswers[item.question.id] ?? [];
                  const isChecked = Object.prototype.hasOwnProperty.call(checkedAnswers, item.question.id);
                  return (
                    <li className="question-card" key={item.question.id}>
                      <div className="question-meta">
                        <span>{index + 1}. {item.question.subject}</span>
                        <span>{item.question.majorCategory}</span>
                        {item.question.number && <span>問題番号 {item.question.number}</span>}
                      </div>
                      <p className="question-prompt">{item.question.prompt}</p>
                      {item.question.figure && (
                        <figure className="question-figure">
                          <img src={figureAssetUrl(item.question.figure)} alt={`図・写真 ${item.question.figure}`} loading="lazy" />
                          <figcaption>図・写真: {item.question.figure}</figcaption>
                        </figure>
                      )}
                      {role === 'student' && studentOutputMode === 'screen' && item.question.answerOptions.length > 1 && (
                        <p className="multiple-answer-hint">複数選択</p>
                      )}
                      <ol className="option-list">
                        {item.options.map((option, optionIndex) => {
                          const displayNumber = optionIndex + 1;
                          const isSelected = chosen.includes(displayNumber);
                          const isCorrect = correct.includes(displayNumber);
                          return (
                            <li key={`${item.question.id}-${option.sourceIndex}`}>
                              {role === 'student' && studentOutputMode === 'screen' ? (
                                <button
                                  type="button"
                                  className={`option-button${isSelected ? ' selected' : ''}${isChecked && isCorrect ? ' correct' : ''}${isChecked && isSelected && !isCorrect ? ' incorrect' : ''}`}
                                  aria-pressed={isSelected}
                                  onClick={() => toggleAnswer(item.question.id, displayNumber, item.question.answerOptions.length > 1)}
                                >
                                  <span>{displayNumber}.</span> {option.text}
                                </button>
                              ) : (
                                <div className="option-print"><span>{displayNumber}.</span> {option.text}</div>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                      {role === 'student' && studentOutputMode === 'screen' && correct.length > 0 && (
                        <div className="answer-controls">
                          <button type="button" className="secondary-button" onClick={() => checkAnswer(item)}>解答を確認</button>
                          {isChecked && <span className={checkedAnswers[item.question.id] ? 'correct-text' : 'incorrect-text'}>{checkedAnswers[item.question.id] ? '正解' : 'もう一度考えてみましょう'}</span>}
                        </div>
                      )}
                      <details className="answer-reveal">
                        <summary>模範解答・出題回数を見る</summary>
                        <div className="answer-body">
                          <p><strong>模範解答:</strong> {correct.length > 0
                            ? correct.map((position) => `${position}（${item.options[position - 1]?.text ?? ''}）`).join('、')
                            : item.question.answerText || '未登録'}</p>
                          <p><strong>出題回数:</strong> {item.question.occurrence || '記録なし'}</p>
                          <p><strong>国家試験出題回:</strong> {item.question.exam ? `第${item.question.exam}回` : '記録なし'}</p>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
              <button type="button" className="secondary-button bottom-print-button" onClick={printPage}>
                {role === 'teacher' ? '印刷 / PDF保存' : 'PDFとして保存'}
              </button>
            </section>
          )}
        </>
      )}
      {!questions.length && !loading && (
        <section className="empty-panel">
          <h2>Excelを読み込んで開始</h2>
          <p>「柔整過去問.xlsx」を選択すると、シート名を科目、B列を大項目、C列を問題、D〜G列を選択肢、H列を模範解答、I〜K列を出題情報として読み込みます。</p>
        </section>
      )}
    </main>
  );
}
