import { ExamResult, SubjectName } from './types';
import { calculateSubjectStats } from './utils';

// サンプルデータ（複数の学生の結果）
const rawStudentScores = [
  {
    studentId: 'S001',
    studentName: '山田太郎',
    required: 45,
    解剖学: 38,
    生理学: 42,
    運動学: 35,
    病理学: 40,
    衛生学: 36,
    リハビリ医学: 41,
    一般臨床: 44,
    外科学: 39,
    整形外科: 43,
    柔整理論: 40,
  },
  {
    studentId: 'S002',
    studentName: '佐藤花子',
    required: 42,
    解剖学: 35,
    生理学: 38,
    運動学: 40,
    病理学: 37,
    衛生学: 39,
    リハビリ医学: 38,
    一般臨床: 41,
    外科学: 36,
    整形外科: 40,
    柔整理論: 38,
  },
  {
    studentId: 'S003',
    studentName: '鈴木一郎',
    required: 48,
    解剖学: 42,
    生理学: 45,
    運動学: 38,
    病理学: 43,
    衛生学: 40,
    リハビリ医学: 44,
    一般臨床: 46,
    外科学: 41,
    整形外科: 45,
    柔整理論: 43,
  },
  {
    studentId: 'S004',
    studentName: '田中美咲',
    required: 40,
    解剖学: 33,
    生理学: 36,
    運動学: 38,
    病理学: 35,
    衛生学: 37,
    リハビリ医学: 36,
    一般臨床: 39,
    外科学: 34,
    整形外科: 38,
    柔整理論: 36,
  },
  {
    studentId: 'S005',
    studentName: '高橋健',
    required: 46,
    解剖学: 40,
    生理学: 43,
    運動学: 36,
    病理学: 41,
    衛生学: 38,
    リハビリ医学: 42,
    一般臨床: 44,
    外科学: 39,
    整形外科: 42,
    柔整理論: 41,
  },
];

// 満点設定
const maxScores = {
  required: 50,
  解剖学: 50,
  生理学: 50,
  運動学: 50,
  病理学: 50,
  衛生学: 50,
  リハビリ医学: 50,
  一般臨床: 50,
  外科学: 50,
  整形外科: 50,
  柔整理論: 50,
};

const subjectNames: SubjectName[] = [
  '解剖学',
  '生理学',
  '運動学',
  '病理学',
  '衛生学',
  'リハビリ医学',
  '一般臨床',
  '外科学',
  '整形外科',
  '柔整理論',
];

/**
 * サンプルデータから試験結果を生成
 */
export function generateExamResults(): ExamResult[] {
  // 各科目の全学生の点数を収集
  const allRequiredScores = rawStudentScores.map(s => s.required);
  const allSubjectScores: { [key in SubjectName]?: number[] } = {};
  
  subjectNames.forEach(subjectName => {
    allSubjectScores[subjectName] = rawStudentScores.map(
      s => s[subjectName] as number
    );
  });

  // 各学生の結果を計算
  return rawStudentScores.map(student => {
    // 総合点計算
    const subjectScores = subjectNames.map(name => student[name] as number);
    const totalScore = student.required + subjectScores.reduce((sum, s) => sum + s, 0);
    const totalMaxScore = maxScores.required + subjectNames.length * 50;
    
    // 一般合計（必修を除く）
    const generalScore = subjectScores.reduce((sum, s) => sum + s, 0);
    const generalMaxScore = subjectNames.length * 50;

    // 必修の統計（円グラフ用の統計情報を含める）
    const requiredStats = calculateSubjectStats(
      student.required,
      maxScores.required,
      allRequiredScores,
      true // 得点率の平均と標準偏差を含める
    );

    // 各科目の統計（円グラフ用の統計情報を含める）
    const subjects: { [key in SubjectName]?: any } = {};
    subjectNames.forEach(subjectName => {
      subjects[subjectName] = calculateSubjectStats(
        student[subjectName] as number,
        maxScores[subjectName],
        allSubjectScores[subjectName] || [],
        true // 得点率の平均と標準偏差を含める
      );
    });

    return {
      studentId: student.studentId,
      studentName: student.studentName,
      totalScore,
      totalMaxScore,
      requiredScore: student.required,
      requiredMaxScore: maxScores.required,
      generalScore,
      generalMaxScore,
      required: requiredStats,
      subjects,
    };
  });
}
