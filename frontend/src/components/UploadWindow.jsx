import { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from 'lucide-react';
import Papa from 'papaparse';

const API_URL = 'http://localhost:8000';

function UploadWindow({ onConfirmed }) {
  const [activeTab, setActiveTab] = useState('csv');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mappings, setMappings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [standardFields, setStandardFields] = useState([]);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/standard_fields`)
      .then(res => res.json())
      .then(data => setStandardFields(data.standard_fields || []))
      .catch(err => console.error("Error fetching standard fields:", err));
  }, []);

  const handleFileChange = (e) => {
    const selected = e.target.files[0];
    if (selected && selected.name.endsWith('.csv')) {
      setFile(selected);
      parsePreview(selected);
    }
  };

  const parsePreview = (file) => {
    Papa.parse(file, {
      header: true,
      preview: 10,
      complete: (results) => {
        setPreview({
          filename: file.name,
          headers: results.meta.fields,
          rows: results.data
        });
      }
    });
  };

  const handleContinue = async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/map_columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_columns: preview.headers })
      });
      const data = await res.json();
      setMappings(data.mappings);
    } catch (err) {
      console.error(err);
      alert('Error mapping columns. Ensure backend is running.');
    }
    setLoading(false);
  };

  const handleConfirmMapping = async () => {
    setLoading(true);
    try {
      // Re-parse whole file to get all data and map it based on user confirmation
      Papa.parse(file, {
        header: true,
        complete: async (results) => {
          const rowsToInsert = results.data.map(row => {
            const standardData = {};
            mappings.forEach(m => {
              if (m.standard_field) {
                standardData[m.standard_field] = row[m.raw_column];
              }
            });
            return {
              source_file: file.name,
              data: standardData
            };
          });

          await fetch(`${API_URL}/api/confirm_mapping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: rowsToInsert })
          });
          
          setLoading(false);
          onConfirmed();
        }
      });
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleOverride = (index, newField) => {
    const newMappings = [...mappings];
    newMappings[index].standard_field = newField;
    if (newField) {
      newMappings[index].confidence = 'high';
    } else {
      newMappings[index].confidence = 'unmapped';
    }
    setMappings(newMappings);
  };

  const handleResetDb = async () => {
    if (!confirm("Are you sure you want to delete all invoices from the database?")) return;
    try {
      const res = await fetch(`${API_URL}/api/reset_db`, { method: 'POST' });
      const data = await res.json();
      alert(data.message);
      setFile(null);
      setPreview(null);
      setMappings(null);
    } catch (err) {
      console.error(err);
      alert("Error resetting database.");
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Ingestion Module</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', border: '1px solid var(--border-color)' }} onClick={handleResetDb}>Reset Database</button>
          <span className="badge badge-gray">ID: ING-01</span>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'csv' ? 'active' : ''}`} onClick={() => setActiveTab('csv')}>
          CSV Source
        </button>
        <button className="tab" disabled title="Coming Soon">
          PDF <span className="badge badge-gray" style={{marginLeft: '8px'}}>Coming Soon</span>
        </button>
        <button className="tab" disabled title="Coming Soon">
          Image <span className="badge badge-gray" style={{marginLeft: '8px'}}>Coming Soon</span>
        </button>
      </div>

      {activeTab === 'csv' && !mappings && (
        <>
          {!preview ? (
            <div 
              className="drop-zone"
              onClick={() => fileInputRef.current.click()}
            >
              <input 
                type="file" 
                accept=".csv" 
                style={{ display: 'none' }} 
                ref={fileInputRef}
                onChange={handleFileChange}
              />
              <UploadCloud size={48} className="drop-zone-icon" />
              <h3>Select CSV Data Source</h3>
              <p style={{color: 'var(--text-muted)', marginTop: '0.5rem'}}>Click to browse files or drop here</p>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={20} color="var(--accent-primary)" />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{preview.filename}</span>
                </div>
                <button className="btn btn-primary" onClick={handleContinue} disabled={loading}>
                  {loading ? 'Processing...' : 'Run Diagnostics'} <ArrowRight size={16} />
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      {preview.headers.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i}>
                        {preview.headers.map((h, j) => (
                          <td key={j}>{row[h]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {mappings && (
        <div>
          <h3>Review Column Mappings</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>AI mapping confidence results. Please verify.</p>
          
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Raw Column</th>
                <th>Standard Field</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m, i) => (
                <tr key={i}>
                  <td>
                    {m.confidence === 'high' && <CheckCircle2 size={16} color="var(--status-green)" />}
                    {m.confidence === 'medium' && <AlertTriangle size={16} color="var(--status-yellow)" />}
                    {m.confidence === 'unmapped' && <XCircle size={16} color="var(--status-red)" />}
                  </td>
                  <td>{m.raw_column}</td>
                  <td>
                    <select 
                      className="form-select" 
                      value={m.standard_field || ''}
                      onChange={(e) => handleOverride(i, e.target.value)}
                    >
                      <option value="">-- Unmapped --</option>
                      {standardFields.map(field => (
                        <option key={field} value={field}>{field}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button className="btn btn-primary" onClick={handleConfirmMapping} disabled={loading}>
              {loading ? 'Ingesting...' : 'Confirm & Ingest'} <CheckCircle2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UploadWindow;
