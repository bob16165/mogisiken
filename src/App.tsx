import React, { useState } from 'react';
import ExamResultView from './ExamResultView';
import { generateExamResults } from './sampleData';
import { ExamResult } from './types';

function App() {
  const [allResults] = useState<ExamResult[]>(generateExamResults());
  const [selectedStudentId, setSelectedStudentId] = useState<string>(allResults[0]?.studentId || '');

  const selectedResult = allResults.find(r => r.studentId === selectedStudentId);

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa' }}>
      <div style={{ 
        background: '#1976d2', 
        color: 'white', 
        padding: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 15px 0' }}>模擬試験結果閲覧システム</h1>
          <div>
            <label htmlFor="student-select" style={{ marginRight: '10px' }}>
              学生選択:
            </label>
            <select
              id="student-select"
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              style={{
                padding: '8px 12px',
                fontSize: '16px',
                borderRadius: '4px',
                border: 'none',
                minWidth: '200px',
              }}
            >
              {allResults.map(result => (
                <option key={result.studentId} value={result.studentId}>
                  {result.studentId} - {result.studentName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selectedResult && <ExamResultView result={selectedResult} />}
    </div>
  );
}

export default App;
