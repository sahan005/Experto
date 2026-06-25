import React, { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { Shield, Layers, FileText, ArrowRight, Lock, Loader2, Check } from 'lucide-react';

function LoginWindow() {
  const { login } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8081/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Invalid email or password');
      }

      const data = await response.json();
      login(data.access_token);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-split-container">
      {/* Left: Product Showcase Panel */}
      <div className="login-showcase-panel">
        <div>
          {/* Brand Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 'bold',
              fontSize: '20px',
              boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
            }}>
              E
            </div>
            <span style={{ 
              fontWeight: '800', 
              fontSize: '20px', 
              letterSpacing: '-0.02em', 
              color: '#ffffff' 
            }}>
              Experto<span style={{ color: '#818cf8', fontWeight: '500' }}>.ai</span>
            </span>
          </div>

          {/* Marketing Copy */}
          <h1 style={{ fontSize: '28px', fontWeight: '800', lineHeight: '1.25', letterSpacing: '-0.02em', color: '#ffffff', marginBottom: '16px' }}>
            Automate Invoice Audits with AI Exception Scanning
          </h1>
          <p style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: '1.6', marginBottom: '32px' }}>
            Experto.ai bridges the gap between raw financial documents and your standardized ERP schema. Upload spreadsheets, scans, or PDFs, and let our secure AI models map, validate, and isolate exceptions instantly.
          </p>

          {/* Key Product Features List */}
          <div className="login-showcase-features">
            <div className="login-showcase-feature">
              <div className="login-showcase-feature-icon">
                <Layers size={14} />
              </div>
              <div>
                <span style={{ fontWeight: '700', fontSize: '13px', display: 'block', color: '#ffffff' }}>Unified Ingestion Portal</span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Map raw data headers to standard database structures.</span>
              </div>
            </div>

            <div className="login-showcase-feature">
              <div className="login-showcase-feature-icon">
                <FileText size={14} />
              </div>
              <div>
                <span style={{ fontWeight: '700', fontSize: '13px', display: 'block', color: '#ffffff' }}>Multi-Format Processing</span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Supports CSV sheets, PDF invoices, and image scans.</span>
              </div>
            </div>

            <div className="login-showcase-feature">
              <div className="login-showcase-feature-icon">
                <Shield size={14} />
              </div>
              <div>
                <span style={{ fontWeight: '700', fontSize: '13px', display: 'block', color: '#ffffff' }}>Interactive Diagnostics</span>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>Isolate and trace anomalies using natural language queries.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#64748b', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px', marginTop: '32px' }}>
          <span>© 2026 Experto AI.</span>
          <span>Enterprise Compliance Assured.</span>
        </div>
      </div>

      {/* Right: Sign-In Form Panel */}
      <div className="login-form-panel">
        <div style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-main)', letterSpacing: '-0.02em', marginBottom: '6px' }}>
            Access your workspace
          </h2>
          <p style={{ color: 'var(--text-light)', fontSize: '13px', fontWeight: '500' }}>
            Enter your credentials to enter the audit dashboard.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label className="form-label">Corporate Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="form-input"
              placeholder="operator@experto.ai"
              disabled={isLoading}
              style={{ fontSize: '13px' }}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="form-input"
              placeholder="••••••••"
              disabled={isLoading}
              style={{ fontSize: '13px' }}
            />
          </div>

          {error && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              padding: '10px 14px', 
              backgroundColor: 'var(--status-red-bg)', 
              color: 'var(--status-red)', 
              border: '1px solid var(--status-red-border)',
              borderRadius: '8px', 
              fontSize: '12px', 
              fontWeight: '600' 
            }}>
              <Lock size={14} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn btn-primary"
            style={{
              padding: '12px',
              borderRadius: '8px',
              fontSize: '14px',
              marginTop: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px'
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={16} style={{ animation: 'spin 1.5s linear infinite' }} />
                Authenticating...
              </>
            ) : (
              <>
                Sign In <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>

        {/* Demo Credentials Helper */}
        <div style={{ 
          marginTop: '28px', 
          padding: '12px 16px', 
          backgroundColor: 'var(--bg-page)', 
          borderRadius: '8px', 
          border: '1px solid var(--border-color)',
          fontSize: '12px',
          color: 'var(--text-muted)',
          lineHeight: '1.5'
        }}>
          <span style={{ fontWeight: '700', color: 'var(--text-main)', display: 'block', marginBottom: '2px' }}>
            Proof of Concept Portal
          </span>
          Use seeded accounts to sign in (e.g. administrator or audit operator credentials).
        </div>
      </div>
    </div>
  );
}

export default LoginWindow;
