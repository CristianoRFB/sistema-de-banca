import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { User } from 'firebase/auth';
import { ToastProvider } from '../components/ui/Toast';
import { watchAdmin } from '../infra/firebase/auth';
import { firebaseReady } from './config';

type AuthState = { user: User | null; loading: boolean; configured: boolean };
const AuthContext = createContext<AuthState>({ user: null, loading: true, configured: firebaseReady });

export function useAdminAuth() { return useContext(AuthContext); }

function AdminAuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseReady);
  useEffect(() => {
    if (!firebaseReady) return;
    return watchAdmin((nextUser) => { setUser(nextUser); setLoading(false); }, () => setLoading(false));
  }, []);
  const value = useMemo(() => ({ user, loading, configured: firebaseReady }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AppProviders({ children }: PropsWithChildren) {
  return <AdminAuthProvider><ToastProvider>{children}</ToastProvider></AdminAuthProvider>;
}
