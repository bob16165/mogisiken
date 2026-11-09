import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { TeacherReview } = await server.ssrLoadModule('/src/prototypeAnalysisViews.tsx');
  const track = {
    id: 'acupuncture',
    label: '鍼灸',
    questions: [{ section: '前半', no: 1, subject: '解剖学', standardNo: 1, standardName: '領域', key: 1 }],
    subjects: ['解剖学'],
    students: [{ id: '1', name: '学生1' }, { id: '2', name: '学生2' }, { id: '3', name: '学生3' }],
    picks: [[1], [1], [2]],
    rules: [],
  };
  const render = (isDemoAccount) => renderToStaticMarkup(React.createElement(TeacherReview, { track, isDemoAccount }));
  const normal = render(false);
  const demo = render(true);
  for (const text of [
    'を低学力者向け補習の分析対象としています。',
    '上位30%と下位30%を除外した中間層',
    '下位30%を対象に、平均識別係数0.2以上の領域',
    '低学力者向け：識別係数0.3以上の問題',
    '総合点との相関が0.3以上の問題です。',
  ]) {
    assert.ok(normal.includes(text), `通常画面に ${text} がありません`);
    assert.ok(!demo.includes(text), `デモ画面に ${text} が残っています`);
  }
  for (const text of ['受験者全体の総評・復習ポイント', '全体の講義向け', '低学力者の補習向け', '低学力者向けの問題', '識別係数 r=']) {
    assert.ok(demo.includes(text), `デモ画面に ${text} がありません`);
  }
  const emptyTrack = { ...track, picks: [[1], [1], [1]] };
  const emptyDemo = renderToStaticMarkup(React.createElement(TeacherReview, { track: emptyTrack, isDemoAccount: true }));
  assert.ok(emptyDemo.includes('対象の問題はありません。'));
  assert.ok(!emptyDemo.includes('識別係数0.3以上の問題はありません。'));
  console.log('Demo teacher review display checks passed.');
} finally {
  await server.close();
}
