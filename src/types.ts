// 科目名の型定義
export type SubjectName =
  | '必修'
  | '解剖学'
  | '生理学'
  | '運動学'
  | '病理学'
  | '衛生学'
  | 'リハビリ医学'
  | '一般臨床'
  | '外科学'
  | '整形外科'
  | '柔整理論';

// 科目ごとの結果
export interface SubjectResult {
  score: number; // 得点
  maxScore: number; // 満点
  scoreRate: number; // 得点率（%）
  rank: number; // 順位
  deviation: number; // 偏差値
  averageScoreRate?: number; // 平均得点率（円グラフ用）
  scoreRateStdDev?: number; // 得点率の標準偏差（円グラフ用）
}

// 学生の試験結果
export interface ExamResult {
  studentId: string;
  studentName: string;
  totalScore: number; // 総合点
  totalMaxScore: number; // 総合満点
  requiredScore: number; // 必修点数
  requiredMaxScore: number; // 必修満点
  generalScore: number; // 一般合計（総合点から必修を除いた点）
  generalMaxScore: number; // 一般満点
  
  // 必修の統計情報
  required: SubjectResult;
  
  // 各科目の統計情報
  subjects: {
    [key in SubjectName]?: SubjectResult;
  };
}

// 全学生の結果（計算用）
export interface AllStudentsData {
  students: ExamResult[];
}
