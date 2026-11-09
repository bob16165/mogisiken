import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './study-preview.css';

type Course = '柔整' | '鍼灸';
type Question = { id: string; subject: string; prompt: string; options: string[]; answer: number };
type SetRecord = { id: number; created: string; questions: Question[] };
type State = { done: boolean[]; review: string[]; sets: SetRecord[] };

const questions: Record<Course, Question[]> = {
  柔整: [
    { id: 'j1', subject: '解剖学', prompt: '【表示例】肩関節の復習問題', options: ['選択肢 A', '選択肢 B', '選択肢 C', '選択肢 D'], answer: 0 },
    { id: 'j2', subject: '柔整理論', prompt: '【表示例】骨折の復習問題', options: ['選択肢 A', '選択肢 B', '選択肢 C', '選択肢 D'], answer: 1 },
    { id: 'j3', subject: '生理学', prompt: '【表示例】筋肉の復習問題', options: ['選択肢 A', '選択肢 B', '選択肢 C', '選択肢 D'], answer: 2 },
  ],
  鍼灸: [
    { id: 'a1', subject: '東洋医学概論', prompt: '【表示例】東洋医学の復習問題', options: ['選択肢 A', '選択肢 B', '選択肢 C', '選択肢 D'], answer: 0 },
    { id: 'a2', subject: '経絡経穴概論', prompt: '【表示例】経穴の復習問題', options: ['選択肢 A', '選択肢 B', '選択肢 C', '選択肢 D'], answer: 1 },
    { id: 'a3', subject: '生理学', prompt: '【表示例】神経の復習問題', options: ['選択肢 A', '選択肢 B', '選択肢 C', '選択肢 D'], answer: 2 },
  ],
};

const initialState = (): State => ({ done: [false, false, false], review: [], sets: [] });

