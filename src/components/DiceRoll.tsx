import { useState, useEffect } from 'react';
import './DiceRoll.css';

interface DiceRollProps {
  yellowValue: number;
  blueValue: number;
  animate?: boolean;
}

export default function DiceRoll({ yellowValue, blueValue, animate = true }: DiceRollProps) {
  const [rolling, setRolling] = useState(animate);
  const [displayYellow, setDisplayYellow] = useState(animate ? 1 : yellowValue);
  const [displayBlue, setDisplayBlue] = useState(animate ? 1 : blueValue);

  useEffect(() => {
    if (!animate) return;

    const interval = setInterval(() => {
      setDisplayYellow(Math.floor(Math.random() * 6) + 1);
      setDisplayBlue(Math.floor(Math.random() * 6) + 1);
    }, 80);

    const timer = setTimeout(() => {
      clearInterval(interval);
      setDisplayYellow(yellowValue);
      setDisplayBlue(blueValue);
      setRolling(false);
    }, 1200);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [yellowValue, blueValue, animate]);

  const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  return (
    <div className="dice-roll-container fade-in">
      <span className="label mb-sm">Dice Roll</span>
      <div className="dice-container">
        <div className={`die die-yellow ${rolling ? 'rolling' : ''}`}>
          {diceFaces[displayYellow - 1]}
        </div>
        <div className={`die die-blue ${rolling ? 'rolling' : ''}`}>
          {diceFaces[displayBlue - 1]}
        </div>
      </div>
    </div>
  );
}
