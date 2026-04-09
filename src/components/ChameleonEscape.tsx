import './ChameleonEscape.css';

export default function ChameleonEscape() {
  return (
    <div className="escape-container" aria-hidden="true">
      <div className="escape-chameleon">
        <span className="escape-emoji">🦎</span>
        <span className="escape-laugh">😂</span>
      </div>
      <div className="escape-smoke">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="smoke-puff" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <div className="escape-text">💨 ESCAPED!</div>
    </div>
  );
}
