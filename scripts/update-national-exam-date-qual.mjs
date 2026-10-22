import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 鍼灸・あん摩の国家試験日程。柔整の update-national-exam-date.mjs と同じく、毎年9月の官報告示を取り込む。
const sources = {
  harishi: { label: 'はり師', url: 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/harishi/' },
  kyushi: { label: 'きゅう師', url: 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/kyushi/' },
  anma: { label: 'あん摩マッサージ指圧師', url: 'https://www.mhlw.go.jp/kouseiroudoushou/shikaku_shiken/anma/' }
};
const outputPath = resolve('app/national-exam-date-qual.json');

const normalizeDigits = (value) => value.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10));

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

const schedule = {};
for (const [key, { label, url }] of Object.entries(sources)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}: 厚生労働省ページの取得に失敗しました: HTTP ${response.status}`);
  const html = new TextDecoder('shift_jis').decode(await response.arrayBuffer());

  const noticeMatch = html.match(/第\s*([０-９\d]+)\s*回[^、。<]*国家試験を次のとおり施行する/);
  if (!noticeMatch) throw new Error(`${label}: 国家試験の回数を読み取れません`);
  const noticeHtml = html.slice(noticeMatch.index);
  const issuing = noticeHtml.match(/<p\b[^>]*>\s*(令和[０-９\d]+\s*年\s*[０-９\d]+\s*月\s*[０-９\d]+\s*日)[^<]*厚生労働大臣[^<]*<\/p>/);
  if (!issuing) throw new Error(`${label}: 発表日を読み取れません`);
  const next = noticeHtml.slice(issuing.index + issuing[0].length).match(/<p\b[^>]*>\s*(令和[^<]+)<\/p>/);
  if (!next) throw new Error(`${label}: 試験日を読み取れません`);

  schedule[key] = {
    label,
    examNumber: Number(normalizeDigits(noticeMatch[1])),
    examDate: parseReiwaDate(next[1]),
    announcedAt: parseReiwaDate(issuing[1]),
    sourceUrl: url
  };
}

if (process.argv.includes('--check')) {
  Object.values(schedule).forEach((item) => console.log(`確認済み: ${item.label} 第${item.examNumber}回、試験日 ${item.examDate}`));
} else {
  const content = `${JSON.stringify(schedule, null, 2)}\n`;
  const current = await readFile(outputPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (current !== content) {
    await writeFile(outputPath, content);
    console.log('鍼灸・あん摩の試験日程を更新しました');
  } else {
    console.log('鍼灸・あん摩の試験日程に変更はありません');
  }
}
