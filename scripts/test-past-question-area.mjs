import assert from 'node:assert/strict';
import { areaMiddleOptions, isAreaEligible, matchesQuestionArea } from '../src/past-question-area.ts';

const question = (subject, majorCategory, middleCategory) => ({ subject, majorCategory, middleCategory });
const rows = [
  question('解剖学', '神経系', '中枢神経'),
  question('解剖学', '神経系', '末梢神経'),
  question('解剖学', '神経系', '記載なし'),
  question('解剖学', '記載なし', '中枢神経'),
  question('解剖学', '大項目未設定', ''),
  question('必修', '神経系', '必修中項目'),
  question('必修', '神経系', '記載なし'),
];
const selected = ['神経系'];
const key = '神経系\u0000中枢神経';

assert.deepEqual(areaMiddleOptions(rows, '解剖学', selected, false), [
  { category: '神経系', items: ['中枢神経', '末梢神経'] },
]);
assert.deepEqual(areaMiddleOptions(rows, '必修', selected, false), []);
assert.deepEqual(areaMiddleOptions(rows, '', selected, false), [
  { category: '神経系', items: ['中枢神経', '末梢神経'] },
]);
assert.deepEqual(rows.filter((row) => matchesQuestionArea(row, '解剖学', selected, [], false)), rows.slice(0, 2));
assert.deepEqual(rows.filter((row) => matchesQuestionArea(row, '解剖学', selected, [key], false)), [rows[0]]);
assert.equal(matchesQuestionArea(rows[5], '', selected, [key], false), true);
assert.equal(isAreaEligible(rows[2], false), false);
assert.equal(isAreaEligible(question('病理学', '分類', ' 記載なし '), false), false);
assert.equal(isAreaEligible(rows[2], true), true);

const acupuncture = [
  question('東洋医学', '各論', '中項目'),
  question('東洋医学', '総論', '中項目'),
  question('東洋医学', '症候に対する鍼灸治療', '中項目'),
];
assert.deepEqual(areaMiddleOptions(acupuncture, '東洋医学', ['各論', '総論', '症候に対する鍼灸治療'], true), [
  { category: '各論', items: ['中項目'] },
  { category: '症候に対する鍼灸治療', items: ['中項目'] },
]);
assert.equal(matchesQuestionArea(acupuncture[1], '東洋医学', ['総論'], ['総論\u0000別項目'], true), true);
console.log('Past-question area tests passed.');
