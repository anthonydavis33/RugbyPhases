import { memo } from 'react';

const SOLID = [0, 22, 50, 78, 100];
const DASHED_X = [5, 40, 60, 95];
const DASHED_Y = [5, 15, 55, 65];

/** Static rugby union pitch markings in metres (see model/types for axes). */
export const Pitch = memo(function Pitch() {
  const stripes = [];
  for (let x = 0; x < 100; x += 10) {
    stripes.push(<rect key={x} x={x} y={0} width={5} height={70} className="stripe" />);
  }
  return (
    <g className="pitch">
      <rect x={-200} y={-200} width={500} height={470} className="surround" />
      <rect x={-10} y={0} width={120} height={70} className="grass" />
      {stripes}
      <rect x={-10} y={0} width={10} height={70} className="ingoal" />
      <rect x={100} y={0} width={10} height={70} className="ingoal" />
      <rect x={-10} y={0} width={120} height={70} className="line" fill="none" />
      {SOLID.map((x) => (
        <line key={x} x1={x} y1={0} x2={x} y2={70} className="line" />
      ))}
      {DASHED_X.map((x) => (
        <line key={x} x1={x} y1={0} x2={x} y2={70} className="line dashed" />
      ))}
      {DASHED_Y.map((y) => (
        <line key={y} x1={0} y1={y} x2={100} y2={y} className="line dashed" />
      ))}
      {[0, 100].map((x) => (
        <g key={x} className="posts">
          <line x1={x} y1={32.2} x2={x} y2={37.8} />
          <circle cx={x} cy={32.2} r={0.45} />
          <circle cx={x} cy={37.8} r={0.45} />
        </g>
      ))}
    </g>
  );
});
