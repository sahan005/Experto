import { useState, useRef, useEffect, useContext } from 'react';
import { UploadCloud, CheckCircle2, FileText, ArrowRight, Trash2, Loader2, Database } from 'lucide-react';
import Papa from 'papaparse';
import { AuthContext } from '../context/AuthContext';

const API_URL = 'http://localhost:8081';

function UploadWindow({ onConfirmed }) {
  const { token, user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('csv');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStep, setProgressStep] = useState(0);
  const [standardFields, setStandardFields] = useState([]);
  const fileInputRef = useRef(null);
  const timeoutsRef = useRef([]);

  useEffect(() => {
    fetch(`${API_URL}/api/standard_fields`)
      .then(res => res.json())
      .then(data => setStandardFields(data.standard_fields || []))
      .catch(err => console.error("Error fetching standard fields:", err));
  }, []);

  const getAcceptType = () => {
    if (activeTab === 'csv') return '.csv';
    if (activeTab === 'pdf') return '.pdf';
    return '.png,.jpg,.jpeg';
  };

  const clearProgressTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const startProgressSimulation = () => {
    clearProgressTimeouts();
    setProgressPercent(10);
    setProgressStep(1);

    const t1 = setTimeout(() => {
      setProgressPercent(45);
      setProgressStep(2);
    }, 700);

    const t2 = setTimeout(() => {
      setProgressPercent(80);
      setProgressStep(3);
    }, 1500);

    const t3 = setTimeout(() => {
      setProgressPercent(92);
    }, 2400);

    timeoutsRef.current = [t1, t2, t3];
  };

  const completeProgressSimulation = (callback) => {
    clearProgressTimeouts();
    setProgressPercent(100);
    setProgressStep(4);
    
    // Brief delay so the user sees the completed checkmark and full bar
    setTimeout(() => {
      setLoading(false);
      callback();
    }, 500);
  };

  const handleFileChange = async (e) => {
    const selected = e.target.files[0];
    if (!selected) return;

    if (selected.size > 20 * 1024 * 1024) {
      alert('Error: File size exceeds the 20MB limit. Please upload a smaller file.');
      return;
    }

    setFile(selected);

    if (activeTab === 'csv' && selected.name.toLowerCase().endsWith('.csv')) {
      await uploadCSV(selected);
    } else if (activeTab === 'pdf' && selected.name.toLowerCase().endsWith('.pdf')) {
      await uploadDocument(selected);
    } else if (activeTab === 'image' && (selected.name.toLowerCase().endsWith('.png') || selected.name.toLowerCase().endsWith('.jpg') || selected.name.toLowerCase().endsWith('.jpeg'))) {
      await uploadDocument(selected);
    } else {
      alert(`Invalid file type for the selected tab. Expected ${getAcceptType()}`);
      setFile(null);
    }
  };

  const uploadCSV = async (file) => {
    setLoading(true);
    startProgressSimulation();
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rawHeaders = results.meta.fields;
        const rawData = results.data;
        
        try {
          const res = await fetch(`${API_URL}/api/map_columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_columns: rawHeaders })
          });
          if (!res.ok) throw new Error("Failed to map columns");
          const mappingData = await res.json();
          const mappings = mappingData.mappings;
          
          const structuredRows = rawData.map(row => {
            const standardData = {};
            mappings.forEach(m => {
              if (m.standard_field) {
                standardData[m.standard_field] = row[m.raw_column];
              }
            });
            return standardData;
          });
          
          const allKeys = new Set();
          structuredRows.forEach(item => {
             Object.keys(item).forEach(k => allKeys.add(k));
          });
          const headers = Array.from(allKeys);
          
          completeProgressSimulation(() => {
            setPreview({
              filename: file.name,
              headers: headers,
              rows: structuredRows
            });
          });
        } catch (err) {
          clearProgressTimeouts();
          setLoading(false);
          console.error(err);
          alert('Error mapping columns automatically. Ensure backend is running.');
          setFile(null);
        }
      }
    });
  };

  const uploadDocument = async (file) => {
    setLoading(true);
    startProgressSimulation();
    
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${API_URL}/api/upload/document`, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
         const errData = await res.json();
         throw new Error(errData.detail || 'Upload failed');
      }
      const data = await res.json();
      
      if (data.extracted_data && data.extracted_data.length > 0) {
        const allKeys = new Set();
        data.extracted_data.forEach(item => {
           Object.keys(item).forEach(k => allKeys.add(k));
        });
        const headers = Array.from(allKeys);
        
        completeProgressSimulation(() => {
          setPreview({
            filename: data.filename,
            headers: headers,
            rows: data.extracted_data
          });
        });
      } else {
        clearProgressTimeouts();
        setLoading(false);
        alert("No structured data could be extracted from the document.");
        setFile(null);
      }
    } catch (err) {
      clearProgressTimeouts();
      setLoading(false);
      console.error(err);
      alert(err.message);
      setFile(null);
    }
  };

  const handleConfirmDocument = async () => {
    setLoading(true);
    try {
      const rowsToInsert = preview.rows.map(row => ({
        source_file: preview.filename,
        data: row
      }));
      await fetch(`${API_URL}/api/confirm_mapping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsToInsert })
      });
      setLoading(false);
      onConfirmed();
    } catch (err) {
      console.error(err);
      setLoading(false);
      alert("Error confirming and ingesting data.");
    }
  };

  const handleResetDb = async () => {
    if (!confirm("Are you sure you want to delete all invoices from the database? This action cannot be undone.")) return;
    try {
      const res = await fetch(`${API_URL}/api/reset_db`, { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        setFile(null);
        setPreview(null);
      } else {
        alert(data.detail || "Error resetting database.");
      }
    } catch (err) {
      console.error(err);
      alert("Error resetting database.");
    }
  };

  const resetUpload = () => {
    setFile(null);
    setPreview(null);
    clearProgressTimeouts();
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
    resetUpload();
  };

  return (
    <div className="panel" style={{ maxWidth: '960px', width: '100%', margin: '0 auto' }}>
      <div className="panel-header">
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={20} style={{ color: 'var(--accent-primary)' }} />
            Document Ingestion Portal
          </h2>
          <p style={{ color: 'var(--text-light)', fontSize: '13px', marginTop: '2px', fontWeight: '500' }}>
            Upload invoice files to extract, align, and ingest transactions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {user?.role === 'admin' && (
            <button className="btn btn-danger" onClick={handleResetDb} style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Trash2 size={14} /> Clear System DB
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'csv' ? 'active' : ''}`} onClick={() => changeTab('csv')}>
          CSV Spreadsheet
        </button>
        <button className={`tab ${activeTab === 'pdf' ? 'active' : ''}`} onClick={() => changeTab('pdf')}>
          PDF Document
        </button>
        <button className={`tab ${activeTab === 'image' ? 'active' : ''}`} onClick={() => changeTab('image')}>
          Image Scan
        </button>
      </div>

      {loading ? (
        <div className="progress-container">
          <div className="progress-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Loader2 className="animate-spin" size={20} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--text-main)', letterSpacing: '-0.01em' }}>
                Analyzing document...
              </span>
            </div>
            <span style={{ fontSize: '14px', fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--accent-primary)' }}>
              {progressPercent}%
            </span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
          </div>
          <div className="progress-steps">
            <div className={`progress-step ${progressStep >= 1 ? (progressStep > 1 ? 'completed' : 'active') : ''}`}>
              <span className="progress-step-icon">
                {progressStep > 1 ? '✓' : '1'}
              </span>
              <span>Parsing and reading raw structures...</span>
            </div>
            <div className={`progress-step ${progressStep >= 2 ? (progressStep > 2 ? 'completed' : 'active') : ''}`}>
              <span className="progress-step-icon">
                {progressStep > 2 ? '✓' : '2'}
              </span>
              <span>Invoking AI engine for standard schema mapping...</span>
            </div>
            <div className={`progress-step ${progressStep >= 3 ? (progressStep > 3 ? 'completed' : 'active') : ''}`}>
              <span className="progress-step-icon">
                {progressStep > 3 ? '✓' : '3'}
              </span>
              <span>Extracting records and aligning column indices...</span>
            </div>
          </div>
        </div>
      ) : !preview ? (
        <div 
          className="drop-zone"
          onClick={() => fileInputRef.current.click()}
        >
          <input 
            type="file" 
            accept={getAcceptType()} 
            style={{ display: 'none' }} 
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <div style={{ 
            backgroundColor: '#f1f3fe', 
            width: '60px', 
            height: '60px', 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            marginBottom: '16px',
            boxShadow: '0 4px 10px rgba(79, 70, 229, 0.08)'
          }}>
            <UploadCloud size={28} className="drop-zone-icon" style={{ margin: 0 }} />
          </div>
          <h3 style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '6px' }}>
            {activeTab === 'csv' ? 'Select CSV Transaction Sheet' : 
             activeTab === 'pdf' ? 'Select PDF Invoice' : 'Select Invoice Image'}
          </h3>
          <p style={{ color: 'var(--text-light)', fontSize: '13px', maxWidth: '380px', margin: '0 auto', lineHeight: '1.5' }}>
            Click to browse your computer or drag and drop your file here. Maximum file size 20MB.
          </p>
        </div>
      ) : (
        <div style={{ animation: 'slide-in 0.4s ease' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '16px', 
            backgroundColor: 'var(--status-green-bg)', 
            padding: '14px 20px', 
            border: '1px solid var(--status-green-border)', 
            borderRadius: '12px' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                backgroundColor: 'var(--status-green)',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white'
              }}>
                ✓
              </div>
              <div>
                <span style={{ fontWeight: '700', color: 'var(--text-main)', display: 'block', fontSize: '14px' }}>
                  AI Extraction Success
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  File aligned: {preview.filename}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn" onClick={resetUpload}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmDocument} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                Post & Ingest Invoices <ArrowRight size={14} />
              </button>
            </div>
          </div>
          
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-main)' }}>Extracted Structured Schema Preview</h3>
            <p style={{ color: 'var(--text-light)', fontSize: '12px', marginTop: '2px' }}>
              The AI extraction engine mapped raw data fields into the unified ERP schema shown below. Verify details before posting.
            </p>
          </div>

          <div className="table-wrapper" style={{ maxHeight: '360px', overflow: 'auto' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  {preview.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h, j) => (
                      <td key={j} style={{ fontFamily: (h.includes('amount') || h.includes('date') || h.includes('number') || h.includes('id')) ? 'var(--font-mono)' : 'inherit', fontSize: '12px' }}>
                        {row[h] !== null && row[h] !== undefined ? String(row[h]) : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default UploadWindow;
