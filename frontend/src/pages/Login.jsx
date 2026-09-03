import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, User, Headphones, CreditCard, Lock } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const quickLogin = async (user, pass) => {
    setUsername(user);
    setPassword(pass);
    setError('');
    setLoading(true);
    try {
      await login(user, pass);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="glass-card login-card no-hover fade-in">
        <div className="login-brand">
          <div className="brand-logo-icon">
            <Shield size={24} strokeWidth={2.4} />
          </div>
          <h1>TrustVault</h1>
          <p>Multi-Agent Governance Platform</p>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              className="form-input"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> : 'Sign In'}
          </button>
        </form>

        <div className="demo-credentials">
          <h4>Quick Demo Login</h4>
          <div className="cred-row" style={{ cursor: 'pointer' }} onClick={() => quickLogin('admin', 'Admin@TrustVault2026!')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Shield size={13} color="var(--accent-cyan)" /> Admin
            </span>
            <code>admin / Admin@TrustVault2026!</code>
          </div>
          <div className="cred-row" style={{ cursor: 'pointer' }} onClick={() => quickLogin('csr_agent', 'CsrAgent@TrustVault2026!')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Headphones size={13} color="var(--accent-amber)" /> CSR Agent
            </span>
            <code>csr_agent / CsrAgent@TrustVault2026!</code>
          </div>
          <div className="cred-row" style={{ cursor: 'pointer' }} onClick={() => quickLogin('card_member', 'Member@TrustVault2026!')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CreditCard size={13} color="var(--accent-emerald)" /> Card Member
            </span>
            <code>card_member / Member@TrustVault2026!</code>
          </div>
        </div>
      </div>
    </div>
  );
}
