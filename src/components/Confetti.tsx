import { useEffect, useState } from 'react';
import './Confetti.css';

interface ConfettiPiece {
  id: number;
  x: number;
  color: string;
  delay: number;
  size: number;
  rotation: number;
  drift: number;
}

const CONFETTI_COLORS = [
  '#10b981', '#34d399', '#6ee7b7', // greens
  '#f59e0b', '#fbbf24', '#fcd34d', // golds
  '#3b82f6', '#60a5fa',            // blues
  '#ec4899', '#f472b6',            // pinks
  '#a855f7', '#c084fc',            // purples
  '#ef4444', '#f87171',            // reds
];

export default function Confetti() {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  useEffect(() => {
    const newPieces: ConfettiPiece[] = [];
    for (let i = 0; i < 80; i++) {
      newPieces.push({
        id: i,
        x: Math.random() * 100,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        delay: Math.random() * 0.8,
        size: Math.random() * 8 + 4,
        rotation: Math.random() * 360,
        drift: (Math.random() - 0.5) * 60,
      });
    }
    setPieces(newPieces);
  }, []);

  return (
    <div className="confetti-container" aria-hidden="true">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.x}%`,
            backgroundColor: p.color,
            width: `${p.size}px`,
            height: `${p.size * 0.6}px`,
            animationDelay: `${p.delay}s`,
            transform: `rotate(${p.rotation}deg)`,
            '--drift': `${p.drift}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
