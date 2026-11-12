export interface AreaQuestion {
  subject: string;
  majorCategory: string;
  middleCategory: string;
}

export function isAreaEligible(question: AreaQuestion, isAcupuncture: boolean) {
  if (isAcupuncture) return true;
  const missing = (value: string) => value.normalize('NFKC').trim() === '記載なし';
  return question.majorCategory !== '大項目未設定'
    && !missing(question.majorCategory)
    && !missing(question.middleCategory);
}

function supportsMiddleCategory(question: AreaQuestion, isAcupuncture: boolean) {
  if (!isAcupuncture) return question.subject !== '必修';
  return question.majorCategory.endsWith('各論')
    || question.majorCategory.includes('症候に対する鍼灸治療');
}

export function areaMiddleOptions(
  questions: AreaQuestion[],
  subject: string,
  selectedCategories: string[],
  isAcupuncture: boolean,
) {
  return selectedCategories.map((category) => ({
    category,
    items: [...new Set(questions
      .filter((question) => (!subject || question.subject === subject)
        && question.majorCategory === category
        && isAreaEligible(question, isAcupuncture)
        && supportsMiddleCategory(question, isAcupuncture)
        && question.middleCategory)
      .map((question) => question.middleCategory))],
  })).filter((group) => group.items.length > 0);
}

export function matchesQuestionArea(
  question: AreaQuestion,
  subject: string,
  selectedCategories: string[],
  selectedMiddles: string[],
  isAcupuncture: boolean,
) {
  if (!isAreaEligible(question, isAcupuncture)) return false;
  if (subject && question.subject !== subject) return false;
  if (!selectedCategories.includes(question.majorCategory)) return false;
  if (supportsMiddleCategory(question, isAcupuncture)) {
    const picked = selectedMiddles.filter((key) => key.startsWith(`${question.majorCategory}\u0000`));
    if (picked.length > 0 && !picked.includes(`${question.majorCategory}\u0000${question.middleCategory}`)) return false;
  }
  return true;
}
