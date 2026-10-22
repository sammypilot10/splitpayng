import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../api/client';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  emailVerified: boolean;
  reputationScore: number;
  successfulPools: number;
  totalDisputes: number;
  totalMembersServed: number;
  hostSince: string | null;
};

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  refetchUser: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: () => { },
  logout: () => { },
  refetchUser: async () => { },
  isLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refetchUser = async () => {
    try {
      const res: any = await api.get('/auth/me');
      setUser(res.data);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refetchUser().finally(() => setIsLoading(false));
  }, []);

  const login = (userData: User) => {
    setUser(userData);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refetchUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}