import React, { createContext, useContext, useState } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const STORAGE_KEY = 'solger_analyst_session_v1';

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  login: async () => ({ ok: false }),
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as AuthUser;
    } catch {
      /* ignore */
    }
    return null;
  });

  const saveSession = (u: AuthUser) => {
    setUser(u);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
  };

  const login = async (
    identifier: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const cleanId = identifier.trim();
    const cleanPass = password.trim();

    if (!cleanId || !cleanPass) {
      return { ok: false, error: 'Ingresa tu usuario/correo y contraseña.' };
    }

    // 1. Intentar primero Supabase Auth si es un correo y están las credenciales de Supabase
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (cleanId.includes('@') && supabaseUrl && supabaseAnonKey) {
      try {
        const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: cleanId, password: cleanPass }),
        });

        if (res.ok) {
          const authData = await res.json();
          const supaUser = authData.user;
          saveSession({
            id: supaUser.id,
            email: supaUser.email || cleanId,
            nombre: supaUser?.user_metadata?.nombre || cleanId.split('@')[0],
          });
          return { ok: true };
        }
      } catch {
        /* continúa a validación operativa */
      }
    }

    // 2. Validación de credenciales operativas del Analista SOLGER
    const validUsers = ['solger', 'admin', 'analista', 'admin@solger.com.co', 'operaciones@solger.com.co'];
    const validPasswords = ['SOLGER', 'solger', 'Solger2026', 'Solger2026*', 'admin123', '26461580'];

    if (
      validUsers.includes(cleanId.toLowerCase()) &&
      validPasswords.includes(cleanPass)
    ) {
      saveSession({
        id: 'solger-analyst-01',
        email: cleanId.includes('@') ? cleanId : `${cleanId.toLowerCase()}@solger.com.co`,
        nombre: cleanId.toUpperCase() === 'SOLGER' ? 'Analista SOLGER' : cleanId,
      });
      return { ok: true };
    }

    return {
      ok: false,
      error: 'Usuario o contraseña incorrectos. Verifica tus credenciales en Supabase Auth o usa el usuario operativo SOLGER.',
    };
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
