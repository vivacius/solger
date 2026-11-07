import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import './LandingPage.css';

interface LandingPageProps {
  onStart?: () => void;
}

export default function LandingPage({ onStart }: LandingPageProps) {
  const { login } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setAnimateIn(true), 100);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(identifier, password);
      if (res.ok) {
        onStart?.();
      } else {
        setError(res.error || 'Usuario o contraseña incorrectos');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="landing-root">
      {/* ── Background video ─────────────────────────────── */}
      <div className="landing-video-wrapper">
        <video
          ref={videoRef}
          className={`landing-video ${videoLoaded ? 'loaded' : ''}`}
          src="/banner_video.mp4"
          autoPlay
          loop
          muted
          playsInline
          onCanPlay={() => {
            setVideoLoaded(true);
            if (videoRef.current) {
              videoRef.current.playbackRate = 0.85;
            }
          }}
        />
        {/* Gradient overlay */}
        <div className="landing-overlay" />
      </div>

      {/* ── Content ──────────────────────────────────────── */}
      <div className={`landing-content ${animateIn ? 'animate-in' : ''}`}>
        {/* Logo */}
        <div className="landing-logos">
          <img
            src="/logo.png"
            alt="SOLGER Logo"
            className="landing-logo-main"
          />
        </div>

        {/* Divider */}
        <div className="landing-divider">
          <span className="landing-divider-line" />
          <span className="landing-divider-icon">⚡</span>
          <span className="landing-divider-line" />
        </div>

        {/* Title */}
        <h1 className="landing-h1">Centro de Inteligencia Energética</h1>

        {/* Formulario integrado en la tarjeta de vidrio original */}
        <form onSubmit={handleSubmit} className="landing-form">
          <input
            type="text"
            className="landing-input"
            placeholder="Usuario o correo electrónico"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
          <input
            type="password"
            className="landing-input"
            placeholder="Contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && <div className="landing-error">{error}</div>}

          <button
            id="landing-start-btn"
            type="submit"
            disabled={loading}
            className="landing-cta"
          >
            <span className="landing-cta-text">
              {loading ? 'Ingresando…' : 'Iniciar plataforma'}
            </span>
            <span className="landing-cta-arrow">→</span>
          </button>
        </form>
      </div>
    </div>
  );
}
