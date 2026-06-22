import { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle2, FileText, ArrowRight } from 'lucide-react';
import Papa from 'papaparse';

const API_URL = 'http://localhost:8081';

function UploadWindow({ onConfirmed }) {
  const [activeTab, setActiveTab] = useState('csv');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [standardFields, setStandardFields] = useState([]);
  const fileInputRef = useRef(null);

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
          
          setPreview({
            filename: file.name,
            headers: headers,
            rows: structuredRows
          });
        } catch (err) {
          console.error(err);
          alert('Error mapping columns automatically. Ensure backend is running.');
        }
        setLoading(false);
      }
    });
  };

  const uploadDocument = async (file) => {
    setLoading(true);
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
        
        setPreview({
          filename: data.filename,
          headers: headers,
          rows: data.extracted_data
        });
      } else {
        alert("No structured data could be extracted from the document.");
      }
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
    setLoading(false);
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
    }
  };

  const handleResetDb = async () => {
    if (!confirm("Are you sure you want to delete all invoices from the database?")) return;
    try {
      const res = await fetch(`${API_URL}/api/reset_db`, { method: 'POST' });
      const data = await res.json();
      alert(data.message);
      setFile(null);
      setPreview(null);
    } catch (err) {
      console.error(err);
      alert("Error resetting database.");
    }
  };

  const resetUpload = () => {
    setFile(null);
    setPreview(null);
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
    resetUpload();
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Document Ingestion Portal</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn" onClick={handleResetDb}>
            Clear System Database
          </button>
          <span className="badge badge-gray">PROG: INV_REC_01</span>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'csv' ? 'active' : ''}`} onClick={() => changeTab('csv')}>
          CSV Document Import
        </button>
        <button className={`tab ${activeTab === 'pdf' ? 'active' : ''}`} onClick={() => changeTab('pdf')}>
          PDF Import
        </button>
        <button className={`tab ${activeTab === 'image' ? 'active' : ''}`} onClick={() => changeTab('image')}>
          Image Scan (PNG/JPG)
        </button>
      </div>

      {!preview ? (
        <div 
          className="drop-zone"
          onClick={() => fileInputRef.current.click()}
          style={{ padding: '40px 20px', border: '1px dashed var(--border-color)', backgroundColor: '#fcfcfc', cursor: 'pointer' }}
        >
          <input 
            type="file" 
            accept={getAcceptType()} 
            style={{ display: 'none' }} 
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <UploadCloud size={32} className="drop-zone-icon" style={{ color: 'var(--accent-primary)', marginBottom: '10px' }} />
          <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
            {activeTab === 'csv' ? 'SELECT CSV TRANSACTION SHEET (Max 20MB)' : 
             activeTab === 'pdf' ? 'SELECT PDF INVOICE (Max 20MB)' : 'SELECT INVOICE IMAGE (Max 20MB)'}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Click to search local directories or drop files here</p>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', backgroundColor: '#f8f9fa', padding: '6px 10px', border: '1px solid var(--border-color)', borderRadius: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={16} color="green" />
              <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>AI Extraction Complete: {preview.filename}</span>
            </div>
            <button className="btn btn-primary" onClick={handleConfirmDocument} disabled={loading}>
              {loading ? 'Ingesting Record Data...' : 'Post & Ingest Invoice Document'} <CheckCircle2 size={14} />
            </button>
          </div>
          
          <p style={{ color: 'var(--text-muted)', marginBottom: '10px', fontSize: '12px' }}>
            The AI has successfully extracted the following structured data aligned to standard ERP fields. Please review before posting.
          </p>

          <div style={{ overflowX: 'auto', maxHeight: '300px', border: '1px solid var(--border-color)', marginBottom: '10px' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  {preview.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((h, j) => (
                      <td key={j}>{row[h] !== null && row[h] !== undefined ? String(row[h]) : ''}</td>
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
