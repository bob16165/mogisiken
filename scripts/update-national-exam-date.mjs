import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceUrl = 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/judouseihukushi/';
const outputPath = resolve('app/national-exam-date.json');

function normalizeDigits(value) {
  return value.replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10));
}

function parseReiwaDate(value) {
  const match = normalizeDigits(value).match(/令和\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日/);
  if (!match) throw new Error(`厚生労働省ページから日付を読み取れません: ${value}`);

  const [, eraYear, month, day] = match.map(Number);
  const year = 2018 + eraYear;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`厚生労働省ページの日付が不正です: ${value}`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const response = await fetch(sourceUrl);
if (!response.ok) throw new Error(`厚生労働省ページの取得に失敗しました: HTTP ${response.status}`);
const html = new TextDecoder('shift_jis').decode(await response.arrayBuffer());

const noticeMatch = html.match(/第\s*([０-９\d]+)\s*回柔道整復師国家試験を次のとおり施行する/);
if (!noticeMatch) throw new Error('厚生労働省ページから国家試験の回数を読み取れません');

const noticeStart = noticeMatch.index;
const noticeHtml = html.slice(noticeStart);
const issuingParagraph = noticeHtml.match(/<p\b[^>]*>\s*(令和[０-９\d]+\s*年\s*[０-９\d]+\s*月\s*[０-９\d]+\s*日)[^<]*厚生労働大臣[^<]*<\/p>/);
if (!issuingParagraph) throw new Error('厚生労働省ページから発表日を読み取れません');

const nextParagraph = noticeHtml
  .slice(issuingParagraph.index + issuingParagraph[0].length)
  .match(/<p\b[^>]*>\s*(令和[^<]+)<\/p>/);
if (!nextParagraph) throw new Error('厚生労働省ページから試験日を読み取れません');

const schedule = {
  examNumber: Number(normalizeDigits(noticeMatch[1])),
  examDate: parseReiwaDate(nextParagraph[1]),
  announcedAt: parseReiwaDate(issuingParagraph[1]),
  sourceUrl
};
if (!Number.isInteger(schedule.examNumber) || schedule.examNumber < 1) {
  throw new Error(`厚生労働省ページの試験回数が不正です: ${noticeMatch[1]}`);
}

if (process.argv.includes('--check')) {
  console.log(`確認済み: 第${schedule.examNumber}回、試験日 ${schedule.examDate}、発表日 ${schedule.announcedAt}`);
} else {
  const content = `${JSON.stringify(schedule, null, 2)}\n`;
  const currentContent = await readFile(outputPath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });

  if (currentContent !== content) {
    await writeFile(outputPath, content);
    console.log(`試験日程を更新しました: 第${schedule.examNumber}回、${schedule.examDate}`);
  } else {
    console.log(`試験日程に変更はありません: 第${schedule.examNumber}回、${schedule.examDate}`);
  }
}
