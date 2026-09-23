import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Permission, Role } from '@immo/shared';
import { api, refreshSession, setAccessToken } from './api';

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  organizationId: string;
  permissions: Permission[];
  propertyIds: string[] | null;
}

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  clearPasswordFlag: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustChangePassword, setMust] = useState(false);

  useEffect(() => {
    (async () => {
      if (await refreshSession()) {
        try {
          const r = await api<{ user: CurrentUser }>('/auth/me');
          setUser(r.user);
        } catch {
          setUser(null);
        }
      }
      setLoading(false);
    })();
    const onLogout = () => {
      setAccessToken(null);
      setUser(null);
    };
    window.addEventListener('immo:logout', onLogout);
    return () => window.removeEventListener('immo:logout', onLogout);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ accessToken: string; user: CurrentUser; mustChangePassword: boolean }>('/auth/login', { body: { email, password } });
    setAccessToken(r.accessToken);
    setUser(r.user);
    setMust(r.mustChangePassword);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  const can = useCallback((p: Permission) => !!user?.permissions.includes(p), [user]);

  return (
    <Ctx.Provider value={{ user, loading, login, logout, can, mustChangePassword, clearPasswordFlag: () => setMust(false) }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider fehlt');
  return c;
}
