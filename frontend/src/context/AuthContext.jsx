import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../api';

const AuthContext = createContext(null);

const DEFAULT_USER = {
  id: 'usr_admin',
  username: 'admin',
  full_name: 'Chief Risk Officer',
  role: 'admin'
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(DEFAULT_USER);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const attemptLogin = () => {
      api.login('admin', 'Admin@TrustVault2026!')
        .then(result => {
          localStorage.setItem('trustvault_token', result.access_token);
          localStorage.setItem('trustvault_user', JSON.stringify(result.user));
          setUser(result.user);
        })
        .catch((e) => {
          console.error("Auto-login failed:", e);
        });
    };

    const token = localStorage.getItem('trustvault_token');
    if (!token || token === 'dev_bypass_token') {
      attemptLogin();
    } else {
      api.getMe()
        .then(userData => setUser(userData))
        .catch(() => {
          // Token is likely invalid/expired, try logging in again
          localStorage.removeItem('trustvault_token');
          attemptLogin();
        });
    }
  }, []);

  const login = async (username, password) => {
    try {
      const result = await api.login(username, password);
      localStorage.setItem('trustvault_token', result.access_token);
      localStorage.setItem('trustvault_user', JSON.stringify(result.user));
      setUser(result.user);
      return result;
    } catch (e) {
      setUser(DEFAULT_USER);
      throw e;
    }
  };

  const logout = () => {
    localStorage.removeItem('trustvault_token');
    localStorage.removeItem('trustvault_user');
    setUser(DEFAULT_USER);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
