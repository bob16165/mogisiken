import React from 'react';

interface ScoreCircleChartProps {
  scoreRate: number; // 個人の得点率
  averageRate: number; // 平均得点率
  stdDeviation: number; // 標準偏差
  size?: number; // 円のサイズ
}

const ScoreCircleChart: React.FC<ScoreCircleChartProps> = ({
  scoreRate,
  averageRate,
  stdDeviation,
  size = 120,
}) => {
  const center = size / 2;
  const radius = (size / 2) - 15;
  const strokeWidth = 8;

  // 得点率を角度に変換（0%=0度、100%=360度）
  const scoreAngle = (scoreRate / 100) * 360;
  const avgAngle = (averageRate / 100) * 360;
  
  // D（-1標準偏差）とA（+1標準偏差）の得点率
  const dRate = Math.max(0, averageRate - stdDeviation);
  const aRate = Math.min(100, averageRate + stdDeviation);
  const dAngle = (dRate / 100) * 360;
  const aAngle = (aRate / 100) * 360;

  // 角度から座標を計算（上から時計回り、0度=12時の位置）
  const polarToCartesian = (angle: number, r: number) => {
    const radian = ((angle - 90) * Math.PI) / 180;
    return {
      x: center + r * Math.cos(radian),
      y: center + r * Math.sin(radian),
    };
  };

  // マーカーの位置を計算
  const scorePos = polarToCartesian(scoreAngle, radius);
  const avgPos = polarToCartesian(avgAngle, radius + 10);
  const dPos = polarToCartesian(dAngle, radius + 10);
  const aPos = polarToCartesian(aAngle, radius + 10);

  // 円弧のパスを生成
  const describeArc = (startAngle: number, endAngle: number) => {
    const start = polarToCartesian(startAngle, radius);
    const end = polarToCartesian(endAngle, radius);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return [
      'M', start.x, start.y,
      'A', radius, radius, 0, largeArcFlag, 1, end.x, end.y,
    ].join(' ');
  };

  return (
    <svg width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
      {/* 背景の円 */}
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="#e0e0e0"
        strokeWidth={strokeWidth}
      />

      {/* 得点率の円弧（青色） */}
      {scoreRate > 0 && (
        <path
          d={describeArc(0, scoreAngle)}
          fill="none"
          stroke="#2196F3"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      )}

      {/* 個人の得点マーカー（青い点） */}
      <circle
        cx={scorePos.x}
        cy={scorePos.y}
        r={6}
        fill="#2196F3"
        stroke="white"
        strokeWidth={2}
      />

      {/* 平均のマーカー（緑の線） */}
      <line
        x1={avgPos.x}
        y1={avgPos.y}
        x2={center}
        y2={center}
        stroke="#4CAF50"
        strokeWidth={2}
      />
      <text
        x={avgPos.x}
        y={avgPos.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="12"
        fontWeight="bold"
        fill="#4CAF50"
      >
        平均
      </text>

      {/* Dマーカー（-1標準偏差、オレンジ） */}
      <line
        x1={dPos.x}
        y1={dPos.y}
        x2={center}
        y2={center}
        stroke="#FF9800"
        strokeWidth={2}
        strokeDasharray="3,3"
      />
      <text
        x={dPos.x}
        y={dPos.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="12"
        fontWeight="bold"
        fill="#FF9800"
      >
        D
      </text>

      {/* Aマーカー（+1標準偏差、赤） */}
      <line
        x1={aPos.x}
        y1={aPos.y}
        x2={center}
        y2={center}
        stroke="#F44336"
        strokeWidth={2}
        strokeDasharray="3,3"
      />
      <text
        x={aPos.x}
        y={aPos.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="12"
        fontWeight="bold"
        fill="#F44336"
      >
        A
      </text>

      {/* 中央の得点率テキスト */}
      <text
        x={center}
        y={center - 5}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="20"
        fontWeight="bold"
        fill="#333"
      >
        {scoreRate.toFixed(1)}%
      </text>

      {/* 0%と100%のマーク */}
      <text
        x={center}
        y={10}
        textAnchor="middle"
        fontSize="10"
        fill="#999"
      >
        0%/100%
      </text>
    </svg>
  );
};

export default ScoreCircleChart;
