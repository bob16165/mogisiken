// 学校向けのCSVサンプル。形式は柔整版と同じ（試験データは前半Q1〜Q128・後半Q1〜Q122まで）。
function download(content: string, filename: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const SAMPLE_DOWNLOADS: { label: string; run: () => void }[] = [
  {
    label: '学生氏名マスター',
    run: () => download(
      `学籍番号,氏名,初期パスワード,入学年度,課程年数
26401001,山田太郎,password123,2024,3
26401002,佐藤花子,password456,2024,3
26401003,鈴木一郎,,2024,3`,
      '学生氏名マスターサンプル.csv',
    ),
  },
  {
    label: '前半の解答データ',
    run: () => download(
      `学籍番号,Q1,Q2,Q3,Q4,Q5,Q6
26401001,1,3,2,4,1,2
26401002,2,3,2,1,1,4
26401003,1,4,2,4,3,2`,
      '前半解答データサンプル.csv',
    ),
  },
  {
    label: '後半の解答データ',
    run: () => download(
      `学籍番号,Q1,Q2,Q3,Q4,Q5,Q6
26401001,3,1,4,2,2,1
26401002,3,1,4,4,2,1
26401003,1,1,4,2,3,1`,
      '後半解答データサンプル.csv',
    ),
  },
  {
    label: '模範解答',
    run: () => download(
      `模範解答前半,Q1,Q2,Q3,Q4,Q5,Q6,,模範解答後半,Q1,Q2,Q3,Q4,Q5,Q6
,1,3,2,4,1,2,,後半,3,1,4,2,2,1`,
      '模範解答サンプル.csv',
    ),
  },
  {
    label: '出題基準',
    run: () => download(
      `出題基準前半,Q1,Q2,Q3,Q4,Q5,Q6,,出題基準後半,Q1,Q2,Q3,Q4,Q5,Q6
,2,3,1,1,2,2,,後半,1,2,2,3,1,1`,
      '出題基準サンプル.csv',
    ),
  },
];
