import { useState } from 'react';
import './TopicCard.css';

interface TopicCardProps {
  topic: string;
  words: string[];
  secretWordIndex?: number; // -1 or undefined if chameleon
  showSecret?: boolean;
  selectable?: boolean;
  selectedIndex?: number | null;
  onSelect?: (index: number) => void;
}

export default function TopicCard({
  topic,
  words,
  secretWordIndex,
  showSecret = false,
  selectable = false,
  selectedIndex = null,
  onSelect,
}: TopicCardProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div className="topic-card fade-in">
      <div className="topic-card-header">
        <span className="label">Topic Card</span>
        <h3 className="title-md">{topic}</h3>
      </div>

      <div className="topic-grid-wrapper">
        {/* Grid rows — no row/column labels */}
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="topic-grid-row">
            {[0, 1, 2, 3].map((col) => {
              const index = row * 4 + col;
              const word = words[index] || '';
              const isSecret = showSecret && index === secretWordIndex;
              const isSelected = index === selectedIndex;
              const isHovered = index === hoveredIndex;

              return (
                <div
                  key={index}
                  className={`word-cell topic-word ${isSecret ? 'is-secret' : ''} ${
                    selectable ? 'is-guess-option' : ''
                  } ${isSelected ? 'is-selected' : ''} ${
                    isHovered && selectable ? 'is-hovered' : ''
                  }`}
                  onClick={() => selectable && onSelect?.(index)}
                  onMouseEnter={() => selectable && setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  {word}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
