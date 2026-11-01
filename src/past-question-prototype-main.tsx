import React from 'react';
import ReactDOM from 'react-dom/client';
import PastQuestionPrototype from './PastQuestionPrototype';

const qualificationVariant = new URLSearchParams(window.location.search).get('qualification') === 'acupuncture'
  ? 'acupuncture'
  : 'judo';
document.title = qualificationVariant === 'acupuncture'
  ? '鍼灸過去問トライアル'
  : '柔整過去問トライアル';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PastQuestionPrototype qualificationVariant={qualificationVariant} />
  </React.StrictMode>,
);
