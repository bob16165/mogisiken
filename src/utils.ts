import { SubjectResult } from './types';

/**
 * 偏差値を計算する
 * @param score 個人の得点
 * @param scores 全員の得点配列
 * @returns 偏差値
 */
export function calculateDeviation(score: number, scores: number[]): number {
  if (scores.length === 0) return 50;
  
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const standardDeviation = Math.sqrt(variance);
  
  if (standardDeviation === 0) return 50;
  
  const deviation = ((score - mean) / standardDeviation) * 10 + 50;
  return Math.round(deviation * 10) / 10; // 小数第1位まで
}

/**
 * 順位を計算する
 * @param score 個人の得点
 * @param scores 全員の得点配列
 * @returns 順位
 */
export function calculateRank(score: number, scores: number[]): number {
  const sortedScores = [...scores].sort((a, b) => b - a);
  return sortedScores.findIndex(s => s === score) + 1;
}

/**
 * 得点率を計算する
 * @param score 得点
 * @param maxScore 満点
 * @returns 得点率（%）
 */
export function calculateScoreRate(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 1000) / 10; // 小数第1位まで
}

/**
 * 科目の統計情報を計算する
 * @param score 個人の得点
 * @param maxScore 満点
 * @param allScores 全員の得点配列
 * @param includeScoreRateStats 得点率の平均と標準偏差を含めるか
 * @returns 科目結果
 */
export function calculateSubjectStats(
  score: number,
  maxScore: number,
  allScores: number[],
  includeScoreRateStats = false
): SubjectResult {
  const scoreRate = calculateScoreRate(score, maxScore);
  
  const result: SubjectResult = {
    score,
    maxScore,
    scoreRate,
    rank: calculateRank(score, allScores),
    deviation: calculateDeviation(score, allScores),
  };

  // 得点率の平均と標準偏差を計算（円グラフ用）
  if (includeScoreRateStats) {
    const scoreRates = allScores.map(s => calculateScoreRate(s, maxScore));
    const avgScoreRate = scoreRates.reduce((sum, r) => sum + r, 0) / scoreRates.length;
    const variance = scoreRates.reduce((sum, r) => sum + Math.pow(r - avgScoreRate, 2), 0) / scoreRates.length;
    const stdDev = Math.sqrt(variance);
    
    result.averageScoreRate = Math.round(avgScoreRate * 10) / 10;
    result.scoreRateStdDev = Math.round(stdDev * 10) / 10;
  }

  return result;
}
