import { useState } from 'react';
import UploadWindow from './components/UploadWindow';
import ChatWindow from './components/ChatWindow';

function App() {
  const [currentView, setCurrentView] = useState('upload'); // 'upload' or 'chat'
  
  const handleMappingConfirmed = () => {
    setCurrentView('chat');
  };

  return (
    <div className="container">
      <header style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <h1 style={{ color: 'var(--accent-primary)', margin: 0 }}>SYS.INV</h1>
        <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--border-color)' }}></div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          ANOMALY DETECTION SUITE v1.0
        </span>
      </header>
      
      {currentView === 'upload' ? (
        <UploadWindow onConfirmed={handleMappingConfirmed} />
      ) : (
        <ChatWindow />
      )}
    </div>
  );
}

export default App;
