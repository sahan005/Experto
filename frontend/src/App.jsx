import { useState, useContext, useEffect } from 'react';
import UploadWindow from './components/UploadWindow';
import ChatWindow from './components/ChatWindow';
import LoginWindow from './components/LoginWindow';
import AdminDashboard from './components/AdminDashboard';
import { AuthContext } from './context/AuthContext';

function App() {
  const { user, logout } = useContext(AuthContext);
  const [currentView, setCurrentView] = useState(user?.role === 'admin' ? 'dashboard' : 'upload');
  
  // Automatically route user to correct dashboard on login
  useEffect(() => {
    if (user) {
      setCurrentView(user.role === 'admin' ? 'dashboard' : 'upload');
    }
  }, [user]);
  
  const [uploadMode, setUploadMode] = useState('batch');

  const handleMappingConfirmed = (mode) => {
    setUploadMode(mode || 'batch');
    setCurrentView('chat');
  };

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--sap-bg)', justifyContent: 'center', alignItems: 'center', padding: '24px' }}>
        <LoginWindow />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--sap-bg)' }}>
      {/* SAP Fiori Shell Bar */}
      <header style={{ 
        backgroundColor: 'var(--sap-shell-bg)', 
        color: 'var(--sap-shell-text)',
        padding: '0 20px', 
        height: '44px',
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        boxShadow: '0 1px 0 rgba(0,0,0,0.15)',
        zIndex: 1000
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* SAP Blue Logo Icon */}
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '3px',
              backgroundColor: 'var(--sap-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: '700',
              fontSize: '15px',
              letterSpacing: '-0.02em'
            }}>
              E
            </div>
            <span style={{ 
              fontWeight: '600', 
              fontSize: '15px', 
              color: '#ffffff',
              letterSpacing: '-0.01em'
            }}>
              Experto<span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: '400' }}>.ai</span>
            </span>
          </div>
          <div style={{ width: '1px', height: '20px', backgroundColor: 'rgba(255,255,255,0.15)' }}></div>
          <span style={{ 
            fontSize: '11px',
            fontFamily: 'var(--font-mono)', 
            color: 'rgba(255,255,255,0.5)',
            padding: '0',
            fontWeight: '400'
          }}>
            AUDIT_WORKSPACE
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '13px' }}>
          {user?.role === 'admin' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Workspace:</span>
              <select 
                value={currentView}
                onChange={(e) => setCurrentView(e.target.value)}
                style={{
                  fontWeight: '600', 
                  color: '#ffffff',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  cursor: 'pointer',
                  outline: 'none',
                  fontSize: '12px'
                }}
              >
                <option value="dashboard" style={{ color: 'var(--sap-text-color)' }}>Admin Dashboard</option>
                <option value="upload" style={{ color: 'var(--sap-text-color)' }}>Document Ingestion</option>
                {currentView === 'chat' && (
                  <option value="chat" style={{ color: 'var(--sap-text-color)' }} disabled>Audit Exception Control</option>
                )}
              </select>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#ffffff', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {currentView === 'upload' ? 'Document Ingestion' : 'Audit Exception Control'}
              </span>
            </div>
          )}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: 'var(--sap-success-text)',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: '50%',
                backgroundColor: 'var(--sap-success-text)',
                opacity: 0.4,
                animation: 'pulse-ring 2s infinite'
              }}></div>
            </div>
            <span style={{ fontWeight: '500', color: 'rgba(255,255,255,0.8)', fontSize: '12px' }}>Audit System Online</span>
          </div>

          <button 
            onClick={logout}
            style={{
              padding: '4px 12px',
              backgroundColor: 'transparent',
              color: 'rgba(255,255,255,0.8)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '3px',
              fontSize: '12px',
              fontWeight: '400',
              cursor: 'pointer',
              transition: 'background-color 0.15s',
              fontFamily: 'var(--font-sans)'
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.08)'}
            onMouseOut={(e) => e.target.style.backgroundColor = 'transparent'}
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Client Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="container" style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'flex-start',
          paddingTop: '16px',
          paddingBottom: '32px',
          width: '100%',
          maxWidth: '100%',
          alignItems: 'stretch'
        }}>
          {currentView === 'dashboard' && user?.role === 'admin' && (
            <AdminDashboard />
          )}
          {currentView === 'upload' && (
            <UploadWindow onConfirmed={handleMappingConfirmed} />
          )}
          {currentView === 'chat' && (
            <ChatWindow initialMode={uploadMode} onBackToUpload={() => setCurrentView('upload')} />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
