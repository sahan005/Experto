import { useState } from 'react';
import UploadWindow from './components/UploadWindow';
import ChatWindow from './components/ChatWindow';

function App() {
  const [currentView, setCurrentView] = useState('upload'); // 'upload' or 'chat'
  
  const handleMappingConfirmed = () => {
    setCurrentView('chat');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-page)' }}>
      {/* Modern SaaS Navigation Header */}
      <header style={{ 
        backgroundColor: 'var(--bg-card)', 
        borderBottom: '1px solid var(--border-color)',
        padding: '14px 24px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        boxShadow: '0 1px 2px 0 rgba(15, 23, 42, 0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Minimalist Logo Icon */}
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 'bold',
              fontSize: '18px'
            }}>
              E
            </div>
            <span style={{ 
              fontWeight: '700', 
              fontSize: '18px', 
              letterSpacing: '-0.02em', 
              color: 'var(--text-main)' 
            }}>
              Experto<span style={{ color: 'var(--accent-primary)', fontWeight: '500' }}>.ai</span>
            </span>
          </div>
          <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)' }}></div>
          <span style={{ 
            fontSize: '12px',
            fontFamily: 'var(--font-mono)', 
            color: 'var(--text-light)',
            backgroundColor: '#f1f5f9',
            padding: '4px 8px',
            borderRadius: '6px',
            fontWeight: '500'
          }}>
            v1.0.4
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '13px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-light)' }}>Workspace:</span>
            <span style={{ 
              fontWeight: '600', 
              color: 'var(--text-main)',
              backgroundColor: 'var(--bg-page)',
              padding: '4px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)'
            }}>
              {currentView === 'upload' ? 'Document Ingestion' : 'Audit Exception Control'}
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: 'var(--status-green)',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: '50%',
                backgroundColor: 'var(--status-green)',
                opacity: 0.4,
                animation: 'pulse-ring 2s infinite'
              }}></div>
            </div>
            <span style={{ fontWeight: '500', color: 'var(--text-muted)' }}>Audit Engine Online</span>
          </div>
        </div>
      </header>

      {/* Main Client Area */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="container" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {currentView === 'upload' ? (
            <UploadWindow onConfirmed={handleMappingConfirmed} />
          ) : (
            <ChatWindow />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
