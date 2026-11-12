import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from '@e965/xlsx';
import { downloadPastQuestionPdf } from './past-question-pdf';
import { areaMiddleOptions, isAreaEligible, matchesQuestionArea } from './past-question-area';
import './PastQuestionPrototype.css';

interface PastQuestion {
  id: string;
  subject: string;
  majorCategory: string;
  middleCategory: string;
  number: string;
  prompt: string;
  options: string[];
  answerText: string;
  answerOptions: number[];
  occurrence: string;
  figure: string;
  exam: string;
  isCase?: boolean;
}

interface DisplayQuestion {
  question: PastQuestion;
  options: { sourceIndex: number; text: string }[];
}

interface SavedReview {
  question_key: string;
  question: PastQuestion;
}

interface SavedSet {
  id: string;
  created_at: string;
  questions: DisplayQuestion[];
}

async function questionKey(question: PastQuestion) {
  const content = JSON.stringify([question.subject, question.number, question.prompt, question.options, question.answerText]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
const STORAGE_BUCKET = 'past-question-content';
const WORKBOOK_PATH = 'workbook.xlsx';
const ACUPUNCTURE_WORKBOOK_PATH = 'acupuncture-workbook.xlsx';
const QUALIFICATION_GROUPS = ['acupuncture', 'acupuncture_massage'];
const CATEGORY_NAME_CORRECTIONS: Record<string, string> = {
  '競技者の生理学的特徴・変化': '競技者の生理的特徴・変化',
  '膝関節内側側副靱帯損傷の診察': '膝関節側副靱帯損傷の診察',
  '下腿三頭筋肉離れの診察': '下腿三頭筋肉ばなれの診察',
};

const CASE_SUBJECTS = ['リハ医学', '一般臨床', '外科学', '整形外科', '柔道整復学'];

const cellText = (value: unknown) => String(value ?? '').trim();
const normalized = (value: string) => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase('ja');

function correctKnownWorkbookData(questions: PastQuestion[]) {
  let changed = false;
  const corrected = questions.map((question) => {
    const exam = question.subject === '外科学' && question.number === '366' && question.exam === '34'
      ? '33'
      : question.exam;
    const majorCategory = CATEGORY_NAME_CORRECTIONS[question.majorCategory] ?? question.majorCategory;
    const middleCategory = CATEGORY_NAME_CORRECTIONS[question.middleCategory] ?? question.middleCategory;
    if (
      exam === question.exam
      && majorCategory === question.majorCategory
      && middleCategory === question.middleCategory
    ) return question;
    changed = true;
    return { ...question, exam, majorCategory, middleCategory };
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
    const hasMiddle = ['中項目', '小項目'].includes(cellText(rows[0]?.[2]));
    const offset = hasMiddle ? 1 : 0;
    rows.slice(1).forEach((row, index) => {
      const prompt = cellText(row[2 + offset]);
      if (!prompt) return;
      const answerText = cellText(row[7 + offset]);
      questions.push({
        id: `${subject}-${index + 2}`,
        subject,
        majorCategory: cellText(row[1]) || '大項目未設定',
        middleCategory: hasMiddle ? cellText(row[2]) : '',
        number: cellText(row[0]),
        prompt,
        options: row.slice(3 + offset, 7 + offset).map(cellText),
        answerText,
        answerOptions: answerOptions(answerText),
        occurrence: cellText(row[8 + offset]),
        figure: cellText(row[9 + offset]),
        exam: cellText(row[10 + offset]),
        isCase: cellText(row[11 + offset]).includes('症例'),
      });
    });
  });

  if (questions.length === 0) {
    throw new Error('設問が見つかりません。1行目が見出しで、C列に問題文があるExcelを選択してください。');
  }
  return correctKnownWorkbookData(questions).questions;
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

function formattedAnswer(item: DisplayQuestion) {
  const correct = outputCorrectPositions(item);
  return correct.length > 0
    ? correct.map((position) => `${position}（${item.options[position - 1]?.text ?? ''}）`).join('、')
    : item.question.answerText || '未登録';
}

function figureAssetUrl(reference: string) {
  const fileName = /\.png$/i.test(reference) ? reference : `${reference}.png`;
  return `/local-assets/past-question-images/${encodeURIComponent(fileName)}`;
}

function imageFileName(reference: string) {
  return /\.png$/i.test(reference) ? reference : `${reference}.png`;
}

function storageImagePath(fileName: string) {
  const encodedName = [...new TextEncoder().encode(fileName)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `images/${encodedName}.png`;
}

function PastQuestionFigure({ reference, productionMode, supabase }: {
  reference: string;
  productionMode: boolean;
  supabase?: SupabaseClient;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');
  const fileName = imageFileName(reference);

  useEffect(() => {
    if (!productionMode || !supabase) {
      setImageUrl(figureAssetUrl(reference));
      setError('');
      return;
    }

    let active = true;
    let objectUrl = '';
    supabase.storage.from(STORAGE_BUCKET).download(storageImagePath(fileName))
      .then(({ data, error: downloadError }) => {
        if (downloadError) throw downloadError;
        if (!data) throw new Error('画像データが空でした');
        objectUrl = URL.createObjectURL(data);
        if (active) setImageUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch((downloadError: unknown) => {
        if (active) setError(downloadError instanceof Error ? downloadError.message : '図・写真を読み込めませんでした');
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileName, productionMode, reference, supabase]);

  return (
    <figure className="question-figure">
      {imageUrl
        ? <img src={imageUrl} alt={`図・写真 ${reference}`} loading="lazy" />
        : <p role={error ? 'alert' : 'status'}>{error || '図・写真を読み込んでいます…'}</p>}
      <figcaption>図・写真: {reference}</figcaption>
    </figure>
  );
}

function printPage() {
  window.print();
}

export default function PastQuestionPrototype({
  productionMode = false,
  supabase,
  qualificationVariant = 'judo',
}: {
  productionMode?: boolean;
  supabase?: SupabaseClient;
  qualificationVariant?: 'judo' | 'acupuncture';
}) {
  const isAcupuncture = qualificationVariant === 'acupuncture';
  const workbookPath = isAcupuncture ? ACUPUNCTURE_WORKBOOK_PATH : WORKBOOK_PATH;
  const pageTitle = isAcupuncture ? '鍼灸国家試験 過去問' : '柔整国家試験 過去問';
  const backLabel = isAcupuncture ? '鍼灸版へ戻る' : '柔整版へ戻る';
  const examPublisher = isAcupuncture
    ? '公益財団法人東洋療法研修試験財団'
    : '公益財団法人柔道整復研修試験財団';
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
  const [accessStatus, setAccessStatus] = useState<'checking' | 'signedOut' | 'notStudent' | 'loading' | 'ready' | 'error'>(
    productionMode ? 'checking' : 'ready',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [role, setRole] = useState<'student' | 'teacher'>('student');
  const [searchMode, setSearchMode] = useState<'area' | 'exam'>('area');
  const [subject, setSubject] = useState('');
  const [exam, setExam] = useState('');
  const [categorySearch, setCategorySearch] = useState(trackerArea);
  const [questionSearch, setQuestionSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedMiddles, setSelectedMiddles] = useState<string[]>([]);
  const [caseOnly, setCaseOnly] = useState(false);
  const [requestedCount, setRequestedCount] = useState('30');
  const [studentOutputMode, setStudentOutputMode] = useState<'screen' | 'pdf'>('screen');
  const [output, setOutput] = useState<DisplayQuestion[]>([]);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number[]>>({});
  const [checkedAnswers, setCheckedAnswers] = useState<Record<string, boolean>>({});
  const [answerSaveStatus, setAnswerSaveStatus] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState('');
  const [review, setReview] = useState<SavedReview[]>([]);
  const [savedSets, setSavedSets] = useState<SavedSet[]>([]);
  const [selectedSetQuestions, setSelectedSetQuestions] = useState<Record<string, boolean>>({});
  const [studyStatus, setStudyStatus] = useState('');
  const [studyBusy, setStudyBusy] = useState(false);
  const [studyReady, setStudyReady] = useState(false);
  const [currentSetId, setCurrentSetId] = useState('');

  useEffect(() => { setAnswerSaveStatus({}); }, [output]);

  useEffect(() => {
    if (productionMode) {
      let active = true;
      let loadGeneration = 0;
      if (!supabase) {
        setAccessStatus('error');
        setStorageWarning('Supabase接続設定を読み込めませんでした。ログイン画面から再度お試しください。');
        setLoading(false);
        return;
      }

      const clearAccess = () => {
        loadGeneration += 1;
        setLoading(false);
        setAccessStatus('signedOut');
        setQuestions([]);
        setOutput([]);
        setUserId('');
        setReview([]);
        setSavedSets([]);
        setStudyReady(false);
      };
      const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && active) clearAccess();
      });

      const loadPrivateWorkbook = async () => {
        const currentGeneration = ++loadGeneration;
        setLoading(true);
        setStorageWarning('');
        try {
          const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!active || currentGeneration !== loadGeneration) return;
          const user = sessionData.session?.user;
          if (!user) {
            setAccessStatus('signedOut');
            return;
          }

          const { data: profile, error: profileError } = await supabase
            .from('app_users')
            .select('role, school_id')
            .eq('id', user.id)
            .maybeSingle();
          if (profileError) throw profileError;
          if (!active || currentGeneration !== loadGeneration) return;
          const allowedRoles = ['student', 'teacher'];
          if (!profile || !allowedRoles.includes(profile.role)) {
            setAccessStatus('notStudent');
            return;
          }

          if (isAcupuncture || profile.role === 'teacher') {
            if (!profile.school_id) {
              setAccessStatus('notStudent');
              return;
            }
            const { data: school, error: schoolError } = await supabase
              .from('schools')
              .select('qualification_group')
              .eq('id', profile.school_id)
              .maybeSingle();
            if (schoolError) throw schoolError;
            if (!active || currentGeneration !== loadGeneration) return;
            const allowedGroups = isAcupuncture ? QUALIFICATION_GROUPS : ['judo'];
            if (!allowedGroups.includes(school?.qualification_group ?? '')) {
              setAccessStatus('notStudent');
              return;
            }
          }

          setAccessStatus('loading');
          const { data: workbookFile, error: workbookError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .download(workbookPath);
          if (workbookError) throw workbookError;
          if (!workbookFile) throw new Error('過去問ファイルが空でした');
          const imported = parseWorkbook(await workbookFile.arrayBuffer());
          if (!active || currentGeneration !== loadGeneration) return;
          setQuestions(imported);
          setFileName(isAcupuncture ? '鍼灸過去問.xlsx' : '柔整過去問.xlsx');
          setMessage(`問題データを安全に読み込みました（${imported.length.toLocaleString()}問）。`);
          setRole(profile.role === 'teacher' ? 'teacher' : 'student');
          setUserId(profile.role === 'student' ? user.id : '');
          setAccessStatus('ready');
        } catch (error) {
          if (active && currentGeneration === loadGeneration) {
            setStorageWarning(error instanceof Error ? error.message : '過去問データを読み込めませんでした。');
            setAccessStatus('error');
          }
        } finally {
          if (active && currentGeneration === loadGeneration) setLoading(false);
        }
      };

      void loadPrivateWorkbook();
      return () => {
        active = false;
        authListener.subscription.unsubscribe();
      };
    }

    const load = async () => {
      try {
        const stored = await loadQuestionBank();
        if (!stored?.questions?.length) return;
        const corrected = correctKnownWorkbookData(stored.questions);
        setQuestions(corrected.questions);
        setFileName(stored.fileName);
        if (corrected.changed) {
          setMessage(`${stored.fileName} を読み込み、既知の出題情報の表記訂正を適用しています。`);
          try {
            await saveQuestionBank(stored.fileName, corrected.questions);
            setMessage(`${stored.fileName} を読み込み、既知の出題情報の表記訂正を適用して保存しました。`);
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
  }, [isAcupuncture, productionMode, supabase, workbookPath]);

  useEffect(() => {
    if (!productionMode || !supabase || !userId) return;
    let active = true;
    setStudyReady(false);
    setStudyStatus('復習データを読み込んでいます…');
    const loadStudy = async () => {
      try {
        const [reviewResult, setsResult] = await Promise.all([
          supabase.from('private_past_question_review').select('question_key, question')
            .eq('user_id', userId).eq('qualification', qualificationVariant).order('updated_at', { ascending: false }),
          supabase.from('private_past_question_sets').select('id, created_at, questions')
            .eq('user_id', userId).eq('qualification', qualificationVariant).order('created_at', { ascending: false }),
        ]);
        if (reviewResult.error) throw reviewResult.error;
        if (setsResult.error) throw setsResult.error;
        if (active) {
          setReview(reviewResult.data as SavedReview[]);
          setSavedSets(setsResult.data as SavedSet[]);
          setStudyReady(true);
          setStudyStatus('復習データは本人のアカウントに保存されます。');
        }
      } catch (error) {
        if (active) setStudyStatus(`復習データを読み込めませんでした。${error instanceof Error ? error.message : '接続や設定を確認してください。'}`);
      }
    };
    void loadStudy();
    return () => { active = false; };
  }, [productionMode, qualificationVariant, supabase, userId]);

  const addReviewQuestions = async (items: PastQuestion[]) => {
    if (!supabase || !userId || !studyReady || studyBusy || !items.length) return false;
    setStudyBusy(true);
    setStudyStatus('復習リストを保存中…');
    try {
      const entries = await Promise.all(items.map(async (question) => ({
        user_id: userId, qualification: qualificationVariant, question_key: await questionKey(question), question,
        updated_at: new Date().toISOString(),
      })));
      const unique = [...new Map(entries.map((entry) => [entry.question_key, entry])).values()];
      const { error } = await supabase.from('private_past_question_review').upsert(unique, {
        onConflict: 'user_id,qualification,question_key',
      });
      if (error) throw error;
      setReview((current) => [...unique.map(({ question_key, question }) => ({ question_key, question })),
        ...current.filter((item) => !unique.some((entry) => entry.question_key === item.question_key))]);
      setStudyStatus(`${unique.length}問を復習リストに保存しました。`);
      return true;
    } catch (error) {
      setStudyStatus(`復習リストを保存できませんでした。${error instanceof Error ? error.message : 'もう一度お試しください。'}`);
      return false;
    } finally {
      setStudyBusy(false);
    }
  };

  const removeReviewQuestion = async (item: SavedReview) => {
    if (!supabase || !userId || studyBusy) return;
    setStudyBusy(true);
    try {
      const { error } = await supabase.from('private_past_question_review').delete()
        .eq('user_id', userId).eq('qualification', qualificationVariant).eq('question_key', item.question_key);
      if (error) throw error;
      setReview((current) => current.filter((entry) => entry.question_key !== item.question_key));
      setStudyStatus('復習済みにしました。');
    } catch (error) {
      setStudyStatus(`復習済みにできませんでした。${error instanceof Error ? error.message : 'もう一度お試しください。'}`);
    } finally {
      setStudyBusy(false);
    }
  };

  const saveAndDownload = async (items: DisplayQuestion[], existingSetId = '') => {
    if (role === 'teacher') {
      printPage();
      return;
    }
    if (studyBusy) return;
    setStudyBusy(true);
    try {
      if (productionMode && !existingSetId) {
        try {
          if (!supabase || !userId || !studyReady) throw new Error('接続・設定を確認してください。');
          setStudyStatus('問題セットを保存中…');
          const { data, error } = await supabase.from('private_past_question_sets')
            .insert({ user_id: userId, qualification: qualificationVariant, questions: items })
            .select('id, created_at, questions').single();
          if (error) throw error;
          const saved = data as SavedSet;
          setSavedSets((current) => [saved, ...current]);
          setCurrentSetId(saved.id);
          setStudyStatus('問題セットを保存しました。');
        } catch (error) {
          const detail = error instanceof Error ? error.message : '接続・設定を確認してください。';
          setStudyStatus(`問題セットを保存できませんでした。${detail}`);
          if (!window.confirm('問題セットを保存できませんでした。PDFはダウンロードできますが、後から問題番号で復習登録できません。このまま続けますか？')) return;
        }
      }
      setMessage('PDFを作成しています…');
      await downloadPastQuestionPdf(pageTitle, items.map((item) => ({
        subject: item.question.subject, majorCategory: item.question.majorCategory,
        number: item.question.number, prompt: item.question.prompt,
        options: item.options.map((option) => option.text), answer: formattedAnswer(item), figure: item.question.figure,
        multipleAnswers: item.question.answerOptions.length > 1,
      })), async (reference) => {
        if (productionMode) {
          if (!supabase) throw new Error('Supabase接続設定がありません。');
          const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storageImagePath(imageFileName(reference)));
          if (error) throw error;
          if (!data) throw new Error('画像データが空です。');
          return data;
        }
        const response = await fetch(figureAssetUrl(reference));
        if (!response.ok) throw new Error(`画像取得エラー (${response.status})`);
        return response.blob();
      }, examPublisher);
      setMessage('PDFのダウンロードを開始しました。');
    } catch (error) {
      setMessage(`PDFを作成できませんでした。${error instanceof Error ? error.message : 'もう一度お試しください。'}`);
    } finally {
      setStudyBusy(false);
    }
  };

  const subjects = useMemo(() => [...new Set(questions.map((question) => question.subject))], [questions]);
  const exams = useMemo(
    () => [...new Set(questions.map((question) => question.exam).filter(Boolean))]
      .sort((left, right) => Number(left) - Number(right)),
    [questions],
  );
  const categories = useMemo(
    () => [...new Set(questions
      .filter((question) => (!subject || question.subject === subject) && isAreaEligible(question, isAcupuncture))
      .map((question) => question.majorCategory))]
      .sort((left, right) => left.localeCompare(right, 'ja')),
    [questions, subject, isAcupuncture],
  );
  const visibleCategories = useMemo(() => {
    const term = normalized(categorySearch);
    return categories.filter((category) => !term || normalized(category).includes(term));
  }, [categories, categorySearch]);
  const middleOptions = useMemo(
    () => areaMiddleOptions(questions, subject, selectedCategories, isAcupuncture),
    [questions, subject, selectedCategories, isAcupuncture],
  );
  const matchesArea = (question: PastQuestion) =>
    matchesQuestionArea(question, subject, selectedCategories, selectedMiddles, isAcupuncture);
  const caseOptionAvailable = !isAcupuncture && searchMode === 'area' && questions.some((question) =>
    question.isCase && CASE_SUBJECTS.includes(question.subject) && matchesArea(question));
  const matchingQuestions = useMemo(() => {
    const terms = searchTerms(questionSearch);
    return questions.filter((question) => {
      if (searchMode === 'area') {
        if (caseOptionAvailable && caseOnly && !question.isCase) return false;
        if (!matchesQuestionArea(question, subject, selectedCategories, selectedMiddles, isAcupuncture)) return false;
      } else if (exam && question.exam !== exam) {
        return false;
      }
      if (terms.length === 0) return true;
      const searchableText = normalized([
        question.subject,
        question.majorCategory,
        question.middleCategory,
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
  }, [questions, searchMode, subject, selectedCategories, selectedMiddles, isAcupuncture, exam, questionSearch, caseOnly, caseOptionAvailable]);
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
        .filter((question) => question.subject === trackerSubject && isAreaEligible(question, isAcupuncture))
        .map((question) => question.majorCategory))];
      setSelectedCategories(targetCategories);
      const pool = questions.filter((question) => question.subject === trackerSubject && isAreaEligible(question, isAcupuncture));
      setOutput(createOutput(pool, 30));
      setSelectedAnswers({});
      setCheckedAnswers({});
      setMessage(`${trackerDay || '課題'}：${trackerSubject}全体から${Math.min(30, pool.length)}問を出力しました。`);
      return;
    }
    const target = normalized(trackerArea);
    const matchingCategories = [...new Set(questions
      .filter((question) => question.subject === trackerSubject && isAreaEligible(question, isAcupuncture))
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
      question.subject === trackerSubject && question.majorCategory === category && isAreaEligible(question, isAcupuncture));
    setOutput(createOutput(pool, 30));
    setSelectedAnswers({});
    setCheckedAnswers({});
    setMessage(`${trackerDay || '課題'}：${trackerSubject} / ${category} から${Math.min(30, pool.length)}問を出力しました。`);
  }, [trackerSubject, trackerArea, trackerDay, questions, subjects, categories, isAcupuncture]);

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
    setCurrentSetId('');
    setSelectedAnswers({});
    setCheckedAnswers({});
    setMessage(`${nextOutput.length}問を出力しました。`);
    if (role === 'student' && studentOutputMode === 'pdf') {
      void saveAndDownload(nextOutput);
    }
  };

  const toggleAnswer = (questionId: string, answer: number, multiple: boolean) => {
    setAnswerSaveStatus((current) => {
      const next = { ...current };
      delete next[questionId];
      return next;
    });
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
    if (selected.length === 0) {
      setMessage('選択肢を選んでから解答を確認してください。');
      return;
    }
    const isCorrect = correct.length > 0
      && correct.length === selected.length
      && correct.every((answer) => selected.includes(answer));
    setCheckedAnswers((current) => ({ ...current, [item.question.id]: isCorrect }));
    setAnswerSaveStatus((current) => {
      const next = { ...current };
      delete next[item.question.id];
      return next;
    });
    if (!isCorrect && role === 'student' && productionMode) {
      if (!studyReady) {
        setStudyStatus('復習リストに保存できません。接続・設定を確認してください。');
        setAnswerSaveStatus((current) => ({ ...current, [item.question.id]: '復習リストに保存できません。接続・設定を確認してください。' }));
      } else {
        setAnswerSaveStatus((current) => ({ ...current, [item.question.id]: '復習リストに保存中…' }));
        void addReviewQuestions([item.question]).then((saved) => setAnswerSaveStatus((current) => ({
          ...current, [item.question.id]: saved ? '復習リストに保存しました。' : '保存できませんでした。もう一度「解答を確認」を押してください。',
        })));
      }
    }
  };

  return (
    <main className={`past-question-prototype ${role}`}>
      <header className="past-question-header">
        <div>
          <a className="back-link" href="./index.html">{backLabel}</a>
          <h1>{pageTitle}{productionMode ? '' : 'トライアル'}</h1>
          <p>{productionMode
            ? '科目・大項目または国家試験出題回から問題を作成します。'
            : 'Excelを読み込み、科目・大項目または国家試験出題回から問題を作成します。'}</p>
        </div>
        {(!productionMode || role === 'teacher') && (
          <button type="button" className="secondary-button print-button" onClick={() => void saveAndDownload(output, currentSetId)} disabled={output.length === 0 || studyBusy}>
            {role === 'teacher' ? '印刷 / PDF保存' : 'PDFをダウンロード'}
          </button>
        )}
      </header>

      <section className="workbook-panel">
        <div>
          <h2>教材ファイル</h2>
          <p>{productionMode
            ? 'ログイン済みの学生・教員向け教材を読み込みます。'
            : '見出しに応じて問題・分類・出題情報を読み込みます。Excelの内容はサーバーに送信せず、このブラウザー内に保存します。'}</p>
          {fileName && <p className="workbook-name">読み込み中の教材: {fileName}（{questions.length}問）</p>}
          {loading && <p role="status">前回の教材を確認しています…</p>}
          {message && <p className="status-message" role="status">{message}</p>}
          {storageWarning && <p className="warning-message" role="alert">{storageWarning}</p>}
        </div>
        {!productionMode && <div className="upload-control">
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
        </div>}
      </section>

      {productionMode && accessStatus !== 'ready' && (
        <section className="access-panel" role={accessStatus === 'error' ? 'alert' : 'status'}>
          {accessStatus === 'checking' && 'ログイン状態を確認しています…'}
          {accessStatus === 'loading' && '過去問データを読み込んでいます…'}
          {accessStatus === 'signedOut' && <>ログインが必要です。<a href="./index.html">ログイン画面へ</a></>}
          {accessStatus === 'notStudent' && (isAcupuncture
            ? 'このページは鍼灸・あん摩学科の学生・教員のみ利用できます。'
            : 'このページは柔整学科の学生・教員のみ利用できます。')}
          {accessStatus === 'error' && <>過去問を利用できません。{storageWarning}</>}
        </section>
      )}

      {(productionMode || questions.length > 0) && (
        <section className="legal-notice" aria-label="本アプリについて">
          <p>本アプリの問題は{examPublisher}が公表した国家試験問題をもとに作成・編集しています。</p>
          <p>本アプリは個人が独自に開発したものであり、厚生労働省および{examPublisher}とは関係ありません。</p>
        </section>
      )}

      {questions.length > 0 && accessStatus === 'ready' && (
        <>
          {!productionMode && <nav className="role-tabs" aria-label="利用者">
            <button type="button" className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}>学生用</button>
            <button type="button" className={role === 'teacher' ? 'active' : ''} onClick={() => setRole('teacher')}>教員用</button>
          </nav>}

          {role === 'student' && (
            <section className="student-mode-panel">
              <span className="panel-label">解き方</span>
              <label><input type="radio" name="student-output-mode" checked={studentOutputMode === 'screen'} onChange={() => setStudentOutputMode('screen')} />画面で解く</label>
              <label><input type="radio" name="student-output-mode" checked={studentOutputMode === 'pdf'} onChange={() => setStudentOutputMode('pdf')} />PDFで解く（直接ダウンロード）</label>
            </section>
          )}

          {productionMode && role === 'student' && (
            <section className="search-panel study-panel">
              <p className="muted" role="status">{studyStatus}</p>
              <details>
                <summary>復習リスト（{review.length}問）・作成した問題セット（{savedSets.length}件）</summary>
                <h3>復習リスト</h3>
                {review.length === 0 ? <p className="muted">復習する問題はまだありません。</p> : (
                  <>
                    <button type="button" className="primary-button" disabled={!studyReady || studyBusy} onClick={() => {
                      const items = review.map((item) => ({ ...item.question, id: item.question_key }));
                      setOutput(createOutput(items, items.length));
                      setCurrentSetId('');
                      setStudentOutputMode('screen');
                      setSelectedAnswers({});
                      setCheckedAnswers({});
                      setMessage(`復習リストから${items.length}問を出力しました。`);
                    }}>復習リストを解く</button>
                    <ul className="study-list">
                      {review.map((item) => <li key={item.question_key}>
                        <span>{item.question.subject} / {item.question.majorCategory} {item.question.number && `（問題番号 ${item.question.number}）`}</span>
                        <button type="button" className="text-button" disabled={studyBusy} onClick={() => void removeReviewQuestion(item)}>復習済みにする</button>
                      </li>)}
                    </ul>
                  </>
                )}
                <h3>作成した問題セット</h3>
                <p className="muted">PDFや紙で解いた後、間違えた問題や自信のない問題番号を選んで登録できます。日時は問題セットの作成日時です。</p>
                {savedSets.length === 0 && <p className="muted">作成した問題セットはまだありません。</p>}
                {savedSets.map((saved) => (
                  <details key={saved.id} className="saved-set">
                    <summary>{new Date(saved.created_at).toLocaleString('ja-JP')} 作成 / {saved.questions.length}問</summary>
                    <div className="set-numbers">
                      {saved.questions.map((_, index) => {
                        const key = `${saved.id}:${index}`;
                        return <label key={key}><input type="checkbox" checked={Boolean(selectedSetQuestions[key])}
                          onChange={(event) => setSelectedSetQuestions((current) => ({ ...current, [key]: event.target.checked }))} /> {index + 1}番</label>;
                      })}
                    </div>
                    <button type="button" className="secondary-button" disabled={studyBusy} onClick={() => {
                      const items = saved.questions.filter((_, index) => selectedSetQuestions[`${saved.id}:${index}`]).map((item) => item.question);
                      if (!items.length) setStudyStatus('復習する問題番号を選んでください。');
                      else void addReviewQuestions(items);
                    }}>選んだ問題を復習リストへ</button>{' '}
                    <button type="button" className="secondary-button" disabled={studyBusy} onClick={() => {
                      setOutput(saved.questions);
                      setCurrentSetId(saved.id);
                      setStudentOutputMode('pdf');
                      setSelectedAnswers({});
                      setCheckedAnswers({});
                      setMessage('保存した問題セットを表示しました。PDFをダウンロードできます。');
                    }}>問題セットを表示</button>{' '}
                    <button type="button" className="text-button" disabled={studyBusy} onClick={async () => {
                      if (!supabase || !window.confirm('この問題セットを削除しますか？復習リストの問題は残ります。')) return;
                      setStudyBusy(true);
                      try {
                        const { error } = await supabase.from('private_past_question_sets').delete().eq('user_id', userId).eq('id', saved.id);
                        if (error) throw error;
                        setSavedSets((current) => current.filter((entry) => entry.id !== saved.id));
                        if (currentSetId === saved.id) setCurrentSetId('');
                        setStudyStatus('問題セットを削除しました。');
                      } catch (error) {
                        setStudyStatus(`問題セットを削除できませんでした。${error instanceof Error ? error.message : 'もう一度お試しください。'}`);
                      } finally {
                        setStudyBusy(false);
                      }
                    }}>削除</button>
                  </details>
                ))}
              </details>
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
                  <select value={subject} onChange={(event) => { setSubject(event.target.value); setSelectedCategories([]); setSelectedMiddles([]); }}>
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
                {middleOptions.map((group) => (
                  <div key={group.category} className="middle-category-group">
                    <div className="category-heading">
                      <span>{group.category}の中項目（未選択なら全て対象）</span>
                      <button type="button" className="text-button" onClick={() => setSelectedMiddles(selectedMiddles.filter((key) => !key.startsWith(`${group.category}\u0000`)))}>選択解除</button>
                    </div>
                    <div className="category-list" role="group" aria-label={`${group.category}の中項目`}>
                      {group.items.map((item) => {
                        const key = `${group.category}\u0000${item}`;
                        return (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={selectedMiddles.includes(key)}
                              onChange={(event) => setSelectedMiddles(event.target.checked ? [...selectedMiddles, key] : selectedMiddles.filter((value) => value !== key))}
                            />
                            {item}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {caseOptionAvailable && (
                  <label className="case-only-option">
                    <input type="checkbox" checked={caseOnly} onChange={(event) => setCaseOnly(event.target.checked)} />
                    症例問題のみ出題
                  </label>
                )}
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
              <button type="button" className="primary-button generate-button" onClick={generateQuestions} disabled={!validCount || matchingQuestions.length === 0 || busy || studyBusy}>
                {role === 'student' && studentOutputMode === 'pdf' ? '問題を作成してPDFをダウンロード' : '問題を出力'}
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
                        <PastQuestionFigure
                          reference={item.question.figure}
                          productionMode={productionMode}
                          supabase={supabase}
                        />
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
                                  disabled={productionMode && studyBusy}
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
                          <button type="button" className="secondary-button" disabled={productionMode && studyBusy} onClick={() => checkAnswer(item)}>解答を確認</button>
                          {isChecked && <span className={checkedAnswers[item.question.id] ? 'correct-text' : 'incorrect-text'}>{checkedAnswers[item.question.id] ? '正解' : 'もう一度考えてみましょう'}</span>}
                          {answerSaveStatus[item.question.id] && <span role="status">{answerSaveStatus[item.question.id]}</span>}
                        </div>
                      )}
                      <details className="answer-reveal">
                        <summary>模範解答・出題回数を見る</summary>
                        <div className="answer-body">
                          <p><strong>模範解答:</strong> {formattedAnswer(item)}</p>
                          <p><strong>出題回数:</strong> {item.question.occurrence || '記録なし'}</p>
                          <p><strong>国家試験出題回:</strong> {item.question.exam ? `第${item.question.exam}回` : '記録なし'}</p>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
              <section className={`answer-key ${role}-answer-key`} aria-label="模範解答">
                  <h2>模範解答</h2>
                  <ol>
                    {output.map((item, index) => (
                      <li key={item.question.id}>
                        <strong>{index + 1}問:</strong> {formattedAnswer(item)}
                        {role === 'teacher' && (
                          <span className="answer-key-meta">
                            （出題回数: {item.question.occurrence || '記録なし'} / 国家試験出題回: {item.question.exam ? `第${item.question.exam}回` : '記録なし'}）
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
              </section>
              <button type="button" className="secondary-button bottom-print-button" disabled={studyBusy} onClick={() => void saveAndDownload(output, currentSetId)}>
                {role === 'teacher' ? '印刷 / PDF保存' : 'PDFをダウンロード'}
              </button>
            </section>
          )}
        </>
      )}
      {!productionMode && !questions.length && !loading && (
        <section className="empty-panel">
          <h2>Excelを読み込んで開始</h2>
          <p>「{isAcupuncture ? '鍼灸過去問.xlsx' : '柔整過去問.xlsx'}」を選択すると、シート名を科目、B列を大項目として読み込みます。C列が中項目または小項目の場合は、D列を問題、E〜H列を選択肢、I列を模範解答、J〜L列を出題情報として読み込みます。中項目がない場合はC列以降を1列ずつ左にずらして読み込みます。</p>
        </section>
      )}
    </main>
  );
}
