import React, { createContext, useContext, useState, useEffect } from 'react';

export type UserRole = 'admin_solger' | 'analista' | 'tecnico' | 'cliente';

export interface AuthUser {
  id: string;
  email: string;
  nombre: string;
  rol: UserRole;
  clienteId?: string | null;
  assignedPlantCode?: string | null;
  isSupabaseSession?: boolean;
}

interface AuthContextValue {
  user: AuthUser;
  setRoleView: (rol: UserRole, assignedPlantCode?: string | null) => void;
  signInWithSupabase: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => void;
}

const STORAGE_KEY = 'solger_auth_user_v1';

const DEFAULT_USER: AuthUser = {
  id: 'solger-ops-default',
  email: 'operaciones@solger.com.co',
  nombre: 'Centro O&M SOLGER',
  rol: 'analista',
  assignedPlantCode: null,
  isSupabaseSession: false,
};

const AuthContext = createContext<AuthContextValue>({
  user: DEFAULT_USER,
  setRoleView: () => {},
  signInWithSupabase: async () => ({ ok: false }),
  signOut: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as AuthUser;
    } catch {
      /* ignore */
    }
    return DEFAULT_USER;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch {
      /* ignore */
    }
  }, [user]);

  const setRoleView = (rol: UserRole, assignedPlantCode?: string | null) => {
    setUser(prev => ({
      ...prev,
      rol,
      nombre: rol === 'cliente' ? 'Portal Cliente B2B' : 'Centro O&M SOLGER',
      assignedPlantCode: assignedPlantCode !== undefined ? assignedPlantCode : prev.assignedPlantCode,
    }));
  };

  const signInWithSupabase = async (
    email: string,
    password: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return { ok: false, error: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no configurados.' };
    }

    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        return {
          ok: false,
          error: errData.error_description || errData.msg || 'Credenciales inválidas en Supabase Auth',
        };
      }

      const authData = await res.json();
      const accessToken = authData.access_token;
      const supaUser = authData.user;

      // Consultar perfil en solger.usuario_perfil
      let rol: UserRole = 'analista';
      let nombre = supaUser?.user_metadata?.nombre || email.split('@')[0];
      let clienteId: string | null = null;

      try {
        const profRes = await fetch(
          `${supabaseUrl}/rest/v1/usuario_perfil?user_id=eq.${supaUser.id}&select=*`,
          {
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
              'Accept-Profile': 'solger',
            },
          }
        );
        if (profRes.ok) {
          const rows = await profRes.json();
          if (rows && rows.length > 0) {
            rol = (rows[0].rol as UserRole) || 'analista';
            nombre = rows[0].nombre || nombre;
            clienteId = rows[0].cliente_id || null;
          }
        }
      } catch {
        /* fallback a rol analista */
      }

      setUser({
        id: supaUser.id,
        email: supaUser.email || email,
        nombre,
        rol,
        clienteId,
        assignedPlantCode: null,
        isSupabaseSession: true,
      });

      return { ok: true };
    } catch (e: unknown) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Error de red conectando a Supabase Auth',
      };
    }
  };

  const signOut = () => {
    setUser(DEFAULT_USER);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, setRoleView, signInWithSupabase, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