function App() {
  const [course, setCourse] = useState<Course>('柔整');
  const [states, setStates] = useState<Record<Course, State>>({ 柔整: initialState(), 鍼灸: initialState() });
  const [section, setSection] = useState<'questions' | 'review' | 'sets'>('questions');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState('');
  const [printSet, setPrintSet] = useState<SetRecord | null>(null);
  const current = states[course];

  const update = (change: (state: State) => State) => {
    setStates((all) => ({ ...all, [course]: change(all[course]) }));
  };
  const switchCourse = (next: Course) => {
    setCourse(next);
    setAnswers({});
    setChecked({});
    setMarked({});
    setNotice('');
    setPrintSet(null);
    setSection('questions');
  };
  const checkAnswer = (question: Question) => {
    if (answers[question.id] === undefined) {
      setNotice('選択肢を選んでから解答を確認してください。');
      return;
    }
    const correct = answers[question.id] === question.answer;
    setChecked((previous) => ({ ...previous, [question.id]: correct }));
    if (!correct) {
      update((state) => ({ ...state, review: [...new Set([...state.review, question.id])] }));
      setNotice('復習リストに追加しました。');
    } else {
      setNotice('正解です。復習リストの問題は、必要に応じて「復習済み」にできます。');
    }
  };
  const createSet = () => {
    const record = { id: Date.now(), created: new Date().toLocaleString('ja-JP'), questions: [...questions[course]] };
    update((state) => ({ ...state, sets: [record, ...state.sets] }));
    setPrintSet(record);
    setSection('sets');
    setNotice('問題セットを作成しました。「印刷 / PDF保存」から印刷画面を開けます。');
  };
  const addMarked = (record: SetRecord) => {
    const selected = record.questions.filter((question) => marked[`${record.id}-${question.id}`]).map((question) => question.id);
    if (!selected.length) {
      setNotice('復習したい問題番号を選んでください。');
      return;
    }
    update((state) => ({ ...state, review: [...new Set([...state.review, ...selected])] }));
    setNotice(`${selected.length}問を復習リストに追加しました。`);
  };

  return (
    <main>
      <header className="screen-only">
        <p className="eyebrow">学習機能の画面試作</p>
        <h1>自分のペースで、少しずつ。</h1>
        <p>課題と過去問の復習を、一つの流れで確認できます。</p>
        <div className="warning" role="status"><strong>試作画面です。</strong>例示用の問題を使っています。操作内容はこのタブ内だけに残り、再読み込みで消えます。ログイン・端末間同期・教員への共有はありません。</div>
        <div className="course-switch" aria-label="学科">
          {(['柔整', '鍼灸'] as Course[]).map((value) => <button key={value} type="button" className={course === value ? 'active' : ''} onClick={() => switchCourse(value)}>{value}版</button>)}
        </div>
      </header>

      <section className="card screen-only">
        <h2>週間課題トラッカー</h2>
        <p className="muted">できた課題をチェック。本人だけの進捗を想定しています。</p>
        {questions[course].map((question, index) => (
          <label className="task" key={question.id}>
            <input type="checkbox" checked={current.done[index]} onChange={(event) => {
              const checkedValue = event.target.checked;
              update((state) => ({ ...state, done: state.done.map((done, i) => i === index ? checkedValue : done) }));
            }} />
            <span>Day {index + 1}　{question.subject}の重点領域を復習する</span>
          </label>
        ))}
        <p className="muted">進捗 {current.done.filter(Boolean).length} / {current.done.length}　少しずつでも、自分のペースで。</p>
      </section>

      <section className="card screen-only">
        <div className="section-heading"><h2>過去問と復習</h2><button type="button" onClick={createSet}>問題セットを作成</button></div>
        <p className="muted">画面で解くか、問題セットを印刷・PDF保存して取り組めます。</p>
        <nav className="tabs" aria-label="過去問メニュー">
          <button type="button" className={section === 'questions' ? 'active' : ''} onClick={() => setSection('questions')}>画面で解く</button>
          <button type="button" className={section === 'sets' ? 'active' : ''} onClick={() => setSection('sets')}>作成したセット ({current.sets.length})</button>
          <button type="button" className={section === 'review' ? 'active' : ''} onClick={() => setSection('review')}>復習リスト ({current.review.length})</button>
        </nav>
        {notice && <p className="notice" role="status">{notice}</p>}
        {(section === 'questions' || section === 'review') && (
          <>
            {section === 'review' && current.review.length === 0 && <p>復習リストはまだ空です。</p>}
            {questions[course].filter((question) => section === 'questions' || current.review.includes(question.id)).map((question, index) => (
              <article className="question" key={question.id}>
                <h3>{index + 1}. {question.subject}</h3>
                <p>{question.prompt}</p>
                <div className="options">
                  {question.options.map((option, i) => <label key={option}><input type="radio" name={`${course}-${question.id}`} checked={answers[question.id] === i} onChange={() => { setAnswers((previous) => ({ ...previous, [question.id]: i })); setChecked((previous) => { const next = { ...previous }; delete next[question.id]; return next; }); }} /> {option}</label>)}
                </div>
                <button type="button" onClick={() => checkAnswer(question)}>解答を確認</button>
                {checked[question.id] !== undefined && <span className="result">{checked[question.id] ? '正解' : 'もう一度考えてみましょう'}</span>}
                {section === 'review' && <button type="button" className="secondary" onClick={() => { update((state) => ({ ...state, review: state.review.filter((id) => id !== question.id) })); setNotice('復習済みにしました。'); }}>復習済みにする</button>}
              </article>
            ))}
          </>
        )}
        {section === 'sets' && (
          <>
            {current.sets.length === 0 && <p>作成した問題セットはまだありません。</p>}
            {current.sets.map((record) => (
              <article className="question" key={record.id}>
                <h3>{record.created} 作成</h3>
                <p>全{record.questions.length}問。間違えた問題や自信のない問題を選んでください。</p>
                <div className="number-list">{record.questions.map((question, index) => <label key={question.id}><input type="checkbox" checked={Boolean(marked[`${record.id}-${question.id}`])} onChange={(event) => setMarked((previous) => ({ ...previous, [`${record.id}-${question.id}`]: event.target.checked }))} /> {index + 1}番</label>)}</div>
                <button type="button" onClick={() => addMarked(record)}>選んだ問題を復習リストに追加</button>
                <button type="button" className="secondary" onClick={() => { setPrintSet(record); setTimeout(() => window.print(), 100); }}>印刷 / PDF保存</button>
                <button type="button" className="secondary" onClick={() => { update((state) => ({ ...state, sets: state.sets.filter((item) => item.id !== record.id) })); setNotice('問題セットを削除しました。'); }}>セットを削除</button>
              </article>
            ))}
          </>
        )}
      </section>
      <section className="print-only">
        <h1>{course}版 問題セット（試作）</h1>
        <p>{printSet?.created} 作成</p>
        {printSet?.questions.map((question, index) => <article key={question.id}><h2>{index + 1}. {question.subject}</h2><p>{question.prompt}</p><ol>{question.options.map((option) => <li key={option}>{option}</li>)}</ol></article>)}
        <h2>模範解答</h2>
        <p>{printSet?.questions.map((question, index) => `${index + 1}番: ${question.answer + 1}`).join('　')}</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
