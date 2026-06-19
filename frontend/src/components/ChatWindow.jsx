import { useState } from 'react';
import { Send, Download, AlertCircle, RefreshCw } from 'lucide-react';

const API_URL = 'http://localhost:8000';

function ChatWindow() {
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [context, setContext] = useState({
    expected_date_range: 'Last 30 days',
    expected_currency: 'USD',
    expected_total_amount_range: '0 - 10000',
    po_numbers_required: true,
    expected_payment_status: 'Unpaid'
  });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    setOnboardingComplete(true);
    setLoading(true);
    
    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Perform initial invoice anomaly scan',
          context,
          history: []
        })
      });
      const data = await res.json();
      setMessages([
        {
          role: 'assistant',
          content: data.response,
          anomaly_count: data.anomaly_count,
          raw_csv: data.raw_csv
        }
      ]);
    } catch (err) {
      console.error(err);
      setMessages([
        {
          role: 'assistant',
          content: 'System initialized. Context accepted. Awaiting diagnostic query.',
          anomaly_count: 0
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    const newMessages = [...messages, { role: 'user', content: userMsg }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          context,
          history: newMessages
        })
      });
      const data = await res.json();
      
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: data.response,
        anomaly_count: data.anomaly_count,
        raw_csv: data.raw_csv
      }]);
    } catch (err) {
      console.error(err);
      setMessages([...newMessages, { role: 'assistant', content: 'Connection failure. Diagnostics offline.', anomaly_count: 0 }]);
    }
    setLoading(false);
  };

  const downloadCSV = (csvContent) => {
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'anomaly_export.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (!onboardingComplete) {
    return (
      <div className="panel" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div className="panel-header">
          <h2>Initialize Context Parameters</h2>
          <AlertCircle size={20} color="var(--accent-primary)" />
        </div>
        <form onSubmit={handleOnboardingSubmit}>
          <div className="form-group">
            <label className="form-label">Expected Date Range</label>
            <input className="form-input" value={context.expected_date_range} onChange={e => setContext({...context, expected_date_range: e.target.value})} required />
          </div>
          <div className="form-group">
            <label className="form-label">Expected Currency</label>
            <input className="form-input" value={context.expected_currency} onChange={e => setContext({...context, expected_currency: e.target.value})} required />
          </div>
          <div className="form-group">
            <label className="form-label">Expected Amount Range</label>
            <input className="form-input" value={context.expected_total_amount_range} onChange={e => setContext({...context, expected_total_amount_range: e.target.value})} required />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label className="form-label" style={{ marginBottom: 0 }}>PO Numbers Required</label>
            <input type="checkbox" checked={context.po_numbers_required} onChange={e => setContext({...context, po_numbers_required: e.target.checked})} />
          </div>
          <div className="form-group">
            <label className="form-label">Expected Payment Status</label>
            <input className="form-input" value={context.expected_payment_status} onChange={e => setContext({...context, expected_payment_status: e.target.value})} required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
            Initialize Diagnostics System
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="panel-header" style={{ margin: 0, padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="status-indicator high"></div>
          <h3 style={{ margin: 0 }}>Diagnostic Chat Interface</h3>
        </div>
        <span className="badge badge-gray">SESSION ACTIVE</span>
      </div>

      <div className="chat-history">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.role}`}>
            <div className="chat-message-header">
              <span>{msg.role === 'user' ? 'OPERATOR' : 'SYSTEM.AI'}</span>
              {msg.role === 'assistant' && msg.anomaly_count !== undefined && (
                <span className={`badge ${msg.anomaly_count > 0 ? 'badge-red' : 'badge-green'}`}>
                  {msg.anomaly_count} Anomalies Detected
                </span>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontFamily: msg.role === 'assistant' ? 'var(--font-sans)' : 'inherit' }}>
              {msg.content}
            </div>
            {msg.role === 'assistant' && msg.raw_csv && (
              <div style={{ marginTop: '1rem' }}>
                <button className="btn" onClick={() => downloadCSV(msg.raw_csv)}>
                  <Download size={14} /> Export CSV
                </button>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-message assistant">
            <div className="chat-message-header">SYSTEM.AI</div>
            <div className="typing-indicator">Processing query...</div>
          </div>
        )}
      </div>

      <form className="chat-input-area" onSubmit={handleSendMessage}>
        <input 
          type="text" 
          className="form-input" 
          placeholder="Enter diagnostic query..." 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

export default ChatWindow;
