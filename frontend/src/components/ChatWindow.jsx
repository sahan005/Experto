import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, Download, AlertCircle, RefreshCw } from 'lucide-react';

const API_URL = 'http://localhost:8081';

function ChatWindow() {
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [context, setContext] = useState({
    expected_start_date: '',
    expected_end_date: '',
    expected_currency: 'USD',
    po_numbers_required: true,
    expected_payment_status: 'Unpaid'
  });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  const chatMutation = useMutation({
    mutationFn: async ({ message, context, history }) => {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history })
      });
      if (!res.ok) throw new Error('Network response was not ok');
      return res.json();
    },
    onSuccess: (data, variables) => {
      if (variables.message === 'Perform initial invoice anomaly scan') {
        setMessages([{
          role: 'assistant',
          content: data.response,
          anomaly_count: data.anomaly_count,
          raw_csv: data.raw_csv
        }]);
        setOnboardingComplete(true);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          anomaly_count: data.anomaly_count,
          raw_csv: data.raw_csv
        }]);
      }
    },
    onError: (err, variables) => {
      console.error(err);
      if (variables.message === 'Perform initial invoice anomaly scan') {
        setMessages([{
          role: 'assistant',
          content: 'System initialized. Context accepted. Awaiting diagnostic query.',
          anomaly_count: 0
        }]);
        setOnboardingComplete(true);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection failure. Diagnostics offline.', anomaly_count: 0 }]);
      }
    }
  });

  const handleOnboardingSubmit = (e) => {
    e.preventDefault();
    chatMutation.mutate({
      message: 'Perform initial invoice anomaly scan',
      context,
      history: []
    });
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    const newMessages = [...messages, { role: 'user', content: userMsg }];
    setMessages(newMessages);
    setInput('');

    chatMutation.mutate({
      message: userMsg,
      context,
      history: newMessages
    });
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
      <div className="panel" style={{ maxWidth: '650px', margin: '0 auto', border: '1px solid var(--border-color)' }}>
        <div className="panel-header">
          <h2>Verification Parameter Selection Screen</h2>
          <span className="badge badge-gray">PROG: INV_VAL_02</span>
        </div>
        <form onSubmit={handleOnboardingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ border: '1px solid #dee2e6', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '2px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', borderBottom: '1px solid #dee2e6', paddingBottom: '4px' }}>
              DATE INTERVAL CRITERIA
            </h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Posting Start Date</label>
                <input type="date" className="form-input" style={{ height: '28px', padding: '3px 8px' }} value={context.expected_start_date} onChange={e => setContext({...context, expected_start_date: e.target.value})} />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Posting End Date</label>
                <input type="date" className="form-input" style={{ height: '28px', padding: '3px 8px' }} value={context.expected_end_date} onChange={e => setContext({...context, expected_end_date: e.target.value})} />
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid #dee2e6', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '2px', marginTop: '4px' }}>
            <h3 style={{ fontSize: '12px', fontWeight: '700', marginBottom: '8px', borderBottom: '1px solid #dee2e6', paddingBottom: '4px' }}>
              DOCUMENT CONTROL CRITERIA
            </h3>
            <div className="form-group">
              <label className="form-label">Expected ISO Currency</label>
              <select className="form-select" style={{ height: '28px', padding: '3px 8px' }} value={context.expected_currency} onChange={e => setContext({...context, expected_currency: e.target.value})} required>
                <option value="USD">USD ($)</option>
                <option value="INR">INR (₹)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CAD">CAD (C$)</option>
                <option value="AUD">AUD (A$)</option>
                <option value="JPY">JPY (¥)</option>
              </select>
            </div>
            
            <div className="form-group">
              <label className="form-label">Expected Payment Status</label>
              <select className="form-select" style={{ height: '28px', padding: '3px 8px' }} value={context.expected_payment_status} onChange={e => setContext({...context, expected_payment_status: e.target.value})} required>
                <option value="Paid">Paid</option>
                <option value="Unpaid">Unpaid</option>
                <option value="Pending">Pending</option>
              </select>
            </div>

            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
              <input type="checkbox" id="poRequiredCheckbox" checked={context.po_numbers_required} onChange={e => setContext({...context, po_numbers_required: e.target.checked})} />
              <label htmlFor="poRequiredCheckbox" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>Require Valid Purchase Order (PO Number)</label>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '10px', padding: '8px' }}>
            Execute Diagnostic & Load Invoice Log
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="chat-container">
      {/* Transaction Control Bar */}
      <div className="panel-header" style={{ margin: 0, padding: '8px 15px', borderBottom: '1px solid var(--border-color)', backgroundColor: '#f8f9fa' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="status-indicator high"></div>
          <h3 style={{ margin: 0, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invoice Analysis Journal</h3>
        </div>
        <span className="badge badge-gray" style={{ fontSize: '9px' }}>TX_STATUS: INITIALIZED</span>
      </div>

      {/* Persistent Selection Criteria Bar */}
      <div style={{
        backgroundColor: '#eef2f5',
        borderBottom: '1px solid var(--border-color)',
        padding: '6px 15px',
        fontSize: '11px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '15px',
        alignItems: 'center'
      }}>
        <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)' }}>SELECTION PARAMETERS:</span>
        <div><span style={{ color: '#555', fontWeight: '600' }}>Date Interval:</span> {context.expected_start_date || 'ANY'} to {context.expected_end_date || 'ANY'}</div>
        <div><span style={{ color: '#555', fontWeight: '600' }}>Currency:</span> {context.expected_currency}</div>
        <div><span style={{ color: '#555', fontWeight: '600' }}>PO Required:</span> {context.po_numbers_required ? 'YES' : 'NO'}</div>
        <div><span style={{ color: '#555', fontWeight: '600' }}>Payment Status:</span> {context.expected_payment_status}</div>
        <button 
          className="btn" 
          style={{ marginLeft: 'auto', padding: '1px 6px', fontSize: '10px', height: '20px' }} 
          onClick={() => setOnboardingComplete(false)}
        >
          Adjust Parameters
        </button>
      </div>

      {/* Transaction Journal Logs */}
      <div className="chat-history">
        {messages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.role}`}>
            <div className="chat-message-header">
              <span>{msg.role === 'user' ? 'OPERATOR AUDIT QUERY' : 'VERIFICATION EXCEPTION REPORT'}</span>
              {msg.role === 'assistant' && msg.anomaly_count !== undefined && (
                <span className={`badge ${msg.anomaly_count > 0 ? 'badge-red' : 'badge-green'}`}>
                  {msg.anomaly_count} Anomalies Detected
                </span>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-sans)', fontSize: '12px', color: '#333' }}>
              {msg.content}
            </div>
            {msg.role === 'assistant' && msg.raw_csv && (
              <div style={{ marginTop: '8px' }}>
                <button className="btn" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => downloadCSV(msg.raw_csv)}>
                  <Download size={12} /> Export Exception Log (CSV)
                </button>
              </div>
            )}
          </div>
        ))}
        {chatMutation.isPending && (
          <div className="chat-message assistant" style={{ opacity: 0.8 }}>
            <div className="chat-message-header">SYSTEM PROCESSING</div>
            <div className="typing-indicator">Executing background analysis rules...</div>
          </div>
        )}
      </div>

      {/* Input Action Console */}
      <form className="chat-input-area" onSubmit={handleSendMessage}>
        <input 
          type="text" 
          className="form-input" 
          placeholder="Enter audit check query (e.g., 'Show all PO anomalies')..." 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={chatMutation.isPending}
          style={{ height: '30px', fontSize: '12px' }}
        />
        <button type="submit" className="btn btn-primary" style={{ padding: '4px 15px', height: '30px' }} disabled={chatMutation.isPending || !input.trim()}>
          Execute Query
        </button>
      </form>
    </div>
  );
}

export default ChatWindow;
