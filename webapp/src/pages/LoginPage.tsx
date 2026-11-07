import { useState } from 'react';
import { Lock, User, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { BRAND } from '../lib/utils';

export default function LoginPage() {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('SOLGER');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login(identifier, password);
      if (!res.ok) {
        setError(res.error || 'Credenciales inválidas');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'radial-gradient(circle at 20% 20%, #163358 0%, #0A1628 60%, #07101E 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Brillo ambiental sutil */}
      <div
        style={{
          position: 'absolute',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(88,174,50,0.14) 0%, transparent 70%)',
          top: '-120px',
          right: '-100px',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'rgba(255, 255, 255, 0.98)',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          overflow: 'hidden',
          zIndex: 1,
        }}
      >
        <div
          style={{
            height: 4,
            background: `linear-gradient(90deg, ${BRAND.green}, ${BRAND.teal}, ${BRAND.gold})`,
          }}
        />

        <div style={{ padding: '32px 30px 28px' }}>
          {/* Logo SOLGER */}
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <img
              src="/logo.png"
              alt="SOLGER"
              style={{ height: 42, width: 'auto', margin: '0 auto 12px', display: 'block' }}
            />
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 10px',
                borderRadius: 99,
                background: BRAND.greenL,
                color: BRAND.greenD,
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginBottom: 6,
              }}
            >
              <ShieldCheck size={12} /> Acceso Analista O&M
            </div>
            <h1 style={{ fontSize: 19, fontWeight: 800, color: BRAND.text, margin: 0 }}>
              Centro de Inteligencia Energética
            </h1>
            <p style={{ fontSize: 12, color: BRAND.muted, marginTop: 4 }}>
              Ingresa tus credenciales de analista para acceder al monitoreo y auditoría del portafolio solar
            </p>
          </div>

          {error && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 12px',
                borderRadius: 8,
                background: '#FEE2E2',
                border: '1px solid #FCA5A5',
                color: '#991B1B',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: BRAND.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                Usuario o Correo Electrónico
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={15}
                  color={BRAND.muted}
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="text"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder="SOLGER o correo@solger.com.co"
                  autoComplete="username"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: 9,
                    border: `1px solid ${BRAND.border}`,
                    background: '#F8FAFC',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: BRAND.text,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: BRAND.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                Contraseña
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={15}
                  color={BRAND.muted}
                  style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Ingresa tu contraseña"
                  autoComplete="current-password"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: 9,
                    border: `1px solid ${BRAND.border}`,
                    background: '#F8FAFC',
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: BRAND.text,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 6,
                width: '100%',
                padding: '11px 16px',
                borderRadius: 9,
                border: 'none',
                background: BRAND.green,
                color: '#FFFFFF',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 14px rgba(88,174,50,0.32)',
                transition: 'all 0.15s',
              }}
            >
              <span>{loading ? 'Verificando acceso…' : 'Ingresar a la Plataforma'}</span>
              <ArrowRight size={15} />
            </button>
          </form>

          <div
            style={{
              marginTop: 18,
              paddingTop: 12,
              borderTop: `1px solid ${BRAND.border}`,
              fontSize: 11,
              color: BRAND.dim,
              textAlign: 'center',
            }}
          >
            Conectado a Supabase (<code>schema: solger</code>) · Usuario rápido: <strong>SOLGER</strong> / Clave: <strong>SOLGER</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
