import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, type OrgSummary, type User } from '@/lib/api';

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated' | 'error';
  user: User | null;
  organizations: OrgSummary[];
  error: unknown;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [organizations, setOrgs] = useState<OrgSummary[]>([]);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User; organizations: OrgSummary[] }>('GET', '/auth/me');
      setUser(me.user);
      setOrgs(me.organizations);
      setError(null);
      setStatus('authenticated');
    } catch (e) {
      setUser(null);
      setOrgs([]);
      if (e instanceof ApiError && e.status === 401) {
        setError(null);
        setStatus('anonymous');
      } else {
        setError(e);
        setStatus('error');
      }
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<undefined>('POST', '/auth/logout');
    } finally {
      setUser(null);
      setOrgs([]);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ status, user, organizations, error, refresh, logout }),
    [status, user, organizations, error, refresh, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
