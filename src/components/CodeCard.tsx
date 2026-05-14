import './CodeCard.css';

interface CodeCardProps {
  isKiwi: boolean;
  coordinate?: string; // kept for compatibility but no longer displayed
  secretWord?: string;
}

export default function CodeCard({ isKiwi, secretWord }: CodeCardProps) {
  if (isKiwi) {
    return (
      <div className="code-card card card-kiwi reveal-card">
        <span className="label" style={{ color: 'var(--red-400)' }}>Your Card</span>
        <div className="code-card-kiwi-content">
          <img src="/images/kiwi-shh.jpg" alt="Kiwi in Disguise" className="kiwi-emoji" style={{ width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover' }} />
          <h3 className="code-card-title" style={{ color: 'var(--red-400)' }}>
            YOU ARE THE<br />KIWI
          </h3>
          <p className="code-card-subtitle">
            Blend in. Don't get caught.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="code-card card card-glow reveal-card">
      <span className="label">Your Card</span>
      <div className="code-card-content">
        <div className="code-card-secret">
          <span className="label" style={{ marginBottom: '0.25rem', display: 'block' }}>Secret Word</span>
          <span className="code-card-word">{secretWord}</span>
        </div>
      </div>
    </div>
  );
}
