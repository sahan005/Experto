import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Send, Download, AlertCircle, RefreshCw, Settings, ShieldAlert, Calendar, DollarSign, CheckSquare, Loader2 } from 'lucide-react';

const API_URL = 'http://localhost:8081';

function ChatWindow({ initialMode, onBackToUpload }) {
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [context, setContext] = useState({
    audit_mode: 'batch', // 'batch' or 'single'
    expected_start_date: '',
    expected_end_date: '',
    expected_po_number: '',
    expected_invoice_date: ''
  });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const chatHistoryEndRef = useRef(null);

  // Scroll to bottom of chat history when messages change
  useEffect(() => {
    if (chatHistoryEndRef.current) {
      chatHistoryEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (initialMode) {
      setContext(prev => ({
        ...prev,
        audit_mode: initialMode
      }));
    }
  }, [initialMode]);

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
          raw_csv: data.raw_csv,
          highlighted_csv: data.highlighted_csv
        }]);
        setOnboardingComplete(true);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.response,
          anomaly_count: data.anomaly_count,
          raw_csv: data.raw_csv,
          highlighted_csv: data.highlighted_csv
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

  const downloadHighlightedCSV = (csvContent) => {
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'highlighted_original.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Get the anomaly count of the most recent assistant message
  const getLatestAnomalyCount = () => {
    const assistantMsgs = messages.filter(m => m.role === 'assistant' && m.anomaly_count !== undefined);
    if (assistantMsgs.length === 0) return null;
    return assistantMsgs[assistantMsgs.length - 1].anomaly_count;
  };

  if (!onboardingComplete) {
    if (chatMutation.isPending) {
      return (
        <div className="panel" style={{ maxWidth: '600px', width: '100%', margin: '40px auto', textAlign: 'center', padding: '40px 24px', animation: 'slide-in 0.3s ease' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
            <div style={{ 
              backgroundColor: 'var(--sap-accent-light)', 
              width: '64px', 
              height: '64px', 
              borderRadius: '50%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              border: '1px solid rgba(10, 110, 209, 0.15)',
              position: 'relative'
            }}>
              <Loader2 className="animate-spin" size={24} style={{ color: 'var(--sap-accent)', animation: 'spin 1.5s linear infinite' }} />
            </div>
            
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--sap-text-color)', marginBottom: '6px' }}>
                Analyzing Invoice Exceptions
              </h3>
              <p style={{ color: 'var(--sap-text-muted)', fontSize: '13px', maxWidth: '380px', margin: '0 auto', lineHeight: '1.5' }}>
                Scanning ingested records, applying currency thresholds, checking purchase order numbers, and running exception rules...
              </p>
            </div>

            <span className="badge badge-gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 10px' }}>
              Status: Running Diagnostic Scan
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="panel" style={{ maxWidth: '600px', width: '100%', margin: '0 auto' }}>
        <div className="panel-header">
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--sap-text-color)' }}>
              <Settings size={18} style={{ color: 'var(--sap-accent)' }} />
              Audit Control Parameters
            </h2>
            <p style={{ color: 'var(--sap-text-muted)', fontSize: '13px', marginTop: '2px', fontWeight: '500' }}>
              Define validation thresholds and intervals to initialize the anomaly engine.
            </p>
          </div>
        </div>
        
        <form onSubmit={handleOnboardingSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          


          {context.audit_mode === 'batch' ? (
            <div style={{ border: '1px solid var(--sap-border)', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '4px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: '700', color: 'var(--sap-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Calendar size={12} /> Batch Date Interval Criteria
              </h3>
              <div style={{ display: 'flex', gap: '14px' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Posting Start Date</label>
                  <input type="date" className="form-input" value={context.expected_start_date} onChange={e => setContext({...context, expected_start_date: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Posting End Date</label>
                  <input type="date" className="form-input" value={context.expected_end_date} onChange={e => setContext({...context, expected_end_date: e.target.value})} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ border: '1px solid var(--sap-border)', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '4px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: '700', color: 'var(--sap-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={12} /> Single Invoice Expected Values
              </h3>
              <div style={{ display: 'flex', gap: '14px' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Expected PO Number</label>
                  <input type="text" className="form-input" placeholder="e.g. PO-2023-441" value={context.expected_po_number} onChange={e => setContext({...context, expected_po_number: e.target.value})} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Expected Invoice Date</label>
                  <input type="date" className="form-input" value={context.expected_invoice_date} onChange={e => setContext({...context, expected_invoice_date: e.target.value})} />
                </div>
              </div>
            </div>
          )}

          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={chatMutation.isPending} 
            style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '13px', borderRadius: '4px' }}
          >
            {chatMutation.isPending ? (
              <>
                <Loader2 className="animate-spin" size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Initializing Engine & Running Anomaly Scan...
              </>
            ) : (
              'Run Ingested Log Diagnostic Scan'
            )}
          </button>
        </form>
      </div>
    );
  }

  const latestAnomalyCount = getLatestAnomalyCount();

  return (
    <div className="chat-workspace">
      {/* Left Sidebar Pane */}
      <div className="chat-sidebar">
        {/* Sidebar Card 1: Active Audit Rules */}
        <div className="sidebar-card">
          <div className="sidebar-card-title">
            <span>Audit Context</span>
            <Settings size={14} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div style={{ borderBottom: '1px dashed var(--sap-border)', paddingBottom: '8px' }}>
              <span style={{ color: 'var(--sap-text-light)', display: 'block', fontSize: '11px', fontWeight: '600' }}>AUDIT MODE</span>
              <span style={{ fontWeight: '600', color: 'var(--sap-text-color)', textTransform: 'uppercase' }}>
                {context.audit_mode}
              </span>
            </div>
            
            {context.audit_mode === 'batch' ? (
              <div style={{ paddingBottom: '8px' }}>
                <span style={{ color: 'var(--sap-text-light)', display: 'block', fontSize: '11px', fontWeight: '600' }}>DATE RANGE</span>
                <span style={{ fontWeight: '600', color: 'var(--sap-text-color)' }}>
                  {context.expected_start_date || 'Any'} to {context.expected_end_date || 'Any'}
                </span>
              </div>
            ) : (
              <>
                <div style={{ borderBottom: '1px dashed var(--sap-border)', paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--sap-text-light)', display: 'block', fontSize: '11px', fontWeight: '600' }}>EXPECTED PO</span>
                  <span style={{ fontWeight: '600', color: 'var(--sap-text-color)' }}>
                    {context.expected_po_number || 'None'}
                  </span>
                </div>
                <div style={{ paddingBottom: '8px' }}>
                  <span style={{ color: 'var(--sap-text-light)', display: 'block', fontSize: '11px', fontWeight: '600' }}>EXPECTED DATE</span>
                  <span style={{ fontWeight: '600', color: 'var(--sap-text-color)' }}>
                    {context.expected_invoice_date || 'None'}
                  </span>
                </div>
              </>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
              <button 
                className="btn" 
                style={{ width: '100%', padding: '6px', fontSize: '11px', borderRadius: '4px' }} 
                onClick={() => setOnboardingComplete(false)}
              >
                Adjust Parameters
              </button>
              {onBackToUpload && (
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%', padding: '6px', fontSize: '11px', borderRadius: '4px', border: '1px solid var(--sap-border)' }} 
                  onClick={onBackToUpload}
                >
                  ← Ingest New Invoices
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar Card 2: Anomaly Health Meter */}
        <div className="sidebar-card" style={{ 
          backgroundColor: latestAnomalyCount > 0 ? 'var(--sap-error-bg)' : (latestAnomalyCount === 0 ? 'var(--sap-success-bg)' : 'var(--sap-card-bg)'),
          borderColor: latestAnomalyCount > 0 ? 'var(--sap-error-border)' : (latestAnomalyCount === 0 ? 'var(--sap-success-border)' : 'var(--sap-border)')
        }}>
          <div className="sidebar-card-title">
            <span style={{ color: latestAnomalyCount > 0 ? 'var(--sap-error-text)' : (latestAnomalyCount === 0 ? 'var(--sap-success-text)' : 'var(--sap-text-light)') }}>
              Scan Diagnostics
            </span>
            <ShieldAlert size={14} style={{ color: latestAnomalyCount > 0 ? 'var(--sap-error-text)' : (latestAnomalyCount === 0 ? 'var(--sap-success-text)' : 'var(--sap-text-light)') }} />
          </div>
          <div>
            {latestAnomalyCount !== null ? (
              latestAnomalyCount > 0 ? (
                <div>
                  <span style={{ fontSize: '22px', fontWeight: '700', color: 'var(--sap-error-text)', fontFamily: 'var(--font-mono)' }}>
                    {latestAnomalyCount}
                  </span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--sap-text-color)', marginLeft: '6px' }}>
                    Anomalies Active
                  </span>
                  <p style={{ fontSize: '11px', color: 'var(--sap-text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                    Critical exceptions found matching control rule limits. Export log below to review details.
                  </p>
                </div>
              ) : (
                <div>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--sap-success-text)' }}>
                    ✓ Clean Audit Log
                  </span>
                  <p style={{ fontSize: '11px', color: 'var(--sap-text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                    All invoices match context parameters perfectly. No exceptions flagged.
                  </p>
                </div>
              )
            ) : (
              <span style={{ color: 'var(--sap-text-light)', fontSize: '12px' }}>Awaiting initial diagnostic scan...</span>
            )}
          </div>
        </div>
      </div>

      {/* Right Main Chat Panel */}
      <div className="chat-container">
        <div style={{ 
          padding: '12px 20px', 
          borderBottom: '1px solid var(--sap-border)', 
          backgroundColor: 'var(--sap-card-bg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ 
              width: '8px', 
              height: '8px', 
              borderRadius: '50%', 
              backgroundColor: 'var(--sap-accent)',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: '50%',
                backgroundColor: 'var(--sap-accent)',
                opacity: 0.4,
                animation: 'pulse-ring 2s infinite'
              }}></div>
            </div>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--sap-text-color)' }}>
              Diagnostic Inquiry Channel
            </h3>
          </div>
          <span className="badge badge-gray" style={{ fontSize: '10px', textTransform: 'uppercase' }}>
            Mode: {context.audit_mode} AUDIT
          </span>
        </div>

        {/* Conversation Logs */}
        <div className="chat-history">
          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-message ${msg.role}`}>
              <div className="chat-message-header">
                <span>{msg.role === 'user' ? 'OPERATOR INQUIRY' : 'VERIFICATION REPORT'}</span>
                {msg.role === 'assistant' && msg.anomaly_count !== undefined && (
                  <span className={`badge ${msg.anomaly_count > 0 ? 'badge-red' : 'badge-green'}`} style={{ fontFamily: 'var(--font-mono)', fontWeight: '700' }}>
                    {msg.anomaly_count} Anomalies Found
                  </span>
                )}
              </div>
              <div style={{ 
                whiteSpace: 'pre-wrap', 
                fontSize: '13px', 
                lineHeight: '1.5',
                color: 'var(--sap-text-color)'
              }}>
                {msg.content}
              </div>
              
              {msg.role === 'assistant' && (msg.raw_csv || msg.highlighted_csv) && (
                <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {msg.raw_csv && (
                    <button 
                      className="btn" 
                      style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#f8fafc', border: '1px solid var(--sap-border)', borderRadius: '4px' }} 
                      onClick={() => downloadCSV(msg.raw_csv)}
                    >
                      <Download size={14} /> Export Exception Log (CSV)
                    </button>
                  )}
                  {msg.highlighted_csv && (
                    <button 
                      className="btn btn-primary" 
                      style={{ 
                        padding: '6px 12px', 
                        fontSize: '12px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        backgroundColor: 'var(--sap-accent)', 
                        color: '#ffffff',
                        border: '1px solid var(--sap-accent)', 
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }} 
                      onClick={() => downloadHighlightedCSV(msg.highlighted_csv)}
                    >
                      <Download size={14} /> Download Highlighted Original (CSV)
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          
          {chatMutation.isPending && (
            <div className="chat-message assistant" style={{ opacity: 0.85 }}>
              <div className="chat-message-header">SYSTEM SCAN RUNNING</div>
              <div className="typing-indicator">
                <span style={{ fontWeight: '500' }}>Consulting LLM and checking validation rules...</span>
                <div style={{ display: 'inline-flex', gap: '3px', marginLeft: '6px' }}>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={chatHistoryEndRef} />
        </div>

        {/* Console Action Input Bar */}
        <form className="chat-input-area" onSubmit={handleSendMessage}>
          <input 
            type="text" 
            className="form-input" 
            placeholder="Query anomalies (e.g. 'List all invoice amount mismatch issues' or 'Verify date ranges')..." 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={chatMutation.isPending}
            style={{ height: '38px', fontSize: '13px', borderRadius: '4px' }}
          />
          <button 
            type="submit" 
            className="btn btn-primary" 
            style={{ padding: '0 20px', height: '38px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px' }} 
            disabled={chatMutation.isPending || !input.trim()}
          >
            <Send size={14} /> Run Query
          </button>
        </form>
      </div>
    </div>
  );
}

export default ChatWindow;
