import React from 'react';
import { ExamResult, SubjectName } from './types';
import ScoreCircleChart from './ScoreCircleChart';

interface ExamResultViewProps {
  result: ExamResult;
}

const ExamResultView: React.FC<ExamResultViewProps> = ({ result }) => {
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

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>模擬試験結果</h1>
      
      <div style={{ 
        background: '#f5f5f5', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h2 style={{ margin: '0 0 10px 0' }}>学生情報</h2>
        <p style={{ margin: '5px 0' }}><strong>受験番号:</strong> {result.studentId}</p>
        <p style={{ margin: '5px 0' }}><strong>氏名:</strong> {result.studentName}</p>
      </div>

      {/* 総合点セクション */}
      <div style={{ 
        background: '#e3f2fd', 
        padding: '15px', 
        borderRadius: '8px',
        marginBottom: '20px' 
      }}>
        <h2 style={{ margin: '0 0 10px 0' }}>総合成績</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
          <div>
            <strong>総合点:</strong> {result.totalScore}/{result.totalMaxScore}
          </div>
          <div>
            <strong>必修:</strong> {result.requiredScore}/{result.requiredMaxScore}
          </div>
          <div>
            <strong>一般合計:</strong> {result.generalScore}/{result.generalMaxScore}
          </div>
        </div>
      </div>

      {/* 必修の詳細 */}
      <div style={{ marginBottom: '20px' }}>
        <h2>必修</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', marginBottom: '20px' }}>
          {/* 円グラフ */}
          <div>
            {result.required.averageScoreRate !== undefined && result.required.scoreRateStdDev !== undefined && (
              <ScoreCircleChart
                scoreRate={result.required.scoreRate}
                averageRate={result.required.averageScoreRate}
                stdDeviation={result.required.scoreRateStdDev}
                size={150}
              />
            )}
            <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '12px', color: '#666' }}>
              <div><span style={{ color: '#4CAF50' }}>●</span> 平均: {result.required.averageScoreRate?.toFixed(1)}%</div>
              <div><span style={{ color: '#FF9800' }}>●</span> D (-1σ): {Math.max(0, (result.required.averageScoreRate || 0) - (result.required.scoreRateStdDev || 0)).toFixed(1)}%</div>
              <div><span style={{ color: '#F44336' }}>●</span> A (+1σ): {Math.min(100, (result.required.averageScoreRate || 0) + (result.required.scoreRateStdDev || 0)).toFixed(1)}%</div>
            </div>
          </div>
          
          {/* テーブル */}
          <table style={{ 
            width: '100%', 
            borderCollapse: 'collapse',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            alignSelf: 'start'
          }}>
            <thead>
              <tr style={{ background: '#1976d2', color: 'white' }}>
                <th style={tableHeaderStyle}>得点</th>
                <th style={tableHeaderStyle}>得点率</th>
                <th style={tableHeaderStyle}>順位</th>
                <th style={tableHeaderStyle}>偏差値</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'white' }}>
                <td style={tableCellStyle}>
                  {result.required.score}/{result.required.maxScore}
                </td>
                <td style={tableCellStyle}>{result.required.scoreRate}%</td>
                <td style={tableCellStyle}>{result.required.rank}位</td>
                <td style={tableCellStyle}>{result.required.deviation}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 各科目の詳細 */}
      <div>
        <h2>科目別成績</h2>
        <table style={{ 
          width: '100%', 
          borderCollapse: 'collapse',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          marginBottom: '30px'
        }}>
          <thead>
            <tr style={{ background: '#1976d2', color: 'white' }}>
              <th style={tableHeaderStyle}>科目</th>
              <th style={tableHeaderStyle}>得点</th>
              <th style={tableHeaderStyle}>得点率</th>
              <th style={tableHeaderStyle}>順位</th>
              <th style={tableHeaderStyle}>偏差値</th>
            </tr>
          </thead>
          <tbody>
            {subjectNames.map((subjectName, index) => {
              const subject = result.subjects[subjectName];
              if (!subject) return null;
              
              return (
                <tr 
                  key={subjectName}
                  style={{ background: index % 2 === 0 ? 'white' : '#f9f9f9' }}
                >
                  <td style={tableCellStyle}><strong>{subjectName}</strong></td>
                  <td style={tableCellStyle}>
                    {subject.score}/{subject.maxScore}
                  </td>
                  <td style={tableCellStyle}>{subject.scoreRate}%</td>
                  <td style={tableCellStyle}>{subject.rank}位</td>
                  <td style={tableCellStyle}>{subject.deviation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 科目ごとの円グラフ */}
        <h3 style={{ marginBottom: '20px' }}>科目別得点率（円グラフ）</h3>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
          gap: '30px',
          marginBottom: '20px'
        }}>
          {subjectNames.map((subjectName) => {
            const subject = result.subjects[subjectName];
            if (!subject || subject.averageScoreRate === undefined || subject.scoreRateStdDev === undefined) {
              return null;
            }
            
            return (
              <div 
                key={subjectName}
                style={{ 
                  background: 'white',
                  padding: '15px',
                  borderRadius: '8px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                <h4 style={{ textAlign: 'center', margin: '0 0 10px 0', color: '#333' }}>
                  {subjectName}
                </h4>
                <ScoreCircleChart
                  scoreRate={subject.scoreRate}
                  averageRate={subject.averageScoreRate}
                  stdDeviation={subject.scoreRateStdDev}
                  size={180}
                />
                <div style={{ marginTop: '10px', fontSize: '11px', color: '#666' }}>
                  <div style={{ marginBottom: '3px' }}>
                    <span style={{ color: '#2196F3', fontWeight: 'bold' }}>●</span> あなた: {subject.scoreRate}%
                  </div>
                  <div style={{ marginBottom: '3px' }}>
                    <span style={{ color: '#4CAF50' }}>●</span> 平均: {subject.averageScoreRate.toFixed(1)}%
                  </div>
                  <div style={{ marginBottom: '3px' }}>
                    <span style={{ color: '#FF9800' }}>●</span> D (-1σ): {Math.max(0, subject.averageScoreRate - subject.scoreRateStdDev).toFixed(1)}%
                  </div>
                  <div>
                    <span style={{ color: '#F44336' }}>●</span> A (+1σ): {Math.min(100, subject.averageScoreRate + subject.scoreRateStdDev).toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const tableHeaderStyle: React.CSSProperties = {
  padding: '12px',
  textAlign: 'left',
  borderBottom: '2px solid #ddd',
};

const tableCellStyle: React.CSSProperties = {
  padding: '12px',
  borderBottom: '1px solid #ddd',
};

export default ExamResultView;
