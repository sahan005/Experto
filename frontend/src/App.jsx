import { useState } from 'react';
import UploadWindow from './components/UploadWindow';
import ChatWindow from './components/ChatWindow';

function App() {
  const [currentView, setCurrentView] = useState('upload'); // 'upload' or 'chat'
  
  const handleMappingConfirmed = () => {
    setCurrentView('chat');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ERP Top System Bar */}
      <header style={{ 
        backgroundColor: 'var(--accent-primary)', 
        color: '#ffffff', 
        padding: '8px 20px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        fontFamily: 'var(--font-sans)',
        fontSize: '12px',
        borderBottom: '2px solid #0a2540',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.5px' }}>
            ENTERPRISE INVOICE VERIFICATION
          </span>
          <span style={{ 
            backgroundColor: '#0a2540', 
            color: '#00bcd4', 
            padding: '2px 6px', 
            borderRadius: '2px', 
            fontFamily: 'var(--font-mono)', 
            fontWeight: 'bold',
            fontSize: '11px' 
          }}>
            t-code: INV_ANOMALY
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div>
            <span style={{ color: '#a0aec0', marginRight: '6px' }}>MODULE:</span>
            <span style={{ fontWeight: '600' }}>
              {currentView === 'upload' ? 'DOCUMENT_INGESTION' : 'AUDIT_VERIFICATION'}
            </span>
          </div>
          <div style={{ width: '1px', height: '14px', backgroundColor: '#4a5568' }}></div>
          <div>
            <span style={{ color: '#a0aec0', marginRight: '6px' }}>OPERATOR:</span>
            <span style={{ fontWeight: '600' }}>AUDIT_SYS_USER</span>
          </div>
        </div>
      </header>

      {/* Main ERP Client Area */}
      <div className="container" style={{ flex: 1, padding: '20px' }}>
        {currentView === 'upload' ? (
          <UploadWindow onConfirmed={handleMappingConfirmed} />
        ) : (
          <ChatWindow />
        )}
      </div>
    </div>
  );
}

export default App;
