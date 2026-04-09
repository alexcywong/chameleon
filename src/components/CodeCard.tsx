import './CodeCard.css';

interface CodeCardProps {
  isChameleon: boolean;
  coordinate?: string; // e.g. "A3"
  secretWord?: string;
}

export default function CodeCard({ isChameleon, coordinate, secretWord }: CodeCardProps) {
  if (isChameleon) {
    return (
      <div className="code-card card card-chameleon reveal-card">
        <span className="label" style={{ color: 'var(--red-400)' }}>Your Card</span>
        <div className="code-card-chameleon-content">
          <span className="chameleon-emoji">🦎</span>
          <h3 className="code-card-title" style={{ color: 'var(--red-400)' }}>
            YOU ARE THE<br />CHAMELEON
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
        <div className="code-card-coordinate">{coordinate}</div>
        <div className="code-card-divider" />
        <div className="code-card-secret">
          <span className="label" style={{ marginBottom: '0.25rem', display: 'block' }}>Secret Word</span>
          <span className="code-card-word">{secretWord}</span>
        </div>
      </div>
    </div>
  );
}
