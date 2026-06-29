import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { fetchAdminSession, loginAdmin } from '../lib/api';

type AppRole = 'operator' | 'admin';

type AdminAuthContextValue = {
  role: AppRole;
  ready: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const SESSION_STORAGE_KEY = 'kurukuru-admin-session';

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

const readStoredSessionToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage.getItem(SESSION_STORAGE_KEY);
};

const writeStoredSessionToken = (token: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (token) {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    return;
  }

  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
};

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>('operator');
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;

    const boot = async () => {
      const storedToken = readStoredSessionToken();
      if (!storedToken) {
        if (!disposed) {
          setReady(true);
        }
        return;
      }

      try {
        const session = await fetchAdminSession(storedToken);
        if (!disposed) {
          setRole('admin');
          setUsername(session.username);
        }
      } catch {
        writeStoredSessionToken(null);
        if (!disposed) {
          setRole('operator');
          setUsername(null);
        }
      } finally {
        if (!disposed) {
          setReady(true);
        }
      }
    };

    void boot();

    return () => {
      disposed = true;
    };
  }, []);

  const login = async (usernameInput: string, password: string) => {
    const session = await loginAdmin(usernameInput, password);
    writeStoredSessionToken(session.token);
    setRole('admin');
    setUsername(session.username);
  };

  const logout = () => {
    writeStoredSessionToken(null);
    setRole('operator');
    setUsername(null);
  };

  return (
    <AdminAuthContext.Provider
      value={{
        role,
        ready,
        username,
        login,
        logout,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error('useAdminAuth must be used within AdminAuthProvider.');
  }

  return context;
}
