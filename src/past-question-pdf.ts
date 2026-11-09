import { jsPDF } from 'jspdf';

export interface PdfQuestion {
  subject: string;
  majorCategory: string;
  number: string;
  prompt: string;
  options: string[];
  answer: string;
  figure: string;
  multipleAnswers: boolean;
}

const WIDTH = 1240;
const HEIGHT = 1754;
const MARGIN = 80;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;
const BOTTOM = HEIGHT - MARGIN;
const LINE_HEIGHT = 36;
const FONT = '28px sans-serif';

export async function downloadPastQuestionPdf(
  title: string,
  questions: PdfQuestion[],
  loadFigure: (reference: string) => Promise<Blob>,
  publisher: string,
) {
  if (!questions.length) throw new Error('出力する問題がありません。');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PDFの描画を開始できませんでした。');
  let page = 0;
  let y = MARGIN;

  const startPage = () => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'top';
    ctx.font = FONT;
    y = MARGIN;
  };
  const finishPage = () => {
    if (page > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
    page += 1;
  };
  const ensureSpace = (height: number) => {
    if (y + height > BOTTOM) {
      finishPage();
      startPage();
    }
  };
  const text = (value: string, indent = 0, bold = false) => {
    ctx.font = bold ? 'bold 28px sans-serif' : FONT;
    for (const paragraph of value.split(/\r\n|\r|\n/)) {
      let line = '';
      for (const char of paragraph) {
        const next = line + char;
        if (line && ctx.measureText(next).width > CONTENT_WIDTH - indent) {
          ensureSpace(LINE_HEIGHT);
          ctx.font = bold ? 'bold 28px sans-serif' : FONT;
          ctx.fillText(line, MARGIN + indent, y);
          y += LINE_HEIGHT;
          line = char;
        } else {
          line = next;
        }
      }
      ensureSpace(LINE_HEIGHT);
      ctx.font = bold ? 'bold 28px sans-serif' : FONT;
      ctx.fillText(line, MARGIN + indent, y);
      y += LINE_HEIGHT;
    }
  };
  const figure = async (reference: string) => {
    let url = '';
    try {
      const blob = await loadFigure(reference);
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('画像が空です。');
      const scale = Math.min(CONTENT_WIDTH / image.naturalWidth, (BOTTOM - MARGIN - LINE_HEIGHT) / image.naturalHeight, 1);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ensureSpace(height + LINE_HEIGHT);
      ctx.drawImage(image, MARGIN + (CONTENT_WIDTH - width) / 2, y, width, height);
      y += height + 8;
      text(`図・写真: ${reference}`);
    } catch (error) {
      throw new Error(`図・写真「${reference}」を読み込めませんでした。${error instanceof Error ? error.message : ''}`);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

  startPage();
  text(title, 0, true);
  text(`本アプリの問題は${publisher}が公表した国家試験問題をもとに作成・編集しています。`);
  text(`本アプリは個人が独自に開発したものであり、厚生労働省および${publisher}とは関係ありません。`);
  y += 16;
  for (const [index, question] of questions.entries()) {
    ensureSpace(LINE_HEIGHT * 3);
    text(`${index + 1}. ${question.subject} / ${question.majorCategory}${question.number ? ` / 問題番号 ${question.number}` : ''}`, 0, true);
    text(question.prompt);
    if (question.figure) await figure(question.figure);
    if (question.multipleAnswers) text('複数選択');
    question.options.forEach((option, optionIndex) => text(`${optionIndex + 1}. ${option}`, 20));
    y += 24;
  }
  finishPage();
  startPage();
  text('模範解答', 0, true);
  y += 16;
  questions.forEach((question, index) => text(`${index + 1}問: ${question.answer}`));
  finishPage();
  pdf.save(`${title.replace(/[\\/:*?"<>|]/g, '_')}.pdf`);
}
