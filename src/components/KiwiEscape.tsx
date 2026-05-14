import './KiwiEscape.css';

export default function KiwiEscape() {
  return (
    <div className="escape-container" aria-hidden="true">
      <div className="escape-kiwi">
        <img src="/images/kiwi-shrug.jpg" alt="Escaped!" className="escape-emoji" style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover' }} />
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
