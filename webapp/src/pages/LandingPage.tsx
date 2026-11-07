import { useEffect, useRef, useState } from 'react';
import './LandingPage.css';

interface LandingPageProps {
  onStart: () => void;
}

export default function LandingPage({ onStart }: LandingPageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    // Trigger entrance animation shortly after mount
    const t = setTimeout(() => setAnimateIn(true), 100);
    return () => clearTimeout(t);
  }, []);

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
              videoRef.current.playbackRate = 0.85; // mitad de velocidad
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

        {/* CTA Button */}
        <button
          id="landing-start-btn"
          className="landing-cta"
          onClick={onStart}
        >
          <span className="landing-cta-text">Iniciar plataforma</span>
          <span className="landing-cta-arrow">→</span>
        </button>
      </div>
    </div>
  );
}
