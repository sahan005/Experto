import { useState, useRef, useEffect, useContext } from 'react';
import { UploadCloud, CheckCircle2, FileText, ArrowRight, Trash2, Loader2, Database, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { AuthContext } from '../context/AuthContext';

const API_URL = 'http://localhost:8081';

const formatFieldName = (name) => {
  if (!name) return "";
  if (name === "Qty") return "Quantity";
  return name.replace(/_/g, " ");
};

function UploadWindow({ onConfirmed }) {
  const { token, user } = useContext(AuthContext);
  const [activeTab, setActiveTab] = useState('csv');
  const [uploadMode, setUploadMode] = useState('batch'); // 'batch' or 'single'
    
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStep, setProgressStep] = useState(0);
  const [standardFields, setStandardFields] = useState([]);
  const fileInputRef = useRef(null);
  const timeoutsRef = useRef([]);
  
  // Validation state for single invoice
  const [validationResults, setValidationResults] = useState(null);

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
    
    setTimeout(() => {
      setLoading(false);
      callback();
    }, 500);
  };

  const handleFileChange = async (e) => {

    
    const selected = e.target.files[0];
    if (!selected) return;

    if (selected.size > 20 * 1024 * 1024) {
      alert('Error: File size exceeds the 20MB limit.');
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
  
  const validateSingleInvoice = (rows) => {
    if (!rows || rows.length === 0) return null;
    
    const firstRow = rows[0];
    const poMatch = true;
    const dateMatch = true;
    
    let hasNegative = false;
    let hasMissing = false;
    
    const numCols = ["Qty", "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", "Grand_Total"];
    const requiredCols = ["Invoice_ID", "Vendor_Name", "Line_Item_Description"];
    
    rows.forEach(r => {
      numCols.forEach(col => {
         if (r[col] !== undefined && r[col] !== null) {
           const num = parseFloat(r[col]);
           if (num < 0) hasNegative = true;
         }
      });
      requiredCols.forEach(col => {
         if (r[col] === undefined || r[col] === null || String(r[col]).trim() === "") {
           hasMissing = true;
         }
      });
    });
    
    return {
       poMatch,
       dateMatch,
       hasNegative,
       hasMissing,
       vendorDetails: firstRow
    };
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
            setValidationResults(uploadMode === 'single' ? validateSingleInvoice(structuredRows) : null);
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
          setValidationResults(uploadMode === 'single' ? validateSingleInvoice(data.extracted_data) : null);
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
      onConfirmed(uploadMode);
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
    setValidationResults(null);
    clearProgressTimeouts();
  };

  const changeTab = (tab) => {
    setActiveTab(tab);
    resetUpload();
  };
  
  const lineItemKeys = ["Line_No", "Line_Item_Description", "Qty", "Unit_Price", "Line_Amount", "Subtotal", "Discount", "Tax", "Shipping", "Grand_Total"];

  return (
    <div className="panel" style={{ maxWidth: '960px', width: '100%', margin: '0 auto' }}>
      <div className="panel-header">
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--sap-text-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={18} style={{ color: 'var(--sap-accent)' }} />
            Document Ingestion Portal
          </h2>
          <p style={{ color: 'var(--sap-text-muted)', fontSize: '13px', marginTop: '2px', fontWeight: '500' }}>
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

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', padding: '10px 24px', backgroundColor: '#f9f9fa', borderBottom: '1px solid var(--sap-border-color)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
          <input type="radio" name="uploadMode" checked={uploadMode === 'batch'} onChange={() => { setUploadMode('batch'); resetUpload(); }} />
          Batch Upload
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }}>
          <input type="radio" name="uploadMode" checked={uploadMode === 'single'} onChange={() => { setUploadMode('single'); resetUpload(); }} />
          Single Invoice Validation
        </label>
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
              <Loader2 className="animate-spin" size={20} style={{ color: 'var(--sap-accent)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontWeight: '700', fontSize: '14px', color: 'var(--sap-text-color)', letterSpacing: '-0.01em' }}>
                Analyzing document...
              </span>
            </div>
            <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: '700', color: 'var(--sap-accent)' }}>
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
            backgroundColor: 'var(--sap-accent-light)', 
            width: '56px', 
            height: '56px', 
            borderRadius: '50%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            marginBottom: '16px',
            border: '1px solid rgba(10, 110, 209, 0.15)'
          }}>
            <UploadCloud size={24} className="drop-zone-icon" style={{ margin: 0 }} />
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--sap-text-color)', marginBottom: '4px' }}>
            {activeTab === 'csv' ? 'Select CSV Transaction Sheet' : 
             activeTab === 'pdf' ? 'Select PDF Invoice' : 'Select Invoice Image'}
          </h3>
          <p style={{ color: 'var(--sap-text-muted)', fontSize: '12px', maxWidth: '380px', margin: '0 auto', lineHeight: '1.5' }}>
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
            backgroundColor: 'var(--sap-success-bg)', 
            padding: '12px 18px', 
            border: '1px solid var(--sap-success-border)', 
            borderRadius: '4px',
            margin: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                backgroundColor: 'var(--sap-success-text)',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: '11px'
              }}>
                ✓
              </div>
              <div>
                <span style={{ fontWeight: '700', color: 'var(--sap-text-color)', display: 'block', fontSize: '13px' }}>
                  AI Extraction Success
                </span>
                <span style={{ fontSize: '12px', color: 'var(--sap-text-muted)' }}>
                  File aligned: {preview.filename}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn" onClick={resetUpload} style={{ padding: '6px 12px', borderRadius: '4px' }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmDocument} style={{ padding: '6px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Post & Ingest Invoices <ArrowRight size={12} />
              </button>
            </div>
          </div>
          
          {uploadMode === 'single' && validationResults && (
            <div style={{ padding: '0 16px 16px 16px' }}>
              <div style={{ border: '1px solid var(--sap-border-color)', borderRadius: '4px', backgroundColor: '#fff', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sap-border-color)', backgroundColor: '#f9f9fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                   <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--sap-text-color)' }}>Vendor & Invoice Details</h3>
                   <div style={{ display: 'flex', gap: '12px' }}>
                     {validationResults.hasNegative && <span style={{ color: '#d32f2f', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle size={14}/> Contains Negative Values</span>}
                     {validationResults.hasMissing && <span style={{ color: '#ed6c02', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertCircle size={14}/> Missing Required Fields</span>}
                   </div>
                </div>
                <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--sap-text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Vendor Name</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--sap-text-color)' }}>{validationResults.vendorDetails.Vendor_Name || 'Unknown'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--sap-text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Invoice ID</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--sap-text-color)' }}>{validationResults.vendorDetails.Invoice_ID || 'Unknown'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--sap-text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>PO Number</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--sap-text-color)' }}>{validationResults.vendorDetails.PO_Number || 'Missing'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--sap-text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Invoice Date</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--sap-text-color)' }}>{validationResults.vendorDetails.Invoice_Date || 'Missing'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--sap-text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Payment Terms</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--sap-text-color)' }}>{validationResults.vendorDetails.Payment_Terms || 'Missing'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--sap-text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Invoice Status</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--sap-text-color)' }}>{validationResults.vendorDetails.Invoice_Status || 'Pending'}</div>
                  </div>
                </div>
              </div>
              
              <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--sap-text-color)', marginTop: '24px', marginBottom: '12px' }}>Line Items</h3>
            </div>
          )}

          <div className="table-wrapper" style={{ maxHeight: '360px', overflow: 'auto', margin: '0 16px 16px 16px' }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  {uploadMode === 'single' 
                    ? preview.headers.filter(h => lineItemKeys.includes(h)).map((h, i) => (
                        <th key={i}>{formatFieldName(h)}</th>
                      ))
                    : preview.headers.map((h, i) => (
                        <th key={i}>{formatFieldName(h)}</th>
                      ))
                  }
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {uploadMode === 'single'
                      ? preview.headers.filter(h => lineItemKeys.includes(h)).map((h, j) => (
                          <td key={j} style={{ fontFamily: (h.includes('Amount') || h.includes('Qty') || h.includes('Total') || h.includes('Price')) ? 'var(--font-mono)' : 'inherit', fontSize: '12px' }}>
                            {row[h] !== null && row[h] !== undefined ? String(row[h]) : ''}
                          </td>
                        ))
                      : preview.headers.map((h, j) => (
                          <td key={j} style={{ fontFamily: (h.includes('Amount') || h.includes('Date') || h.includes('ID') || h.includes('No')) ? 'var(--font-mono)' : 'inherit', fontSize: '12px' }}>
                            {row[h] !== null && row[h] !== undefined ? String(row[h]) : ''}
                          </td>
                        ))
                    }
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
